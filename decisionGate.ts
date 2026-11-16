import { GoogleGenAI } from '@google/genai';
import type { AgentTask, BrowserAction, DecisionGateTelemetry, PlannedStep } from './src/types/browser.ts';

export type DecisionRoute =
  | 'FAST_EXECUTE_ACTION'
  | 'FAST_PAUSE_HUMAN_GATE'
  | 'ROUTE_BRAIN_PLAN_OR_TEXT'
  | 'ROUTE_BRAIN_ERROR_RECOVERY';

export interface ParsedAxElement {
  id: string;
  role: string;
  label: string;
  raw: string;
  isInput: boolean;
  inModal: boolean;
  focused: boolean;
}

export interface DecisionGateInput {
  userPrompt: string;
  myself: boolean;
  activeTask: AgentTask | null;
  currentLiveState: {
    url?: string;
    title?: string;
    activeTabId?: string;
    tabs?: Array<{ id: string; title: string; url: string }>;
    screenshotBase64?: string;
    accessibilityTree?: string;
    focusedElement?: any;
  };
  history: any[];
}

export interface DecisionGateEvaluation {
  route: DecisionRoute;
  fastExecuted: boolean;
  routedToBrain: boolean;
  escalationReason: string;
  selectedOption?: string;
  resolvedAction?: BrowserAction;
  consumedPendingInputIndex?: number;
  consumedPlannedStep?: boolean;
  plannedStepRequiresBrainAfter?: boolean;
  currentStepIndex: number;
  consecutiveFastSteps: number;
  stagnantCount: number;
  treeSignature: string;
  retryCount: number;
  latencyMs: number;
  decisionInputSummary: any;
  decisionRawResponse: any;
  telemetry: DecisionGateTelemetry;
}

const MAX_CONSECUTIVE_FAST_STEPS = 8;
const MAX_STAGNANT_REPEATS = 2;
const MAX_RETRY_BEFORE_BRAIN = 2;
const MIN_ACTION_CHOICE_CONFIDENCE = 0.4;
const MAX_DYNAMIC_CLICK_OPTIONS = 140;
const MAX_TOTAL_CHOICE_OPTIONS = 220;

function isSimpleResumeDirective(prompt: string): boolean {
  const normalized = prompt.trim().toLowerCase();
  if (!normalized) return false;
  const resumePhrases = new Set([
    'resume',
    'continue',
    'go ahead',
    'proceed',
    'done',
    'logged in',
    'i solved it',
    'resume current task from current page state',
  ]);
  return resumePhrases.has(normalized);
}

function parseScreenshotPart(screenshotBase64?: string): { data: string; mime_type: string } | null {
  if (!screenshotBase64 || !screenshotBase64.startsWith('data:image/')) return null;
  const match = screenshotBase64.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) return null;
  return {
    mime_type: match[1],
    data: match[2],
  };
}

function computeTreeSignature(url: string, tree: string): string {
  const head = (tree || '').slice(0, 400);
  return `${url}::${(tree || '').length}::${head.length}`;
}

