import React, { useState, useRef, useEffect } from 'react';
import {
  ArrowUp,
  ChevronDown,
  ChevronUp,
  Pause,
  Play,
  Square,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';
import { AgentTask, ChatMessage, TaskStatus } from '../../types/browser';

interface Props {
  messages: ChatMessage[];
  activeTask: AgentTask | null;
  taskStatus: TaskStatus;
  isProcessing: boolean;
  onSendMessage: (text: string) => void;
  onStopTask: () => void;
  onPauseTask?: () => void;
  onResumeTask?: () => void;
  currentDomTokens: number;
  className?: string;
}

const SAMPLE_TASKS = [
  {
    title: 'Compare product prices',
    prompt:
      'Search the web for the cheapest dumbbells available, scroll through the listings to compare prices across options, and recommend the best deal.',
  },
  {
    title: 'Summarize top Hacker News thread',
    prompt:
      'Browse Hacker News, scroll down the front page, click into the top debate, and summarize the consensus.',
  },
  {
    title: 'Research on Wikipedia',
    prompt:
      'Navigate to Wikipedia, search for Alan Turing, scroll through his contributions to computing, and find his enigma codebreaking work.',
  },
];

export const AgentChatWidget: React.FC<Props> = ({
  messages,
  activeTask,
  taskStatus,
  isProcessing,
  onSendMessage,
  onStopTask,
  onPauseTask,
  onResumeTask,
  className,
}) => {
  const [inputText, setInputText] = useState('');
  const [showApproach, setShowApproach] = useState(false);
  const [expandedMsgIds, setExpandedMsgIds] = useState<Record<string, boolean>>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isProcessing]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;
    onSendMessage(inputText.trim());
    setInputText('');
  };

  const toggleDetails = (id: string) => {
    setExpandedMsgIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const statusLabel = isProcessing
    ? 'Working'
    : taskStatus === 'processing'
    ? 'Running'
    : taskStatus === 'pause'
    ? 'Paused'
    : 'Ready';

  return (
    <aside
      className={`w-full h-full flex flex-col bg-[#111113] text-zinc-100 ${
        className || 'md:w-[390px] lg:w-[420px] border-l border-white/[0.08]'
      }`}
    >
      {/* Quiet Header */}
      <div className="h-11 px-4 border-b border-white/[0.08] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <h2 className="text-xs font-semibold text-zinc-100 whitespace-nowrap">Agent</h2>
          <span className="text-zinc-600" aria-hidden="true">·</span>
          <span className="text-xs text-zinc-400 flex items-center gap-1.5 whitespace-nowrap">
            {(isProcessing || taskStatus === 'processing') && (
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            )}
            {taskStatus === 'pause' && (
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            )}
            {statusLabel}
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {taskStatus === 'processing' && onPauseTask && (
            <button
              onClick={onPauseTask}
              className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium text-zinc-300 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] transition-colors"
              title="Pause"
            >
              <Pause className="w-3 h-3" />
              <span>Pause</span>
            </button>
          )}

          {taskStatus === 'pause' && onResumeTask && (
            <button
              onClick={onResumeTask}
              className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-zinc-100 hover:bg-white text-zinc-950 transition-colors"
              title="Resume"
            >
              <Play className="w-3 h-3" />
              <span>Resume</span>
            </button>
          )}

          {(taskStatus === 'processing' || taskStatus === 'pause') && (
            <button
              onClick={onStopTask}
              className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium text-zinc-300 hover:text-red-300 bg-white/[0.04] hover:bg-red-500/10 border border-white/[0.08] hover:border-red-500/30 transition-colors"
              title="Stop task"
            >
              <Square className="w-2.5 h-2.5 fill-current" />
              <span>Stop</span>
            </button>
          )}
        </div>
      </div>

      {/* Active Task Bar (Minimalist, collapsed strategy by default) */}
      {activeTask && taskStatus === 'processing' && (
        <div className="px-4 py-2.5 border-b border-white/[0.08] bg-[#161619]">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-zinc-100 truncate">{activeTask.title}</p>
            <div className="flex items-center gap-2 shrink-0">
              {Array.isArray(activeTask.plan_steps) && activeTask.plan_steps.length > 0 && (
                <span className="text-[11px] font-mono tabular-nums text-zinc-400">
                  {Math.min(activeTask.current_step_index || 0, activeTask.plan_steps.length)}/{activeTask.plan_steps.length}
                </span>
              )}
              {activeTask.approach && (
                <button
                  onClick={() => setShowApproach(!showApproach)}
                  className="text-zinc-400 hover:text-zinc-200 p-0.5 rounded transition-colors"
                  title={showApproach ? 'Hide plan' : 'Show plan'}
                >
                  {showApproach ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </button>
              )}
            </div>
          </div>

          {showApproach && activeTask.approach && (
            <p className="mt-2 pt-2 border-t border-white/[0.06] text-xs text-zinc-400 leading-relaxed whitespace-pre-wrap">
              {activeTask.approach}
            </p>
          )}
        </div>
      )}

      {/* Paused for Human Action Banner */}
      {taskStatus === 'pause' && (
        <div className="px-4 py-3 border-b border-amber-500/20 bg-amber-500/[0.06] space-y-2">
          <div className="flex items-center gap-2 text-amber-300 text-xs font-medium">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span>Action required in browser</span>
          </div>
          <p className="text-xs text-zinc-300 leading-relaxed">
            Complete sign-in or verification directly in the viewport, then resume.
          </p>
          {onResumeTask && (
            <button
              onClick={() => onResumeTask()}
              className="flex items-center justify-center gap-1.5 w-full py-1.5 px-3 rounded-lg bg-zinc-100 hover:bg-white text-zinc-950 font-medium text-xs transition-colors"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Resume task</span>
            </button>
          )}
        </div>
      )}

      {/* Conversation Feed */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col justify-center max-w-sm mx-auto">
            <h3 className="text-sm font-semibold text-zinc-100 mb-1">
              What should the browser do?
            </h3>
            <p className="text-xs text-zinc-400 leading-relaxed mb-5">
              Describe a task in plain language. The agent inspects the page, clicks, types, and navigates step by step.
            </p>

            <div className="space-y-1.5">
              {SAMPLE_TASKS.map((t, idx) => (
                <button
                  key={idx}
                  onClick={() => onSendMessage(t.prompt)}
                  disabled={isProcessing}
                  className="w-full text-left px-3 py-2.5 rounded-lg bg-white/[0.03] hover:bg-white/[0.07] border border-white/[0.06] hover:border-white/[0.12] transition-colors group"
                >
                  <div className="text-xs font-medium text-zinc-200 group-hover:text-white">
                    {t.title}
                  </div>
                  <div className="text-[11px] text-zinc-500 line-clamp-1 mt-0.5">
                    {t.prompt}
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg) => {
            const isAgent = msg.sender === 'agent';
            const hasDetails = Boolean(isAgent && (msg.thought || msg.visual_summary));
            const isExpanded = Boolean(expandedMsgIds[msg.id]);

            if (!isAgent) {
              return (
                <div key={msg.id} className="flex justify-end">
                  <div className="max-w-[85%] rounded-xl rounded-tr-sm bg-[#222227] border border-white/[0.08] px-3.5 py-2.5 text-xs text-zinc-100 leading-relaxed">
                    {msg.text}
                  </div>
                </div>
              );
            }

            return (
              <div key={msg.id} className="space-y-1.5">
                {/* Quiet Metadata Line */}
                <div className="flex items-center gap-2 text-[11px] text-zinc-500 font-mono tabular-nums">
                  <span className="font-sans font-medium text-zinc-300">Agent</span>
                  <span aria-hidden="true">·</span>
                  <span>
                    {new Date(msg.timestamp).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                  </span>
                  {msg.decisionGate && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span title={msg.decisionGate.escalationReason}>
                        {msg.decisionGate.fastExecuted ? 'Fast' : 'Brain'} {msg.decisionGate.latencyMs}ms
                      </span>
                    </>
                  )}
                  {hasDetails && (
                    <button
                      onClick={() => toggleDetails(msg.id)}
                      className="ml-auto font-sans text-[11px] text-zinc-500 hover:text-zinc-200 transition-colors"
                    >
                      {isExpanded ? 'Hide notes' : 'Notes'}
                    </button>
                  )}
                </div>

                {/* Primary Agent Message */}
                {msg.text && (
                  <div className="text-xs text-zinc-200 leading-relaxed whitespace-pre-wrap">
                    {msg.text}
                  </div>
                )}

                {/* Compact Single-Line Action Summary */}
                {msg.action && (
                  <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-[#161619] border border-white/[0.06] text-[11px] font-mono text-zinc-300">
                    <span className="text-zinc-100 font-medium shrink-0">{msg.action.type}</span>
                    {msg.action.target && (
                      <span className="text-zinc-400 shrink-0">{msg.action.target}</span>
                    )}
                    {(msg.action.summary || msg.action.value || msg.action.url) && (
                      <span className="text-zinc-500 truncate">
                        {msg.action.summary || msg.action.value || msg.action.url}
                      </span>
                    )}
                  </div>
                )}

                {/* Optional Collapsible Notes (Thought / Visual Summary) */}
                {hasDetails && isExpanded && (
                  <div className="p-3 rounded-lg bg-[#0a0a0b] border border-white/[0.06] space-y-2 text-[11px] text-zinc-400 leading-relaxed">
                    {msg.thought && (
                      <div>
                        <div className="text-zinc-300 font-medium mb-0.5">Reasoning</div>
                        <p>{msg.thought}</p>
                      </div>
                    )}
                    {msg.visual_summary && (
                      <div>
                        <div className="text-zinc-300 font-medium mb-0.5">Page observation</div>
                        <p>{msg.visual_summary}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}

        {isProcessing && (
          <div className="flex items-center gap-2 text-xs text-zinc-400 py-1">
            <span className="w-1.5 h-1.5 rounded-full bg-zinc-300 animate-pulse" />
            <span>Working on next step...</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Clean Input Composer */}
      <form onSubmit={handleSend} className="p-3 border-t border-white/[0.08] bg-[#111113]">
        <div className="flex items-center gap-2 bg-[#0a0a0b] border border-white/[0.1] focus-within:border-white/[0.25] rounded-xl px-3 py-1.5 transition-colors">
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder={isProcessing ? 'Redirect or stop the agent...' : 'Tell the agent what to do...'}
            className="flex-1 bg-transparent py-1 text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={!inputText.trim()}
            className="w-7 h-7 rounded-lg bg-zinc-100 hover:bg-white disabled:opacity-25 disabled:hover:bg-zinc-100 text-zinc-950 flex items-center justify-center shrink-0 transition-colors"
            title="Send"
          >
            <ArrowUp className="w-3.5 h-3.5" />
          </button>
        </div>
      </form>
    </aside>
  );
};
