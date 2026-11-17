import express from 'express';
import type { Request, Response } from 'express';
import { createServer as createViteServer } from 'vite';
import http from 'http';
import dotenv from 'dotenv';
import path from 'path';
import { GoogleGenAI, Type } from '@google/genai';
import AdmZip from 'adm-zip';
import { chromiumManager } from './chromiumManager.ts';
import { extensionManager } from './extensionManager.ts';
import { evaluateDecisionGate } from './decisionGate.ts';

dotenv.config();

const app = express();
const server = http.createServer(app);
const PORT = 3000;

app.use(express.json({ limit: '25mb' }));

// Allow Firefox extension sidebar and popup to communicate freely with CORS + credentials
app.use((req, res, next) => {
  res.removeHeader('X-Frame-Options');
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

// Helper to determine the active browser target (Local Firefox via Extension vs Cloud Chromium)
function getActiveBrowserManager() {
  if (extensionManager.getActiveTarget() === 'extension' && extensionManager.isConnected()) {
    return extensionManager;
  }
  return chromiumManager;
}

// --- Firefox Extension Bridge Endpoints ---

// Check connection status & active target
app.get('/api/extension/status', (_req: Request, res: Response) => {
  return res.json({
    connected: extensionManager.isConnected(),
    target: extensionManager.getActiveTarget(),
    clientInfo: extensionManager.getClientInfo(),
  });
});

// Toggle target (Cloud Chromium vs Local Firefox)
app.post('/api/extension/target', (req: Request, res: Response) => {
  const { target } = req.body;
  if (target === 'cloud' || target === 'extension') {
    extensionManager.setActiveTarget(target);
  }
  return res.json({
    success: true,
    target: extensionManager.getActiveTarget(),
    connected: extensionManager.isConnected(),
    clientInfo: extensionManager.getClientInfo(),
  });
});

// Long-polling endpoint for Firefox Extension background script
app.post('/api/extension/poll', async (req: Request, res: Response) => {
  try {
    extensionManager.registerClient(req.body);
    const command = await extensionManager.pollNextCommand(25000);
    return res.json({ command });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Response endpoint for Firefox Extension
app.post('/api/extension/respond', (req: Request, res: Response) => {
  try {
    const { commandId, result, error } = req.body;
    const handled = extensionManager.handleCommandResponse(commandId, result, error);
    return res.json({ success: handled });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Heartbeat endpoint for Firefox Extension
app.post('/api/extension/heartbeat', (req: Request, res: Response) => {
  try {
    const { activeTabTitle, activeTabUrl } = req.body || {};
    if (!extensionManager.getClientInfo()) {
      extensionManager.registerClient(req.body || {});
    } else {
      extensionManager.updateHeartbeat(activeTabTitle, activeTabUrl);
    }
    return res.json({
      success: true,
      connected: extensionManager.isConnected(),
      target: extensionManager.getActiveTarget(),
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Download Firefox Extension as a ready-to-load .zip file with the active origin URL baked in
app.get('/api/extension/download', (req: Request, res: Response) => {
  try {
    const extDir = path.join(process.cwd(), 'firefox-extension');
    const zip = new AdmZip();
    zip.addLocalFolder(extDir);

    const proto = (req.headers['x-forwarded-proto'] as string)?.split(',')[0]?.trim() || req.protocol || 'https';
    const host = (req.headers['x-forwarded-host'] as string)?.split(',')[0]?.trim() || req.get('host');
    if (host) {
      const origin = `${proto}://${host}`;
      const urlRegex = /https:\/\/ais-[a-zA-Z0-9-]+\.[a-zA-Z0-9.-]+\.run\.app/g;
      for (const fileName of ['background.js', 'sidebar.js', 'popup.js']) {
        const entry = zip.getEntry(fileName);
        if (entry) {
          const content = entry.getData().toString('utf8').replace(urlRegex, origin);
          zip.updateFile(fileName, Buffer.from(content, 'utf8'));
        }
      }
    }

    const zipBuffer = zip.toBuffer();

    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="firefox-agent-bridge.zip"',
      'Content-Length': zipBuffer.length.toString(),
    });
    return res.send(zipBuffer);
  } catch (err: any) {
    console.error('Failed to create extension zip:', err);
    return res.status(500).json({ error: err.message });
  }
});

// --- Stealth Tunnel & Proxy Management Endpoints ---

app.get('/api/health', (_req: Request, res: Response) => {
  return res.json({ ok: true, status: 'healthy' });
});

app.get('/api/proxy/status', (_req: Request, res: Response) => {
  try {
    const proxyConfig = chromiumManager.getProxyConfig();
    return res.json({
      success: true,
      proxyConfig,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/proxy/configure', async (req: Request, res: Response) => {
  try {
    const { enabled, server, username, password } = req.body || {};
    const wantEnabled = Boolean(enabled);

    if (wantEnabled && !String(server || '').trim()) {
      return res.json({
        success: false,
        proxyConfig: chromiumManager.getProxyConfig(),
        error: 'Enter a Proxy Server URL first (for example http://bore.pub:12345).',
      });
    }

    const result = await chromiumManager.setProxyConfig({
      enabled: wantEnabled,
      server: wantEnabled ? String(server || '') : String(server || ''),
      username: username || '',
      password: password || '',
    });

    return res.json({
      success: result.success,
      proxyConfig: chromiumManager.getProxyConfig(),
      ipInfo: result.ipInfo,
      error: result.error,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/proxy/test', async (_req: Request, res: Response) => {
  try {
    const ipInfo = await chromiumManager.checkEgressIp();
    return res.json({
      success: true,
      ipInfo,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// 1. Get Live Browser State (from active manager: Local Firefox or Cloud Chromium)
app.get('/api/firefox/state', async (_req: Request, res: Response) => {
  try {
    const manager = getActiveBrowserManager();
    const state = await manager.getState();
    const isExtension = manager === extensionManager;
    return res.json({
      success: true,
      ...state,
      isLocalBrowser: isExtension,
      isChromium: !isExtension,
      clientName: isExtension ? 'Firefox on antiX Linux' : 'Cloud Stealth Engine (Patchright)',
      activeTarget: extensionManager.getActiveTarget(),
      isExtensionConnected: extensionManager.isConnected(),
    });
  } catch (err: any) {
    console.error('Failed to get browser state:', err);
    // If extension failed, provide fallback
    if (extensionManager.getActiveTarget() === 'extension') {
      try {
        const fallbackState = await chromiumManager.getState();
        return res.json({
          success: true,
          ...fallbackState,
          isLocalBrowser: false,
          isChromium: true,
          activeTarget: 'extension',
          isExtensionConnected: false,
          warning: 'Firefox extension disconnected, displaying Cloud Chromium state.',
        });
      } catch (_) {}
    }
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 2. Direct Browser Operations (Dispatched to active manager)
app.post('/api/firefox/action', async (req: Request, res: Response) => {
  try {
    const manager = getActiveBrowserManager();
    const { action, ...params } = req.body;

    if (action === 'navigate') {
      const state = await manager.navigate(params.url);
      return res.json({ success: true, state });
    }

    if (action === 'open_tab') {
      const state = await manager.openTab(params.url);
      return res.json({ success: true, state });
    }

    if (action === 'switch_tab') {
      const state = await manager.switchTab(params.tab_id);
      return res.json({ success: true, state });
    }

    if (action === 'close_tab') {
      const state = await manager.closeTab(params.tab_id);
      return res.json({ success: true, state });
    }

    if (action === 'click') {
      const result = await manager.click(params.target);
      return res.json(result);
    }

    if (action === 'right_click') {
      const result = await manager.rightClick(params.target);
      return res.json(result);
    }

    if (action === 'hover') {
      const result = await manager.hover(params.target);
      return res.json(result);
    }

    if (action === 'press_key') {
      const result = await manager.pressKey(params.key);
      return res.json(result);
    }

    if (action === 'drag_and_drop') {
      const result = await manager.dragAndDrop(params.source, params.target);
      return res.json(result);
    }

    if (action === 'mouse_click') {
      if ('mouseClickCoordinates' in manager) {
        const state = await (manager as any).mouseClickCoordinates(params.x, params.y);
        return res.json({ success: true, state });
      }
      const state = await (manager as typeof chromiumManager).getState();
      return res.json({ success: true, state });
    }

    if (action === 'keyboard_type') {
      if ('keyboardType' in manager) {
        const state = await (manager as any).keyboardType(params.text || '');
        return res.json({ success: true, state });
      }
      const state = await (manager as typeof chromiumManager).getState();
      return res.json({ success: true, state });
    }

    if (action === 'keyboard_press') {
      if ('keyboardPress' in manager) {
        const state = await (manager as any).keyboardPress(params.key || 'Enter');
        return res.json({ success: true, state });
      }
      const result = await (manager as typeof chromiumManager).pressKey(params.key || 'Enter');
      return res.json(result);
    }

    if (action === 'clear_input') {
      if ('clearFocusedInput' in manager) {
        const state = await (manager as any).clearFocusedInput();
        return res.json({ success: true, state });
      }
      const state = await (manager as typeof chromiumManager).getState();
      return res.json({ success: true, state });
    }

    if (action === 'type') {
      const result = await manager.type(params.target, params.value, params.submit);
      return res.json(result);
    }

    if (action === 'scroll') {
      const state = await manager.scroll(params.direction, params.amount);
      return res.json({ success: true, state });
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });
  } catch (err: any) {
    console.error('Failed to execute browser action:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

async function executeBrowserAction(browserManager: any, act: any): Promise<{
  executionResult: any;
  updatedBrowserState: any;
  failed: boolean;
  errorMessage?: string;
}> {
  let executionResult: any = null;
  let updatedBrowserState: any = null;
  let failed = false;
  let errorMessage: string | undefined;

  if (act) {
    try {
      if (act.type === 'click' && act.target) {
        executionResult = await browserManager.click(act.target);
      } else if (act.type === 'right_click' && act.target) {
        executionResult = await browserManager.rightClick(act.target);
      } else if (act.type === 'hover' && act.target) {
        executionResult = await browserManager.hover(act.target);
      } else if (act.type === 'press_key' && act.key) {
        executionResult = await browserManager.pressKey(act.key);
      } else if (act.type === 'drag_and_drop' && act.source && act.target) {
        executionResult = await browserManager.dragAndDrop(act.source, act.target);
      } else if (act.type === 'type' && act.target) {
        const cleanValue = (act.value || '').replace(/\s+/g, ' ').trim();
        act.value = cleanValue;
        executionResult = await browserManager.type(act.target, cleanValue, act.submit);
      } else if (act.type === 'scroll') {
        updatedBrowserState = await browserManager.scroll(act.direction || 'down', act.amount || 400);
      } else if (act.type === 'navigate' && act.url) {
        updatedBrowserState = await browserManager.navigate(act.url);
      } else if (act.type === 'open_tab' && act.url) {
        updatedBrowserState = await browserManager.openTab(act.url);
      } else if (act.type === 'switch_tab' && act.tab_id) {
        updatedBrowserState = await browserManager.switchTab(act.tab_id);
      } else if (act.type === 'close_tab' && act.tab_id) {
        updatedBrowserState = await browserManager.closeTab(act.tab_id);
      } else if (act.type === 'wait') {
        await new Promise((r) => setTimeout(r, 1000));
      }

      if (executionResult && executionResult.success === false) {
        failed = true;
        errorMessage = executionResult.error || 'Action returned success=false';
      }
    } catch (execErr: any) {
      console.warn('Browser action execution error:', execErr);
      failed = true;
      errorMessage = execErr?.message || 'Browser action execution threw error';
    }
  }

  if (!updatedBrowserState) {
    updatedBrowserState = await browserManager.getState().catch(() => null);
  }

  return { executionResult, updatedBrowserState, failed, errorMessage };
}

function normalizePlannedSteps(rawSteps: any): any[] {
  if (!Array.isArray(rawSteps)) return [];
  return rawSteps
    .filter((s) => s && typeof s === 'object' && s.action_type)
    .map((s, idx) => {
      const type = String(s.action_type || 'wait').trim();
      const targetOrUrl = s.target_or_url ? String(s.target_or_url).trim() : '';
      const valOrDir = s.value_or_direction ? String(s.value_or_direction).trim() : '';
      const action: any = {
        type,
        summary: String(s.description || `${type} step ${idx + 1}`),
      };
      if (type === 'navigate' || type === 'open_tab') {
        action.url = targetOrUrl;
      } else if (type === 'switch_tab' || type === 'close_tab') {
        action.tab_id = targetOrUrl;
      } else if (type === 'scroll') {
        action.direction = valOrDir === 'up' ? 'up' : 'down';
        action.amount = 500;
      } else if (type === 'press_key') {
        action.key = valOrDir || 'Enter';
      } else if (type === 'type') {
        action.target = targetOrUrl;
        action.value = valOrDir;
        action.submit = Boolean(s.submit);
      } else if (targetOrUrl) {
        action.target = targetOrUrl;
      }

      return {
        id: String(s.id || `step-${idx + 1}`),
        description: String(s.description || action.summary),
        action,
        expected_visual_state: s.expected_visual_state ? String(s.expected_visual_state) : undefined,
        requires_brain_after: Boolean(s.requires_brain_after),
      };
    });
}

// 3. Autonomous Agent Step (gemini-decision-1 Gatekeeper -> Brain LLM Loop)
app.post('/api/agent/step', async (req: Request, res: Response) => {
  try {
    const {
      user_prompt = '',
      myself = false,
      timestamp = new Date().toISOString(),
      history = [],
      active_task = null,
      agent_memory = null,
      execute_action = true,
    } = req.body;

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'GEMINI_API_KEY is not configured in environment variables' });
    }

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    // Determine target browser manager (explicit request target takes precedence for extension sidebar)
    const requestedTarget = req.body?.target;
    if (requestedTarget === 'extension' && !extensionManager.isConnected()) {
      return res.status(400).json({
        error: 'Firefox extension is not connected to this server yet. Open Settings in the sidebar to verify the server URL.',
        agent_text: 'Firefox extension is not connected to this server yet. Check the server URL in Settings and try again.',
        task_status: 'stop',
        should_call_myself: false,
      });
    }

    const t0 = Date.now();
    const browserManager =
      requestedTarget === 'extension'
        ? extensionManager
        : requestedTarget === 'cloud'
        ? chromiumManager
        : getActiveBrowserManager();
    const currentLiveState = await browserManager.getState();
    const tState = Date.now() - t0;
    const currentUrl = currentLiveState.url;
    const currentTitle = currentLiveState.title;
    const activeTabId = currentLiveState.activeTabId;
    const tabsList = currentLiveState.tabs;

    // Step 1: EVERY request first hits gemini-decision-1 (with live screenshot + structured state)
    const gate = await evaluateDecisionGate(ai, {
      userPrompt: user_prompt,
      myself,
      activeTask: active_task,
      currentLiveState,
      history,
    });
    console.log(`[AgentStep] getState=${tState}ms gate=${gate.latencyMs}ms route=${gate.route} reason="${gate.escalationReason}"`);

    const isChromium = browserManager === chromiumManager;
    const isLocalBrowser = browserManager === extensionManager;
    const clientName = isLocalBrowser ? 'Firefox on antiX Linux' : 'Cloud Stealth Engine (Patchright)';

    // FAST PATH A: Human Auth / CAPTCHA Gate detected by gemini-decision-1
    if (gate.route === 'FAST_PAUSE_HUMAN_GATE') {
      const pausedTask = active_task
        ? { ...active_task, status: 'pause', last_url: currentUrl }
        : {
            title: 'Human Verification Required',
            summary: 'Paused for sign-in, 2FA, or CAPTCHA verification.',
            approach: 'Wait for user verification, then resume plan.',
            status: 'pause',
            last_url: currentUrl,
          };

      return res.json({
        thought: `Decision-1 Gate detected a login/CAPTCHA wall on ${currentUrl}. Pausing without calling Brain LLM.`,
        visual_summary: `Verification gate visible at "${currentTitle}" (${currentUrl}).`,
        agent_text: 'I detected a login, 2FA, or verification gate on the page. Please complete it in the browser viewport and click Resume when ready.',
        action: { type: 'wait', summary: 'Paused for human verification' },
        should_call_myself: false,
        task: pausedTask,
        task_status: 'pause',
        agent_memory: agent_memory || { working_notes: [], facts: [], candidates: [] },
        should_bother_user: true,
        decisionGate: gate.telemetry,
        timestamp: new Date().toISOString(),
        executionResult: null,
        browserState: currentLiveState,
        isChromium,
        isLocalBrowser,
        clientName,
        modelInputInspector: {
          timestamp: new Date().toISOString(),
          model: 'gemini-decision-1 (Fast Gate)',
          hasScreenshot: Boolean(gate.decisionInputSummary?.hasScreenshot),
          screenshotPreview: currentLiveState?.screenshotBase64 || null,
          userPrompt: user_prompt || '(None - autonomous step)',
          myself,
          activeTask: pausedTask,
          agentMemory: agent_memory || null,
          decisionGate: gate.telemetry,
          accessibilityTree: currentLiveState?.accessibilityTree || '',
          fullSystemInstruction: 'Evaluated by gemini-decision-1 IF-ELSE gatekeeper (FAST_PAUSE_HUMAN_GATE).',
          fullCurrentTurnPrompt: JSON.stringify(gate.decisionInputSummary?.state || {}, null, 2),
          chatHistory: [],
          recentHistoryCount: Array.isArray(history) ? history.length : 0,
          rawInputJson: gate.decisionInputSummary,
          rawOutputJson: gate.decisionRawResponse,
        },
      });
    }

    // FAST PATH B: Execute live UI action chosen directly by gemini-decision-1 without calling Brain LLM
    if (gate.route === 'FAST_EXECUTE_ACTION' && gate.resolvedAction) {
      const fastAction = gate.resolvedAction;
      const execOutcome = execute_action
        ? await executeBrowserAction(browserManager, fastAction)
        : { executionResult: null, updatedBrowserState: currentLiveState, failed: false };

      const planSteps = Array.isArray(active_task?.plan_steps) ? active_task.plan_steps : [];
      const nextStepIndex = gate.consumedPlannedStep ? gate.currentStepIndex + 1 : gate.currentStepIndex;

      const existingPending = Array.isArray(active_task?.pending_inputs) ? active_task.pending_inputs : [];
      const nextPending =
        !execOutcome.failed && typeof gate.consumedPendingInputIndex === 'number'
          ? existingPending.filter((_: any, idx: number) => idx !== gate.consumedPendingInputIndex)
          : existingPending;

      const updatedTask = {
        ...active_task,
        status: 'processing',
        pending_inputs: nextPending,
        plan_steps: planSteps,
        current_step_index: nextStepIndex,
        consecutive_fast_steps: execOutcome.failed ? 0 : gate.consecutiveFastSteps + 1,
        stagnant_count: gate.stagnantCount,
        last_action_key: gate.selectedOption || undefined,
        last_tree_sig: gate.treeSignature,
        retry_count: execOutcome.failed ? gate.retryCount + 1 : 0,
        last_action_failed: execOutcome.failed,
        last_url: execOutcome.updatedBrowserState?.url || currentUrl,
        force_brain_next: Boolean(gate.plannedStepRequiresBrainAfter) || execOutcome.failed,
      };

      const stepCounter = gate.consecutiveFastSteps + 1;

      return res.json({
        thought: `[Decision-1 Autonomous Action • ${gate.latencyMs}ms] ${gate.escalationReason}`,
        visual_summary: `Decision-1 selected ${gate.selectedOption || fastAction.type} on "${currentTitle}" (${currentUrl}).`,
        agent_text: execOutcome.failed
          ? `⚡ Decision-1 (${gate.selectedOption}) encountered an issue (${execOutcome.errorMessage || 'action failed'}); routing to Brain.`
          : `⚡ [Fast Step ${stepCounter}] ${fastAction.summary}`,
        action: fastAction,
        should_call_myself: true,
        task: updatedTask,
        task_status: 'processing',
        agent_memory: agent_memory || { working_notes: [], facts: [], candidates: [] },
        should_bother_user: false,
        decisionGate: gate.telemetry,
        timestamp: new Date().toISOString(),
        executionResult: execOutcome.executionResult,
        browserState: execOutcome.updatedBrowserState,
        isChromium,
        isLocalBrowser,
        clientName,
        modelInputInspector: {
          timestamp: new Date().toISOString(),
          model: 'gemini-decision-1 (Autonomous Action)',
          hasScreenshot: Boolean(gate.decisionInputSummary?.hasScreenshot),
          screenshotPreview: currentLiveState?.screenshotBase64 || null,
          userPrompt: user_prompt || '(None - autonomous step)',
          myself,
          activeTask: updatedTask,
          agentMemory: agent_memory || null,
          decisionGate: gate.telemetry,
          accessibilityTree: currentLiveState?.accessibilityTree || '',
          fullSystemInstruction: 'Executed directly by gemini-decision-1 over live viewport + dynamic Accessibility Tree choices (0 Brain LLM tokens).',
          fullCurrentTurnPrompt: JSON.stringify(gate.decisionInputSummary?.state || {}, null, 2),
          chatHistory: [],
          recentHistoryCount: Array.isArray(history) ? history.length : 0,
          rawInputJson: gate.decisionInputSummary,
          rawOutputJson: gate.decisionRawResponse,
        },
      });
    }

    // BRAIN PATH: Routed to fast low-cost LLM (gemini-3.1-flash-lite) for planning, text generation, or complex error recovery
    const systemInstruction = `
You are the BRAIN (System 2 planner, text generator, and error-recovery LLM) of a dual-model autonomous Chromium/Firefox Browser Agent.
Every turn first passes through a fast multimodal Decision Model ('gemini-decision-1') that can see the live screenshot AND pick clickable buttons, inputs, and scroll actions directly on unseen pages WITHOUT calling you.
'gemini-decision-1' routed THIS turn to you because planning, dynamic text generation, summarizing/answering the user, or error recovery is needed.

### ABSOLUTE AGENT INDEPENDENCE & PROACTIVE BROWSING (CRITICAL):
You have full physical control over a REAL Browser Engine via hardware actions (clicks, typing, navigation, tab switching).
1. **NO HELPLESS QUESTIONS — DECIDE AND ACT INDEPENDENTLY**:
   - NEVER ask "which website should I use?" or "what URL would you like me to visit?". Pick the premier site immediately (Amazon, Walmart, Wikipedia, DuckDuckGo, Hacker News, etc.) and navigate.
   - If you genuinely need human-only credentials/2FA/CAPTCHA, set "task_status": "pause", "should_call_myself": false, "should_bother_user": true.

2. **ACTIVE BROWSING & EXPLORATION**:
   - Never grab just the first search result when asked to compare or find cheapest/best items. Scroll down, inspect 3–5 candidates, store them in 'agent_memory.candidates', and synthesize evidence-based answers.

3. **EMPOWERS DECISION-1 TO KEEP RUNNING WITHOUT YOU ('task.pending_inputs' & 'task.plan_steps')**:
   - After you take your immediate 'action' on this turn, 'gemini-decision-1' will take over the loop on subsequent turns (clicking links/buttons, scrolling, pressing Enter) WITHOUT calling you until text generation/summarization or recovery is needed.
   - Whenever the upcoming browsing steps need specific text typed into a search bar or form field on a page that hasn't loaded yet, put those values in 'task.pending_inputs': [{ field_hint, value, submit }]. That lets 'gemini-decision-1' match the value to the right input box on the next page by itself!
   - You can also optionally put predictable non-DOM steps (like wait or scroll) in 'task.plan_steps'. Leave 'plan_steps: []' when 'gemini-decision-1' should freely pick buttons/links from the next page.

4. **TASK LIFECYCLE REASONING**:
   - **Topic Switch / Reassignment**: If user prompt introduces a new task or says "forget this / instead / switch to...", immediately drop the old task, clear/reset 'plan_steps', overwrite 'task' with the new goal, and execute step 1.
   - **Error Recovery**: If 'gemini-decision-1' escalated for error recovery (e.g., modal blocking, missing element, failed click), inspect the screenshot, dismiss overlays or choose an alternative element/URL, and rebuild 'plan_steps'.
   - **Text Generation & Completion**: When all information is gathered or the user simply asked a text question, set 'action.type' to "finish", 'task_status' to "stop", 'should_call_myself' to false, 'plan_steps' to [], and write a rich, accurate answer in 'agent_text'.

5. **INTERNAL AGENT WORKING MEMORY ('agent_memory')**:
   - Persist useful 'working_notes', 'facts', and 'candidates' across turns.

### HOW TO INTERACT WITH ELEMENTS:
- click / right_click / hover: target = element id like "el-17"
- type: target = "el-17", value = single-line text, submit = true/false
- press_key: key = "Enter" | "Escape" | "Tab" | "ArrowDown" | "ArrowUp" | "Backspace"
- drag_and_drop: source = "el-5", target = "el-20"
- navigate: url = full URL or search query
- open_tab: url
- switch_tab / close_tab: tab_id
- scroll: direction = "down" | "up", amount = number (e.g. 500)
- wait: pauses briefly
- finish: completes task and delivers final 'agent_text'

### STRICT RULES:
1. Always write 'thought' and 'visual_summary' first before specifying 'action'.
2. Perform ONE immediate 'action' per turn, using only element IDs present in the current Accessibility Tree.
3. Keep 'action.value' concise and on ONE line.
4. Return strict valid JSON matching the schema.
`;

    const contents: any[] = [];
    const exactChatHistoryPayload: any[] = [];

    if (Array.isArray(history) && history.length > 0) {
      const recentHistory = history.slice(-6);
      for (const turn of recentHistory) {
        if (turn.role === 'user') {
          const userEntry = {
            role: 'user',
            parts: [{ text: `User: ${turn.text || '[No prompt]'}` }],
          };
          contents.push(userEntry);
          exactChatHistoryPayload.push(userEntry);
        } else if (turn.role === 'agent') {
          const agentEntry = {
            role: 'model',
            parts: [
              {
                text: JSON.stringify({
                  thought: turn.thought || '',
                  visual_summary: turn.visual_summary || '',
                  agent_text: turn.agent_text || '',
                  action: turn.action,
                  task_status: turn.task_status,
                  should_call_myself: turn.should_call_myself,
                }),
              },
            ],
          };
          contents.push(agentEntry);
          exactChatHistoryPayload.push(agentEntry);
        }
      }
    }

    const currentTurnPrompt = `
=== CURRENT INVOCATION ===
[myself]: ${myself ? 'true (Autonomous continuation)' : 'false (User initiated)'}
[timestamp]: ${timestamp}
[user_prompt]: ${user_prompt || '(None - autonomous step)'}

[DECISION GATE ESCALATION CONTEXT (from gemini-decision-1)]:
- Route: ${gate.route}
- Escalation Reason: ${gate.escalationReason}
- Decision Latency: ${gate.latencyMs}ms

[REAL BROWSER STATE]:
- Active Tab: ${activeTabId}
- Current Title: "${currentTitle}"
- Current URL: ${currentUrl}
- Open Tabs:
${tabsList.map((t) => `  * [${t.id}] "${t.title}" (${t.url})${t.id === activeTabId ? ' <CURRENT ACTIVE TAB>' : ''}`).join('\n')}

[ACTIVE TASK STATE]:
${active_task ? JSON.stringify(active_task, null, 2) : 'No task registered. Create a clear task, strategic approach, and optional follow-up plan_steps.'}

[AGENT WORKING MEMORY / SCRATCHPAD]:
${agent_memory ? JSON.stringify(agent_memory, null, 2) : '(Empty - initialize if tracking findings/candidates)'}

[COMPACT ACCESSIBILITY TREE]:
${currentLiveState?.accessibilityTree || '(No accessibility elements found)'}

Decide your immediate next 'action', updated 'task' (including 'plan_steps' if predictable follow-up steps exist, or [] if Brain should inspect next turn), updated 'agent_memory', 'agent_text', 'should_call_myself', 'task_status', and 'should_bother_user'.
Return valid JSON.
`;

    const userParts: any[] = [];
    let hasScreenshot = false;
    if (currentLiveState?.screenshotBase64 && currentLiveState.screenshotBase64.startsWith('data:image/')) {
      const match = currentLiveState.screenshotBase64.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
      if (match) {
        userParts.push({
          inlineData: {
            mimeType: match[1],
            data: match[2],
          },
        });
        hasScreenshot = true;
      }
    }
    userParts.push({ text: currentTurnPrompt });

    contents.push({
      role: 'user',
      parts: userParts,
    });

    const brainModel = 'gemini-3.1-flash-lite';

    const actionSchema = {
      type: Type.OBJECT,
      properties: {
        type: { type: Type.STRING },
        target: { type: Type.STRING },
        source: { type: Type.STRING },
        key: { type: Type.STRING },
        value: { type: Type.STRING },
        url: { type: Type.STRING },
        direction: { type: Type.STRING },
        amount: { type: Type.NUMBER },
        tab_id: { type: Type.STRING },
        submit: { type: Type.BOOLEAN },
        summary: { type: Type.STRING },
      },
      required: ['type', 'summary'],
    };

    const responseSchema = {
      type: Type.OBJECT,
      properties: {
        thought: {
          type: Type.STRING,
          description:
            'Step-by-step reasoning BEFORE deciding action: 1) Visual observation of screen, 2) Escalation/error evaluation, 3) Why this immediate action & plan_steps were chosen',
        },
        visual_summary: {
          type: Type.STRING,
          description: 'Concise 1-2 sentence visual digest of the current page to preserve in history',
        },
        agent_text: {
          type: Type.STRING,
          description: 'Direct message to the user explaining what you did, found, or what happens next',
        },
        action: actionSchema,
        should_call_myself: { type: Type.BOOLEAN },
        task: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            summary: { type: Type.STRING },
            approach: { type: Type.STRING },
            status: { type: Type.STRING },
            pending_inputs: {
              type: Type.ARRAY,
              description:
                'Pre-planned text values for upcoming pages (e.g., search query or form input) so gemini-decision-1 can type them without calling the Brain.',
              items: {
                type: Type.OBJECT,
                properties: {
                  field_hint: { type: Type.STRING },
                  value: { type: Type.STRING },
                  submit: { type: Type.BOOLEAN },
                },
                required: ['field_hint', 'value'],
              },
            },
            plan_steps: {
              type: Type.ARRAY,
              description:
                'Optional queue of subsequent deterministic steps (starting at index 0 for the NEXT turn) that gemini-decision-1 can execute fast without calling the Brain.',
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  description: { type: Type.STRING },
                  action_type: { type: Type.STRING },
                  target_or_url: { type: Type.STRING },
                  value_or_direction: { type: Type.STRING },
                  submit: { type: Type.BOOLEAN },
                  requires_brain_after: { type: Type.BOOLEAN },
                },
                required: ['id', 'description', 'action_type'],
              },
            },
          },
          required: ['title', 'summary', 'approach', 'status'],
        },
        task_status: {
          type: Type.STRING,
          enum: ['processing', 'pause', 'stop'],
          description: 'Must be one of: processing, pause, stop',
        },
        agent_memory: {
          type: Type.OBJECT,
          properties: {
            working_notes: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            facts: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  key: { type: Type.STRING },
                  value: { type: Type.STRING },
                },
                required: ['key', 'value'],
              },
            },
            candidates: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING },
                  price: { type: Type.STRING },
                  source: { type: Type.STRING },
                  details: { type: Type.STRING },
                },
                required: ['name'],
              },
            },
          },
        },
        should_bother_user: { type: Type.BOOLEAN },
        timestamp: { type: Type.STRING },
      },
      required: [
        'thought',
        'visual_summary',
        'agent_text',
        'action',
        'should_call_myself',
        'task',
        'task_status',
        'should_bother_user',
        'timestamp',
      ],
    };

    const rawInputJson = {
      gatekeeper: gate.decisionInputSummary,
      brain: {
        model: brainModel,
        systemInstruction,
        contents: contents.map((c) => ({
          role: c.role,
          parts: c.parts.map((p: any) => {
            if (p.inlineData) {
              return {
                inlineData: {
                  mimeType: p.inlineData.mimeType,
                  dataLengthBytes: p.inlineData.data ? p.inlineData.data.length : 0,
                  preview: '[BASE64_IMAGE_DATA_VIEWPORT_SCREENSHOT]',
                },
              };
            }
            return p;
          }),
        })),
      },
    };

    const response = await ai.models.generateContent({
      model: brainModel,
      contents,
      config: {
        systemInstruction,
        abortSignal: AbortSignal.timeout(25000),
        responseMimeType: 'application/json',
        responseSchema,
      },
    });

    let decision: any;
    try {
      decision = JSON.parse(response.text || '{}');

      const textLower = (decision.agent_text || '').toLowerCase();
      const isAskingUser =
        textLower.includes('please specify') ||
        textLower.includes('which website') ||
        textLower.includes('please provide') ||
        textLower.includes('what url') ||
        textLower.includes('would you like me to') ||
        textLower.includes('let me know which') ||
        textLower.includes('can you tell me') ||
        (textLower.includes('?') && (textLower.includes('you') || textLower.includes('your') || textLower.includes('preference')));

      if (isAskingUser && decision.task_status !== 'stop') {
        decision.should_call_myself = false;
        decision.task_status = 'pause';
        decision.should_bother_user = true;
      }

      if (decision.task_status) {
        const s = decision.task_status.toLowerCase();
        if (s.includes('process') || s.includes('in-progress') || s.includes('working') || s.includes('run')) {
          decision.task_status = 'processing';
        } else if (s.includes('pause') || s.includes('wait')) {
          decision.task_status = 'pause';
        } else if (s.includes('stop') || s.includes('done') || s.includes('finish') || s.includes('complete')) {
          decision.task_status = 'stop';
        } else {
          decision.task_status = decision.should_call_myself ? 'processing' : 'stop';
        }
      } else {
        decision.task_status = decision.should_call_myself ? 'processing' : 'stop';
      }

      if (decision.task_status === 'pause' || decision.task_status === 'stop') {
        decision.should_call_myself = false;
      }

      if (decision.task) {
        decision.task.status = decision.task_status;
        decision.task.pending_inputs = Array.isArray(decision.task.pending_inputs)
          ? decision.task.pending_inputs.filter((p: any) => p && typeof p.value === 'string' && p.value.trim().length > 0)
          : [];
        decision.task.plan_steps = normalizePlannedSteps(decision.task.plan_steps);
        decision.task.current_step_index = 0;
        decision.task.consecutive_fast_steps = 0;
        decision.task.stagnant_count = 0;
        decision.task.last_action_key = undefined;
        decision.task.last_tree_sig = gate.treeSignature;
        decision.task.force_brain_next = false;
      }

      if (!decision.agent_memory) {
        decision.agent_memory = agent_memory || { working_notes: [], facts: [], candidates: [] };
      }
    } catch {
      decision = {
        agent_text: response.text || '',
        action: { type: 'wait', summary: 'Waiting for browser update' },
        should_call_myself: false,
        task: active_task || {
          title: 'Browser Automation',
          summary: 'Executing web interaction',
          approach: 'Inspect DOM and navigate',
          status: 'pause',
          plan_steps: [],
          current_step_index: 0,
        },
        task_status: 'pause',
        agent_memory: agent_memory || { working_notes: [], facts: [], candidates: [] },
        should_bother_user: true,
        timestamp: new Date().toISOString(),
      };
    }

    const execOutcome = execute_action && decision.action
      ? await executeBrowserAction(browserManager, decision.action)
      : { executionResult: null, updatedBrowserState: currentLiveState, failed: false };

    if (decision.task) {
      decision.task.last_action_failed = execOutcome.failed;
      decision.task.retry_count = execOutcome.failed ? (active_task?.retry_count || 0) + 1 : 0;
      decision.task.last_url = execOutcome.updatedBrowserState?.url || currentUrl;
    }

    const rawOutputJson = {
      decisionGate: gate.decisionRawResponse,
      rawText: response.text || '',
      parsedDecision: decision,
      usageMetadata: response.usageMetadata || null,
      candidates: response.candidates || null,
    };

    return res.json({
      ...decision,
      decisionGate: gate.telemetry,
      executionResult: execOutcome.executionResult,
      browserState: execOutcome.updatedBrowserState,
      isChromium,
      isLocalBrowser,
      clientName,
      modelInputInspector: {
        timestamp: new Date().toISOString(),
        model: `gemini-decision-1 -> ${brainModel}`,
        hasScreenshot,
        screenshotPreview: currentLiveState?.screenshotBase64 || null,
        userPrompt: user_prompt || '(None - autonomous step)',
        myself,
        activeTask: decision.task || active_task,
        agentMemory: decision.agent_memory || agent_memory || null,
        decisionGate: gate.telemetry,
        accessibilityTree: currentLiveState?.accessibilityTree || '',
        fullSystemInstruction: systemInstruction,
        fullCurrentTurnPrompt: currentTurnPrompt,
        chatHistory: exactChatHistoryPayload,
        recentHistoryCount: exactChatHistoryPayload.length,
        rawInputJson,
        rawOutputJson,
      },
    });
  } catch (err: any) {
    console.error('Agent step error:', err);
    return res.status(500).json({
      error: err.message,
      agent_text: `I encountered an issue connecting to the model: ${err.message}`,
      action: { type: 'wait', summary: 'Error recovery' },
      should_call_myself: false,
      task_status: 'pause',
      should_bother_user: true,
      timestamp: new Date().toISOString(),
    });
  }
});

async function startServer() {
  // Pre-initialize real Chromium browser instance
  chromiumManager.init().catch((err) => {
    console.warn('Chromium initial launch warning (will retry on first request):', err.message);
  });

  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.resolve('.', 'dist')));
    app.get('*', (req: Request, res: Response) => {
      res.sendFile(path.resolve('.', 'dist', 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server & Chromium Engine listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