export function parseAccessibilityTreeElements(tree: string): ParsedAxElement[] {
  if (!tree) return [];
  const lines = tree.split('\n');
  const parsed: ParsedAxElement[] = [];

  for (const line of lines) {
    const m = line.match(/^\s*-\s*\[(el-\d+)\]\s+([^\s"]+)\s+"([^"]*)"(.*)$/);
    if (!m) continue;
    const id = m[1];
    const role = m[2].toLowerCase();
    const label = m[3].trim();
    const rest = m[4] || '';
    const isInput =
      role.includes('input') ||
      role.includes('textarea') ||
      role.includes('searchbox') ||
      role.includes('textbox') ||
      role.includes('combobox') ||
      role.includes('select');
    const inModal = rest.includes('in_modal: true');
    const focused = rest.includes('focused: true');

    parsed.push({
      id,
      role,
      label,
      raw: line.replace(/^\s*-\s*/, '').trim().slice(0, 130),
      isInput,
      inModal,
      focused,
    });
  }

  // Prioritize modal elements, focused elements, inputs, buttons, and named links
  const prioritized = [...parsed].sort((a, b) => {
    const score = (el: ParsedAxElement) => {
      let s = 0;
      if (el.inModal) s += 50;
      if (el.focused) s += 30;
      if (el.isInput) s += 20;
      if (el.role.includes('button')) s += 12;
      if (el.label.length > 0) s += 5;
      return s;
    };
    return score(b) - score(a);
  });

  return prioritized.slice(0, MAX_DYNAMIC_CLICK_OPTIONS);
}

export async function evaluateDecisionGate(
  ai: GoogleGenAI,
  params: DecisionGateInput
): Promise<DecisionGateEvaluation> {
  const startedAt = Date.now();
  const { userPrompt, myself, activeTask, currentLiveState, history } = params;

  const trimmedPrompt = (userPrompt || '').trim();
  const isResumePrompt = !myself && isSimpleResumeDirective(trimmedPrompt);
  const isNewOrNonResumePrompt = !myself && trimmedPrompt.length > 0 && !isResumePrompt;

  const planSteps = Array.isArray(activeTask?.plan_steps) ? activeTask.plan_steps : [];
  const currentStepIndex = typeof activeTask?.current_step_index === 'number' ? activeTask.current_step_index : 0;
  const consecutiveFastSteps = typeof activeTask?.consecutive_fast_steps === 'number' ? activeTask.consecutive_fast_steps : 0;
  const stagnantCount = typeof activeTask?.stagnant_count === 'number' ? activeTask.stagnant_count : 0;
  const retryCount = typeof activeTask?.retry_count === 'number' ? activeTask.retry_count : 0;
  const lastActionFailed = Boolean(activeTask?.last_action_failed);
  const forceBrainNext = Boolean(activeTask?.force_brain_next);
  const pendingInputs = Array.isArray(activeTask?.pending_inputs) ? activeTask.pending_inputs : [];

  const plannedStep: PlannedStep | null =
    currentStepIndex >= 0 && currentStepIndex < planSteps.length ? planSteps[currentStepIndex] : null;

  const accessibilityTree = currentLiveState?.accessibilityTree || '';
  const currentUrl = currentLiveState?.url || '';
  const treeSignature = computeTreeSignature(currentUrl, accessibilityTree);
  const lastUrl = activeTask?.last_url || '';
  const urlChanged = Boolean(lastUrl && currentUrl && lastUrl !== currentUrl);

  const liveElements = parseAccessibilityTreeElements(accessibilityTree);
  const elementMap = new Map<string, ParsedAxElement>();
  for (const el of liveElements) {
    elementMap.set(el.id, el);
  }

  // Build dynamic choice options for q5_next_action (strictly <= MAX_TOTAL_CHOICE_OPTIONS < 255)
  const actionCriteria: Record<string, string> = {
    ROUTE_TO_BRAIN:
      'IF no active task exists, OR a new user prompt needs planning, OR we need to read/summarize/compare content and answer the user, OR text must be composed that is not in pending_inputs, OR agent is stuck/errored.',
    PAUSE_HUMAN_GATE:
      'IF the live screenshot shows a login wall, password/OTP/2FA prompt, CAPTCHA puzzle, or payment PIN blocking progress.',
    ACTION_SCROLL_DOWN:
      'Scroll down 500px to reveal more listings, comments, links, or article content below the fold.',
    ACTION_SCROLL_UP:
      'Scroll up 500px to view content above.',
    ACTION_PRESS_ENTER:
      'Press Enter key to submit the currently focused search input or confirm a selection.',
    ACTION_PRESS_ESCAPE:
      'Press Escape key to dismiss an open modal, dropdown, or cookie banner.',
    ACTION_WAIT:
      'Wait 1 second if the page in the screenshot is clearly still loading.',
  };

  if (plannedStep) {
    actionCriteria['PLANNED_STEP'] = `Execute queued planned step: ${plannedStep.description}`.slice(0, 140);
  }

  // Add type_pending options when Brain prepared pending_inputs AND page has input elements
  const pendingInputBindings = new Map<string, { pendingIndex: number; elementId: string; value: string; submit: boolean }>();
  if (pendingInputs.length > 0) {
    const inputElements = liveElements.filter((el) => el.isInput).slice(0, 12);
    for (let pIdx = 0; pIdx < Math.min(pendingInputs.length, 2); pIdx++) {
      const pItem = pendingInputs[pIdx];
      if (!pItem?.value) continue;
      for (const el of inputElements) {
        if (Object.keys(actionCriteria).length >= MAX_TOTAL_CHOICE_OPTIONS - 20) break;
        const optId = `type_pending:${pIdx}:${el.id}`;
        actionCriteria[optId] = `Type "${pItem.value.slice(0, 50)}" into [${el.id}] ${el.role} "${el.label.slice(0, 45)}" (for: ${pItem.field_hint.slice(0, 30)})`;
        pendingInputBindings.set(optId, {
          pendingIndex: pIdx,
          elementId: el.id,
          value: pItem.value,
          submit: Boolean(pItem.submit),
        });
      }
    }
  }

  // Add click:<el-id> options from live elements on the page
  for (const el of liveElements) {
    if (Object.keys(actionCriteria).length >= MAX_TOTAL_CHOICE_OPTIONS) break;
    const optId = `click:${el.id}`;
    actionCriteria[optId] = `Click ${el.raw}`.slice(0, 140);
  }

  const recentActionSummaries = Array.isArray(history)
    ? history
        .slice(-4)
        .map((h: any) => ({
          role: h.role,
          action: h.action?.type || null,
          target: h.action?.target || null,
          summary: (h.action?.summary || h.text || '').slice(0, 100),
        }))
    : [];

  const structuredState = {
    invocation: {
      myself,
      user_prompt: trimmedPrompt || '(none - autonomous loop tick)',
      is_new_user_directive: isNewOrNonResumePrompt,
    },
    active_goal: activeTask
      ? {
          title: activeTask.title,
          summary: activeTask.summary,
          approach: activeTask.approach,
          pending_inputs: pendingInputs,
          queued_planned_step: plannedStep ? plannedStep.description : null,
          consecutive_fast_steps: consecutiveFastSteps,
          stagnant_count: stagnantCount,
          last_action_key: activeTask.last_action_key || null,
        }
      : null,
    browser_state: {
      url: currentUrl,
      title: currentLiveState?.title || '',
      open_tabs_count: Array.isArray(currentLiveState?.tabs) ? currentLiveState.tabs.length : 1,
      focused_element: currentLiveState?.focusedElement || null,
      url_changed_since_last_step: urlChanged,
    },
    recent_history: recentActionSummaries,
  };

  const stateText = [
    '=== AUTONOMOUS DECISION ENGINE STATE ===',
    'Inspect the live browser viewport screenshot and the active_goal.',
    'Choose the immediate next UI action directly from q5_next_action if it is clear and safe, OR choose ROUTE_TO_BRAIN if text generation, summarization, planning, or error recovery is needed.',
    JSON.stringify(structuredState, null, 2),
  ].join('\n');

  const screenshotPart = parseScreenshotPart(currentLiveState?.screenshotBase64);
  const decisionInput: Array<
    | { type: 'image'; data: string; mime_type: string }
    | { type: 'text'; text: string }
  > = [];

  if (screenshotPart) {
    decisionInput.push({
      type: 'image',
      data: screenshotPart.data,
      mime_type: screenshotPart.mime_type,
    });
  }
  decisionInput.push({
    type: 'text',
    text: stateText,
  });

  const questions = {
    q1_prompt_needs_brain: {
      type: 'noul' as const,
      instructions:
        'IF invocation.myself is false AND invocation.is_new_user_directive is true -> true. ELSE -> false.',
      criteria: {
        true_description: 'A new user prompt arrived that requires Brain understanding or planning.',
        false_description: 'Autonomous continuation (myself=true) or simple resume command.',
      },
    },
    q2_needs_text_gen_or_summary: {
      type: 'noul' as const,
      instructions:
        'IF completing the current step requires generating a written answer/summary for the user, comparing collected details, OR composing dynamic text NOT available in active_goal.pending_inputs -> true. ELSE -> false.',
      criteria: {
        true_description:
          'Needs Brain LLM right now to read/summarize the visible page, answer the user, compare options, or write unscripted text.',
        false_description:
          'Next step is purely interactive browsing (clicking a button/link, dismissing a modal, scrolling, pressing Enter, or typing a pending_inputs value).',
      },
    },
    q3_human_auth_or_captcha_gate: {
      type: 'noul' as const,
      instructions:
        'Inspect the live screenshot. IF progress is blocked by a login screen, password/2FA/OTP input, CAPTCHA puzzle, or payment PIN -> true. ELSE -> false.',
      criteria: {
        true_description: 'Login wall, 2FA/OTP, CAPTCHA, or human-only gate is blocking the screen.',
        false_description: 'No human-only verification gate is blocking progress.',
      },
    },
    q4_goal_achieved_on_screen: {
      type: 'noul' as const,
      instructions:
        'Compare active_goal against the live screenshot. IF all browsing/navigation steps are done and the answer/target content is now visible on screen ready for the Brain to write the final response -> true. ELSE -> false.',
      criteria: {
        true_description: 'The goal content is now visible on screen and ready for the Brain to summarize/finish.',
        false_description: 'More browsing, scrolling, typing, or clicking is still needed before the goal is complete.',
      },
    },
    q5_next_action: {
      type: 'choice' as const,
      instructions: [
        'Pick the SINGLE best next action for the browser given the live screenshot and active_goal using strict IF / ELSE:',
        '1) IF q3_human_auth_or_captcha_gate is true -> PAUSE_HUMAN_GATE.',
        '2) ELSE IF active_goal is null OR q1_prompt_needs_brain is true OR q2_needs_text_gen_or_summary is true OR q4_goal_achieved_on_screen is true -> ROUTE_TO_BRAIN.',
        '3) ELSE IF an obvious button, link, or input on screen advances active_goal (use type_pending: if typing a pending_inputs value, or click:el-X to click an element, or ACTION_SCROLL_DOWN / ACTION_PRESS_ENTER / ACTION_PRESS_ESCAPE / PLANNED_STEP) -> pick that exact action option.',
        '4) ELSE -> ROUTE_TO_BRAIN.',
      ].join('\n'),
      criteria: actionCriteria,
    },
  };

  let decisionRawResponse: any = null;
  let decisionApiError: string | null = null;

  try {
    decisionRawResponse = await ai.decisions.create(
      {
        api_version: 'v1beta',
        model: 'gemini-decision-1',
        input: decisionInput,
        questions,
      },
      {
        timeout_ms: 4500,
        retries: { strategy: 'none' },
        maxRetries: 0,
      }
    );
  } catch (err: any) {
    decisionApiError = err?.message || 'Unknown gemini-decision-1 error';
    console.warn('[DecisionGate] gemini-decision-1 call failed, routing safely to Brain:', decisionApiError);
  }

  const latencyMs = Date.now() - startedAt;
  const answers = decisionRawResponse?.answers || {};

  const q1 = answers.q1_prompt_needs_brain?.type === 'noul' ? answers.q1_prompt_needs_brain : null;
  const q2 = answers.q2_needs_text_gen_or_summary?.type === 'noul' ? answers.q2_needs_text_gen_or_summary : null;
  const q3 = answers.q3_human_auth_or_captcha_gate?.type === 'noul' ? answers.q3_human_auth_or_captcha_gate : null;
  const q4 = answers.q4_goal_achieved_on_screen?.type === 'noul' ? answers.q4_goal_achieved_on_screen : null;
  const q5 = answers.q5_next_action?.type === 'choice' ? answers.q5_next_action : null;

  const selectedOption = q5?.choice;
  const selectedConfidence = typeof q5?.confidence === 'number' ? q5.confidence : 0;

  // Helper to convert selectedOption -> BrowserAction
  const resolveOptionToAction = (
    opt?: string
  ): {
    action?: BrowserAction;
    consumedPendingInputIndex?: number;
    consumedPlannedStep?: boolean;
  } => {
    if (!opt) return {};
    if (opt === 'ACTION_SCROLL_DOWN') {
      return { action: { type: 'scroll', direction: 'down', amount: 500, summary: 'Decision-1: Scroll down 500px' } };
    }
    if (opt === 'ACTION_SCROLL_UP') {
      return { action: { type: 'scroll', direction: 'up', amount: 500, summary: 'Decision-1: Scroll up 500px' } };
    }
    if (opt === 'ACTION_PRESS_ENTER') {
      return { action: { type: 'press_key', key: 'Enter', summary: 'Decision-1: Press Enter' } };
    }
    if (opt === 'ACTION_PRESS_ESCAPE') {
      return { action: { type: 'press_key', key: 'Escape', summary: 'Decision-1: Press Escape' } };
    }
    if (opt === 'ACTION_WAIT') {
      return { action: { type: 'wait', summary: 'Decision-1: Wait for page load' } };
    }
    if (opt === 'PLANNED_STEP' && plannedStep) {
      return { action: plannedStep.action, consumedPlannedStep: true };
    }
    if (opt.startsWith('type_pending:')) {
      const binding = pendingInputBindings.get(opt);
      if (binding) {
        const el = elementMap.get(binding.elementId);
        return {
          action: {
            type: 'type',
            target: binding.elementId,
            value: binding.value,
            submit: binding.submit,
            summary: `Decision-1: Type "${binding.value}" into [${binding.elementId}] ${el?.label || el?.role || ''}`.trim(),
          },
          consumedPendingInputIndex: binding.pendingIndex,
        };
      }
    }
    if (opt.startsWith('click:')) {
      const elId = opt.slice('click:'.length);
      const el = elementMap.get(elId);
      if (el) {
        return {
          action: {
            type: 'click',
            target: el.id,
            summary: `Decision-1: Click [${el.id}] ${el.role} "${el.label || 'element'}"`,
          },
        };
      }
    }
    return {};
  };

  // Deterministic IF / ELSE safety guardrails around gemini-decision-1
  let finalRoute: DecisionRoute;
  let escalationReason: string;
  let resolvedAction: BrowserAction | undefined;
  let consumedPendingInputIndex: number | undefined;
  let consumedPlannedStep = false;
  let plannedStepRequiresBrainAfter = false;

  const isRepeatedSameAction = Boolean(
    selectedOption &&
      activeTask?.last_action_key === selectedOption &&
      activeTask?.last_tree_sig === treeSignature
  );
  const effectiveStagnant = isRepeatedSameAction ? stagnantCount + 1 : 0;

  if (decisionApiError) {
    finalRoute = 'ROUTE_BRAIN_PLAN_OR_TEXT';
    escalationReason = `Decision-1 fallback (${decisionApiError}); routing to Brain.`;
  } else if (isNewOrNonResumePrompt) {
    finalRoute = 'ROUTE_BRAIN_PLAN_OR_TEXT';
    escalationReason = 'New user directive requires Brain intent parsing and goal planning.';
  } else if (!activeTask) {
    finalRoute = 'ROUTE_BRAIN_PLAN_OR_TEXT';
    escalationReason = 'No active task registered; routing to Brain to establish goal.';
  } else if (forceBrainNext) {
    finalRoute = 'ROUTE_BRAIN_PLAN_OR_TEXT';
    escalationReason = 'Brain inspection checkpoint reached (requires_brain_after).';
  } else if (lastActionFailed || retryCount >= MAX_RETRY_BEFORE_BRAIN) {
    finalRoute = 'ROUTE_BRAIN_ERROR_RECOVERY';
    escalationReason = `Previous action failed or retries (${retryCount}) exceeded; routing to Brain for error recovery.`;
  } else if (effectiveStagnant >= MAX_STAGNANT_REPEATS) {
    finalRoute = 'ROUTE_BRAIN_ERROR_RECOVERY';
    escalationReason = `Action "${selectedOption}" repeated without page progress; routing to Brain for recovery.`;
  } else if (consecutiveFastSteps >= MAX_CONSECUTIVE_FAST_STEPS) {
    finalRoute = 'ROUTE_BRAIN_PLAN_OR_TEXT';
    escalationReason = `Reached ${MAX_CONSECUTIVE_FAST_STEPS} consecutive Decision-1 steps; Brain checkpoint for verification.`;
  } else if (
    (q3 && q3.noul >= 0.78) ||
    (selectedOption === 'PAUSE_HUMAN_GATE' && selectedConfidence >= 0.5)
  ) {
    finalRoute = 'FAST_PAUSE_HUMAN_GATE';
    escalationReason = `Decision-1 detected login/2FA/CAPTCHA wall (q3=${q3?.noul?.toFixed(2) ?? 'n/a'}).`;
  } else if (
    selectedOption === 'ROUTE_TO_BRAIN' ||
    (q1 && q1.noul >= 0.5) ||
    (q2 && q2.noul >= 0.6) ||
    (q4 && q4.noul >= 0.7)
  ) {
    finalRoute = 'ROUTE_BRAIN_PLAN_OR_TEXT';
    escalationReason = `Decision-1 escalated to Brain (choice=${selectedOption ?? 'none'}, q2_text=${q2?.noul?.toFixed(2) ?? 'n/a'}, q4_done=${q4?.noul?.toFixed(2) ?? 'n/a'}).`;
  } else {
    const resolved = resolveOptionToAction(selectedOption);
    if (resolved.action && selectedConfidence >= MIN_ACTION_CHOICE_CONFIDENCE) {
      finalRoute = 'FAST_EXECUTE_ACTION';
      resolvedAction = resolved.action;
      consumedPendingInputIndex = resolved.consumedPendingInputIndex;
      consumedPlannedStep = Boolean(resolved.consumedPlannedStep);
      plannedStepRequiresBrainAfter = Boolean(consumedPlannedStep && plannedStep?.requires_brain_after);
      escalationReason = `Decision-1 selected ${selectedOption} (conf=${selectedConfidence.toFixed(2)}) directly from live viewport & DOM.`;
    } else {
      finalRoute = 'ROUTE_BRAIN_PLAN_OR_TEXT';
      escalationReason = `Decision-1 action confidence too low or unmapped (choice=${selectedOption ?? 'none'}, conf=${selectedConfidence.toFixed(2)}); escalating to Brain.`;
    }
  }

  const fastExecuted = finalRoute === 'FAST_EXECUTE_ACTION' || finalRoute === 'FAST_PAUSE_HUMAN_GATE';
  const routedToBrain = !fastExecuted;

  const telemetry: DecisionGateTelemetry = {
    model: 'gemini-decision-1',
    route: finalRoute,
    fastExecuted,
    routedToBrain,
    selectedOption,
    escalationReason,
    latencyMs,
    answers,
  };

  return {
    route: finalRoute,
    fastExecuted,
    routedToBrain,
    escalationReason,
    selectedOption,
    resolvedAction,
    consumedPendingInputIndex,
    consumedPlannedStep,
    plannedStepRequiresBrainAfter,
    currentStepIndex,
    consecutiveFastSteps,
    stagnantCount: effectiveStagnant,
    treeSignature,
    retryCount,
    latencyMs,
    decisionInputSummary: {
      model: 'gemini-decision-1',
      api_version: 'v1beta',
      hasScreenshot: Boolean(screenshotPart),
      liveChoiceCount: Object.keys(actionCriteria).length,
      state: structuredState,
      questions: {
        ...questions,
        q5_next_action: {
          type: 'choice',
          instructions: questions.q5_next_action.instructions,
          optionsCount: Object.keys(actionCriteria).length,
          sampleOptions: Object.fromEntries(Object.entries(actionCriteria).slice(0, 15)),
        },
      },
    },
    decisionRawResponse: decisionRawResponse || { error: decisionApiError },
    telemetry,
  };
}
