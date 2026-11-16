export type ActionType =
  | 'click'
  | 'right_click'
  | 'hover'
  | 'type'
  | 'press_key'
  | 'drag_and_drop'
  | 'scroll'
  | 'open_tab'
  | 'navigate'
  | 'switch_tab'
  | 'close_tab'
  | 'wait'
  | 'finish';

export interface BrowserAction {
  type: ActionType;
  target?: string;
  source?: string;
  key?: string;
  value?: string;
  url?: string;
  direction?: 'up' | 'down';
  amount?: number;
  tab_id?: string;
  submit?: boolean;
  summary: string;
}

export type TaskStatus = 'processing' | 'pause' | 'stop';

export interface AgentMemoryCandidate {
  name: string;
  price?: string;
  source?: string;
  details?: string;
}

export interface AgentMemoryFact {
  key: string;
  value: string;
}

export interface AgentMemory {
  working_notes?: string[];
  facts?: AgentMemoryFact[];
  candidates?: AgentMemoryCandidate[];
}

export interface PlannedStep {
  id: string;
  description: string;
  action: BrowserAction;
  expected_visual_state?: string;
  requires_brain_after?: boolean;
}

export interface PendingInput {
  field_hint: string;
  value: string;
  submit?: boolean;
}

export interface AgentTask {
  title: string;
  summary: string;
  approach: string;
  status: TaskStatus;
  pending_inputs?: PendingInput[];
  plan_steps?: PlannedStep[];
  current_step_index?: number;
  consecutive_fast_steps?: number;
  stagnant_count?: number;
  last_action_key?: string;
  last_tree_sig?: string;
  retry_count?: number;
  last_url?: string;
  last_action_failed?: boolean;
  force_brain_next?: boolean;
}

export interface DecisionGateTelemetry {
  model: string;
  route: 'FAST_EXECUTE_ACTION' | 'FAST_PAUSE_HUMAN_GATE' | 'ROUTE_BRAIN_PLAN_OR_TEXT' | 'ROUTE_BRAIN_ERROR_RECOVERY';
  fastExecuted: boolean;
  routedToBrain: boolean;
  selectedOption?: string;
  escalationReason: string;
  latencyMs: number;
  answers?: Record<string, any>;
}

export interface AgentTurnResponse {
  thought?: string;
  visual_summary?: string;
  agent_text: string;
  action: BrowserAction;
  should_call_myself: boolean;
  task: AgentTask;
  task_status: TaskStatus;
  agent_memory?: AgentMemory;
  should_bother_user: boolean;
  decisionGate?: DecisionGateTelemetry;
  timestamp: string;
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'agent' | 'system';
  text: string;
  thought?: string;
  visual_summary?: string;
  action?: BrowserAction;
  task?: AgentTask;
  agent_memory?: AgentMemory;
  decisionGate?: DecisionGateTelemetry;
  myself?: boolean;
  timestamp: string;
  should_bother_user?: boolean;
}

export interface BrowserTab {
  id: string;
  title: string;
  url: string;
  isLoading?: boolean;
}

export interface StrippedHtmlInfo {
  rawLength: number;
  cleanedLength: number;
  reductionPercentage: number;
  elementCount: number;
  html: string;
}

export interface FocusedElementInfo {
  tagName: string;
  type?: string;
  placeholder?: string;
  name?: string;
  value?: string;
  isInput: boolean;
}

export interface RealBrowserStateResponse {
  activeTabId: string;
  tabs: BrowserTab[];
  url: string;
  title: string;
  screenshotBase64: string;
  cleanedHtml: string;
  accessibilityTree?: string;
  elementCount: number;
  rawHtmlLength: number;
  cleanedHtmlLength: number;
  focusedElement?: FocusedElementInfo | null;
  isLocalBrowser?: boolean;
  clientName?: string;
}

export interface ModelInputInspector {
  timestamp: string;
  model: string;
  hasScreenshot: boolean;
  screenshotPreview?: string | null;
  userPrompt: string;
  myself: boolean;
  activeTask: AgentTask | null;
  agentMemory?: AgentMemory | null;
  decisionGate?: DecisionGateTelemetry | null;
  accessibilityTree: string;
  fullSystemInstruction: string;
  fullCurrentTurnPrompt: string;
  chatHistory: any[];
  recentHistoryCount: number;
  rawInputJson?: any;
  rawOutputJson?: any;
}

export interface ProxyTunnelConfig {
  enabled: boolean;
  server: string;
  username?: string;
  password?: string;
}

export interface EgressIpInfo {
  query?: string;
  isp?: string;
  org?: string;
  country?: string;
  city?: string;
  regionName?: string;
  status?: string;
  as?: string;
}
