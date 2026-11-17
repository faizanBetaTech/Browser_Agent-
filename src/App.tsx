/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { Globe, X, RotateCcw, ExternalLink } from 'lucide-react';
import { BrowserAction, AgentTask, TaskStatus, ChatMessage, RealBrowserStateResponse, ModelInputInspector, AgentMemory } from './types/browser';
import { AgentChatWidget } from './components/chat/AgentChatWidget';
import { ChromiumBrowser } from './components/browser/ChromiumBrowser';
import { ModelInputWindow } from './components/browser/ModelInputWindow';
import { LocalBrowserModal } from './components/browser/LocalBrowserModal';
import { ProxyTunnelModal } from './components/browser/ProxyTunnelModal';

export default function App() {
  const isSidebarView = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('view') === 'sidebar';

  // Real Chromium / Firefox Browser State
  const [realBrowserState, setRealBrowserState] = useState<RealBrowserStateResponse | null>(null);
  const [isLoadingBrowser, setIsLoadingBrowser] = useState<boolean>(false);

  // Firefox Extension Bridge State
  const [showExtensionModal, setShowExtensionModal] = useState<boolean>(false);
  const [showProxyModal, setShowProxyModal] = useState<boolean>(false);
  const [activeTarget, setActiveTarget] = useState<'cloud' | 'extension'>(isSidebarView ? 'extension' : 'cloud');
  const [isExtensionConnected, setIsExtensionConnected] = useState<boolean>(false);
  const [extensionClientInfo, setExtensionClientInfo] = useState<any>(null);

  // Agent State
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [activeTask, setActiveTask] = useState<AgentTask | null>(null);
  const [agentMemory, setAgentMemory] = useState<AgentMemory | null>(null);
  const [taskStatus, setTaskStatus] = useState<TaskStatus>('stop');
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [lastAction, setLastAction] = useState<BrowserAction | null>(null);
  const [showHelpModal, setShowHelpModal] = useState<boolean>(false);
  const [modelInputInspector, setModelInputInspector] = useState<ModelInputInspector | null>(null);

  // Stop token to cancel running autonomous loops if user desires
  const cancelRequestedRef = useRef<boolean>(false);
  const activeAbortControllerRef = useRef<AbortController | null>(null);
  const autoStepTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Keep a fresh reference to messages to avoid stale closures in recursive calls
  const messagesRef = useRef<ChatMessage[]>([]);
  messagesRef.current = messages;

  const realBrowserStateRef = useRef(realBrowserState);
  realBrowserStateRef.current = realBrowserState;

  const activeTaskRef = useRef(activeTask);
  activeTaskRef.current = activeTask;

  const agentMemoryRef = useRef(agentMemory);
  agentMemoryRef.current = agentMemory;

  const taskStatusRef = useRef(taskStatus);
  taskStatusRef.current = taskStatus;

  // Fetch real Chromium or Firefox browser state from server
  const fetchBrowserState = async () => {
    try {
      const res = await fetch('/api/firefox/state');
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setRealBrowserState(data);
          if (data.activeTarget) setActiveTarget(data.activeTarget);
          if (data.isExtensionConnected !== undefined) setIsExtensionConnected(data.isExtensionConnected);
        }
      }
    } catch (e) {
      console.warn('State fetch error:', e);
    }
  };

  // Poll extension connection status
  const fetchExtensionStatus = async () => {
    try {
      const res = await fetch('/api/extension/status');
      if (res.ok) {
        const data = await res.json();
        setIsExtensionConnected(data.connected);
        setActiveTarget(data.target);
        setExtensionClientInfo(data.clientInfo);
      }
    } catch (_) {}
  };

  const handleSwitchTarget = async (target: 'cloud' | 'extension') => {
    try {
      const res = await fetch('/api/extension/target', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target }),
      });
      if (res.ok) {
        const data = await res.json();
        setActiveTarget(data.target);
        setIsExtensionConnected(data.connected);
        fetchBrowserState();
      }
    } catch (e) {
      console.error('Target switch failed:', e);
    }
  };

  useEffect(() => {
    if (isSidebarView) {
      handleSwitchTarget('extension');
    }
    fetchBrowserState();
    fetchExtensionStatus();
    // Poll state periodically when idle so user sees updates
    const interval = setInterval(() => {
      if (!isProcessing) {
        fetchBrowserState();
        fetchExtensionStatus();
      }
    }, 2500);
    return () => clearInterval(interval);
  }, [isProcessing]);

  // Execute direct manual browser operations (clicks, navigation, tabs)
  const handleBrowserAction = async (action: string, params: Record<string, any> = {}) => {
    setIsLoadingBrowser(true);
    try {
      const res = await fetch('/api/firefox/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...params }),
      });
      const data = await res.json();
      if (data.state) {
        setRealBrowserState(data.state);
      } else {
        await fetchBrowserState();
      }
    } catch (e) {
      console.error('Browser action failed:', e);
    } finally {
      setIsLoadingBrowser(false);
    }
  };

  const handleNavigate = (url: string) => handleBrowserAction('navigate', { url });
  const handleOpenTab = (url?: string) => handleBrowserAction('open_tab', { url: url || 'https://news.ycombinator.com' });
  const handleSwitchTab = (tabId: string) => handleBrowserAction('switch_tab', { tab_id: tabId });
  const handleCloseTab = (tabId: string) => handleBrowserAction('close_tab', { tab_id: tabId });
  const handleScroll = (direction: 'up' | 'down') => handleBrowserAction('scroll', { direction, amount: 400 });
  const handleManualClickCanvas = (x: number, y: number) => handleBrowserAction('mouse_click', { x, y });
  const handleKeyboardType = (text: string) => handleBrowserAction('keyboard_type', { text });
  const handleKeyboardPress = (key: string) => handleBrowserAction('keyboard_press', { key });
  const handleClearInput = () => handleBrowserAction('clear_input');

  // Agent Step Execution - Fully autonomous self-calling loop driving real Chromium
  const runAgentTurn = async (userPrompt: string = '', myself: boolean = false) => {
    // Clear any pending continuation timers
    if (autoStepTimeoutRef.current) {
      clearTimeout(autoStepTimeoutRef.current);
      autoStepTimeoutRef.current = null;
    }

    // USER PRIORITY INTERRUPT:
    // If the user sends a message while the agent is running/processing, immediately abort the in-flight request
    if (!myself && userPrompt) {
      if (activeAbortControllerRef.current) {
        try {
          activeAbortControllerRef.current.abort();
        } catch (_) {}
        activeAbortControllerRef.current = null;
      }
      cancelRequestedRef.current = false;

      // Detect user intent to stop, cancel, or change tasks
      const lower = userPrompt.toLowerCase();
      if (
        activeTaskRef.current && (
          lower.includes('stop') ||
          lower.includes('cancel') ||
          lower.includes('forget') ||
          lower.includes('instead') ||
          lower.includes('terminate') ||
          lower.includes('abort') ||
          lower.includes('new task')
        )
      ) {
        setActiveTask(null);
        activeTaskRef.current = null;
      }
    } else {
      if (isProcessing) return;
      if (cancelRequestedRef.current) {
        cancelRequestedRef.current = false;
        return;
      }
    }

    setIsProcessing(true);
    const timestamp = new Date().toISOString();

    // Create and attach new user message to state and messagesRef
    let currentHistoryList = [...messagesRef.current];
    if (userPrompt && !myself) {
      const userMsg: ChatMessage = {
        id: `user-${Date.now()}`,
        sender: 'user',
        text: userPrompt,
        timestamp,
      };
      currentHistoryList.push(userMsg);
      setMessages(currentHistoryList);
    }

    const abortController = new AbortController();
    activeAbortControllerRef.current = abortController;

    try {
      // Build turn history from the actual fresh current history
      const historyPayload = currentHistoryList.slice(-6).map((m) => ({
        role: m.sender,
        text: m.text,
        agent_text: m.text,
        thought: m.thought,
        visual_summary: m.visual_summary,
        action: m.action,
        task_status: m.task?.status,
        should_call_myself: m.myself,
        timestamp: m.timestamp,
      }));

      // Call API step: multimodal visual screenshot + accessibility tree + hardware actions
      const res = await fetch('/api/agent/step', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abortController.signal,
        body: JSON.stringify({
          user_prompt: userPrompt,
          myself,
          timestamp,
          history: historyPayload,
          active_task: activeTaskRef.current,
          agent_memory: agentMemoryRef.current,
          execute_action: true,
        }),
      });

      if (!res.ok) {
        throw new Error(`Agent API returned status ${res.status}`);
      }

      const data = await res.json();

      if (data.modelInputInspector) {
        setModelInputInspector(data.modelInputInspector);
      }
      if (data.task) {
        setActiveTask(data.task);
        activeTaskRef.current = data.task;
      }
      if (data.agent_memory) {
        setAgentMemory(data.agent_memory);
        agentMemoryRef.current = data.agent_memory;
      }
      if (data.task_status) setTaskStatus(data.task_status);
      if (data.action) setLastAction(data.action);

      // Update real Chromium browser state if returned
      if (data.browserState) {
        setRealBrowserState(data.browserState);
      } else {
        fetchBrowserState();
      }

      let responseText = data.agent_text || '';
      if (!responseText && data.action) {
        responseText = data.action.summary
          ? `⚡ Action: ${data.action.summary}`
          : `⚡ Executing ${data.action.type}...`;
      }
      if (!responseText && data.thought) {
        responseText = data.thought;
      }

      const agentMsg: ChatMessage = {
        id: `agent-${Date.now()}`,
        sender: 'agent',
        text: responseText,
        thought: data.thought || '',
        visual_summary: data.visual_summary || '',
        action: data.action,
        task: data.task,
        agent_memory: data.agent_memory,
        decisionGate: data.decisionGate,
        myself,
        timestamp: data.timestamp || timestamp,
        should_bother_user: data.should_bother_user,
      };

      setMessages((prev) => [...prev, agentMsg]);
      setIsProcessing(false);

      // Autonomous Continuation (stops if cancelled, finished, or paused)
      const shouldContinue =
        !cancelRequestedRef.current &&
        data.action?.type !== 'finish' &&
        data.task_status !== 'pause' &&
        data.task_status !== 'stop' &&
        (data.should_call_myself || data.task_status === 'processing');

      if (shouldContinue) {
        autoStepTimeoutRef.current = setTimeout(() => {
          runAgentTurn('', true);
        }, 1200);
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        console.log('[Agent] In-flight step aborted by new user prompt.');
        return;
      }
      console.error('Agent turn failed:', err);
      setIsProcessing(false);
      setTaskStatus('stop');

      const errorMsg: ChatMessage = {
        id: `sys-${Date.now()}`,
        sender: 'agent',
        text: `Error executing step: ${err.message}.`,
        timestamp: new Date().toISOString(),
        should_bother_user: true,
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      if (activeAbortControllerRef.current === abortController) {
        activeAbortControllerRef.current = null;
      }
    }
  };

  const handleClearMemory = () => {
    setAgentMemory(null);
    agentMemoryRef.current = null;
  };

  const handleStopTask = () => {
    cancelRequestedRef.current = true;
    if (activeAbortControllerRef.current) {
      try {
        activeAbortControllerRef.current.abort();
      } catch (_) {}
      activeAbortControllerRef.current = null;
    }
    if (autoStepTimeoutRef.current) {
      clearTimeout(autoStepTimeoutRef.current);
      autoStepTimeoutRef.current = null;
    }
    setIsProcessing(false);
    setTaskStatus('stop');
    setActiveTask(null);
    activeTaskRef.current = null;
  };

  const handlePauseTask = () => {
    cancelRequestedRef.current = true;
    if (activeAbortControllerRef.current) {
      try {
        activeAbortControllerRef.current.abort();
      } catch (_) {}
      activeAbortControllerRef.current = null;
    }
    if (autoStepTimeoutRef.current) {
      clearTimeout(autoStepTimeoutRef.current);
      autoStepTimeoutRef.current = null;
    }
    setIsProcessing(false);
    setTaskStatus('pause');
    if (activeTask) {
      setActiveTask({ ...activeTask, status: 'pause' });
    }
  };

  const handleResumeTask = () => {
    cancelRequestedRef.current = false;
    setTaskStatus('processing');
    if (activeTask) {
      setActiveTask({ ...activeTask, status: 'processing' });
    }
    runAgentTurn('Resume current task from current page state', false);
  };

  const handleResetWorkspace = () => {
    cancelRequestedRef.current = true;
    if (activeAbortControllerRef.current) {
      try {
        activeAbortControllerRef.current.abort();
      } catch (_) {}
      activeAbortControllerRef.current = null;
    }
    if (autoStepTimeoutRef.current) {
      clearTimeout(autoStepTimeoutRef.current);
      autoStepTimeoutRef.current = null;
    }
    setMessages([]);
    setActiveTask(null);
    activeTaskRef.current = null;
    setTaskStatus('stop');
    setLastAction(null);
    handleNavigate('https://news.ycombinator.com');
  };

  if (isSidebarView) {
    return (
      <div className="flex flex-col h-screen w-screen bg-[#0a0a0b] text-zinc-100 overflow-hidden font-sans select-text">
        <header className="h-11 border-b border-white/[0.08] bg-[#111113] px-3 flex items-center justify-between shrink-0 z-30">
          <div className="flex items-center gap-2 min-w-0">
            <Globe className="w-4 h-4 text-zinc-300 shrink-0" />
            <span className="font-semibold text-xs text-zinc-100 whitespace-nowrap">Browser Agent</span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => handleSwitchTarget(activeTarget === 'extension' ? 'cloud' : 'extension')}
              className="px-2.5 py-1 rounded-md text-[11px] font-medium border border-white/[0.08] bg-[#18181b] hover:bg-zinc-800 text-zinc-200 transition-colors whitespace-nowrap"
              title="Switch between local Firefox tab and Chromium"
            >
              {activeTarget === 'extension' ? 'Firefox' : 'Chromium'}
            </button>

            <button
              onClick={handleResetWorkspace}
              className="p-1.5 rounded-md border border-white/[0.08] hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100 transition-colors"
              title="Reset workspace"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-hidden flex flex-col">
          <AgentChatWidget
            messages={messages}
            activeTask={activeTask}
            taskStatus={taskStatus}
            isProcessing={isProcessing}
            onSendMessage={(prompt) => runAgentTurn(prompt, false)}
            onStopTask={handleStopTask}
            onPauseTask={handlePauseTask}
            onResumeTask={handleResumeTask}
            currentDomTokens={realBrowserState?.accessibilityTree?.length || 0}
            className="w-full h-full border-none"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-[#0a0a0b] font-sans text-zinc-100">
      {/* Minimalist Top Bar */}
      <header className="h-11 bg-[#111113] border-b border-white/[0.08] px-4 flex items-center justify-between gap-6 shrink-0 z-30 select-none">
        {/* Left: Clean Brand Wordmark */}
        <div className="flex items-center gap-2.5 shrink-0">
          <Globe className="w-4 h-4 text-zinc-200" />
          <span className="font-semibold text-sm tracking-tight text-zinc-100 whitespace-nowrap">
            Browser Agent
          </span>
        </div>

        {/* Center: Clean Engine Segmented Switch */}
        <div className="flex items-center bg-[#0a0a0b] p-0.5 rounded-lg border border-white/[0.08] shrink-0">
          <button
            onClick={() => handleSwitchTarget('cloud')}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
              activeTarget !== 'extension'
                ? 'bg-zinc-100 text-zinc-950'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Chromium
          </button>
          <button
            onClick={() => {
              if (isExtensionConnected) {
                handleSwitchTarget('extension');
              } else {
                setShowExtensionModal(true);
              }
            }}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 whitespace-nowrap ${
              activeTarget === 'extension'
                ? 'bg-zinc-100 text-zinc-950'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <span>Firefox</span>
            {isExtensionConnected && (
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  activeTarget === 'extension' ? 'bg-emerald-600' : 'bg-emerald-500'
                }`}
              />
            )}
          </button>
        </div>

        {/* Right: Quiet Workspace Controls */}
        <div className="flex items-center gap-1.5 text-xs shrink-0">
          <button
            onClick={() => setShowProxyModal(true)}
            className="px-2.5 py-1.5 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.05] transition-colors whitespace-nowrap"
          >
            Proxy
          </button>

          <button
            onClick={() => setShowExtensionModal(true)}
            className="px-2.5 py-1.5 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.05] transition-colors whitespace-nowrap"
          >
            Extension
          </button>

          <button
            onClick={() => setShowHelpModal(true)}
            className="px-2.5 py-1.5 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.05] transition-colors whitespace-nowrap"
          >
            Guide
          </button>

          <a
            href={typeof window !== 'undefined' ? window.location.href : '#'}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.05] transition-colors"
            title="Open in new tab"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>

          <button
            onClick={handleResetWorkspace}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-zinc-300 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] transition-colors whitespace-nowrap ml-1"
            title="Reset workspace"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Reset</span>
          </button>
        </div>
      </header>

      {/* Main Split Layout */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden relative">
        <div className="flex-1 flex flex-col h-full overflow-hidden bg-[#0a0a0b]">
          <ChromiumBrowser
            realBrowserState={realBrowserState}
            isLoadingBrowser={isLoadingBrowser}
            onNavigate={handleNavigate}
            onOpenTab={handleOpenTab}
            onSwitchTab={handleSwitchTab}
            onCloseTab={handleCloseTab}
            onRefresh={fetchBrowserState}
            onScroll={handleScroll}
            onManualClickCanvas={handleManualClickCanvas}
            onKeyboardType={handleKeyboardType}
            onKeyboardPress={handleKeyboardPress}
            onClearInput={handleClearInput}
            lastAction={lastAction}
            activeTarget={activeTarget}
            isExtensionConnected={isExtensionConnected}
            clientInfo={extensionClientInfo}
            onToggleTarget={handleSwitchTarget}
            onOpenExtensionModal={() => setShowExtensionModal(true)}
            onOpenProxyModal={() => setShowProxyModal(true)}
          />
        </div>

        <AgentChatWidget
          messages={messages}
          activeTask={activeTask}
          taskStatus={taskStatus}
          isProcessing={isProcessing}
          onSendMessage={(prompt) => runAgentTurn(prompt, false)}
          onStopTask={handleStopTask}
          onPauseTask={handlePauseTask}
          onResumeTask={handleResumeTask}
          currentDomTokens={realBrowserState?.accessibilityTree?.length || 0}
        />
      </div>

      {/* Bottom Model Payload Inspector */}
      <ModelInputWindow inspectorData={modelInputInspector} />

      {/* Guide Modal */}
      {showHelpModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#111113] rounded-xl border border-white/[0.1] p-6 max-w-lg w-full space-y-5 text-sm text-zinc-300">
            <div className="flex items-center justify-between pb-3 border-b border-white/[0.08]">
              <h2 className="text-base font-semibold text-zinc-100">How It Works</h2>
              <button
                onClick={() => setShowHelpModal(false)}
                className="text-zinc-400 hover:text-zinc-100 p-1 rounded-md hover:bg-white/[0.06] transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4 text-xs leading-relaxed">
              <div>
                <h4 className="font-medium text-zinc-100 mb-1">Direct Browser Control</h4>
                <p className="text-zinc-400">
                  Give the agent any instruction in the chat panel. It inspects the live viewport screenshot and page elements, then clicks, types, scrolls, and switches tabs automatically.
                </p>
              </div>

              <div>
                <h4 className="font-medium text-zinc-100 mb-1">Human-in-the-Loop</h4>
                <p className="text-zinc-400">
                  You can click directly inside the browser viewport, type with your physical keyboard, or pause the agent at any time for logins or verification checks.
                </p>
              </div>

              <div>
                <h4 className="font-medium text-zinc-100 mb-1">Chromium or Local Firefox</h4>
                <p className="text-zinc-400">
                  Run tasks in the built-in stealth Chromium browser, configure an HTTP/SOCKS5 proxy, or link your local Firefox browser via the Extension modal.
                </p>
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                onClick={() => setShowHelpModal(false)}
                className="px-4 py-2 bg-zinc-100 hover:bg-white text-zinc-950 font-medium text-xs rounded-lg transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Firefox Extension Bridge Modal */}
      {showExtensionModal && (
        <LocalBrowserModal
          isConnected={isExtensionConnected}
          activeTarget={activeTarget}
          clientInfo={extensionClientInfo}
          onSwitchTarget={handleSwitchTarget}
          onClose={() => setShowExtensionModal(false)}
        />
      )}

      {/* Proxy Manager Modal */}
      {showProxyModal && (
        <ProxyTunnelModal
          isOpen={showProxyModal}
          onClose={() => setShowProxyModal(false)}
          onProxyUpdated={fetchBrowserState}
        />
      )}
    </div>
  );
}
