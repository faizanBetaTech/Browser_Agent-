import React from 'react';
import {
  Laptop,
  Radio,
  ExternalLink,
  ShieldCheck,
  Zap,
  Globe,
  CheckCircle2,
  Clock,
  Code2,
  ArrowUpRight,
  Terminal,
} from 'lucide-react';
import { RealBrowserStateResponse, BrowserAction } from '../../types/browser';

interface Props {
  realBrowserState: RealBrowserStateResponse | null;
  lastAction: BrowserAction | null;
  isProcessing: boolean;
  onOpenConnectModal: () => void;
}

export const RealBrowserDashboard: React.FC<Props> = ({
  realBrowserState,
  lastAction,
  isProcessing,
  onOpenConnectModal,
}) => {
  const isConnected = Boolean(realBrowserState?.isLocalBrowser);

  return (
    <div className="flex-1 flex flex-col h-full bg-black p-6 overflow-y-auto font-mono text-white">
      {/* Top Banner Status Card */}
      <div className="max-w-4xl mx-auto w-full space-y-4">
        <div className="p-4 rounded border border-zinc-800 bg-zinc-950 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded bg-black border border-zinc-700 flex items-center justify-center">
              <Laptop className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-sm font-semibold text-white tracking-tight uppercase">
                  {isConnected
                    ? realBrowserState?.clientName || 'Personal Desktop Browser'
                    : 'Real Browser Bridge'}
                </h1>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold ${
                    isConnected
                      ? 'bg-zinc-900 text-white border border-zinc-700'
                      : 'bg-zinc-950 text-zinc-500 border border-zinc-800'
                  }`}
                >
                  {isConnected ? 'READY' : 'DISCONNECTED'}
                </span>
              </div>
              <p className="text-xs text-zinc-400 mt-0.5 font-sans">
                {isConnected
                  ? 'Bypassing CAPTCHAs and bot shields using your authenticated residential session.'
                  : 'Connect your Firefox browser to let the AI agent browse with your personal sessions.'}
              </p>
            </div>
          </div>

          <button
            onClick={onOpenConnectModal}
            className="px-4 py-2 rounded text-xs font-semibold bg-white hover:bg-zinc-200 text-black transition-colors flex items-center gap-1.5 shrink-0 font-mono"
          >
            <span>{isConnected ? 'Settings' : 'Connect Browser'}</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Live Active Browser Inspection Panel */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* Active URL Card */}
          <div className="p-3.5 rounded bg-zinc-950 border border-zinc-800 flex flex-col justify-between">
            <div className="flex items-center justify-between text-xs text-zinc-400 mb-2">
              <span className="font-semibold uppercase tracking-wider text-[10px] text-zinc-400 flex items-center gap-1.5">
                <Globe className="w-3.5 h-3.5 text-zinc-400" />
                Active Tab URL
              </span>
              {realBrowserState?.url && (
                <a
                  href={realBrowserState.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-zinc-500 hover:text-white"
                >
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
            <div className="font-mono text-xs text-white truncate" title={realBrowserState?.url || 'None'}>
              {realBrowserState?.url || 'No tab connected'}
            </div>
            <div className="text-[11px] text-zinc-400 truncate mt-1">
              Title: {realBrowserState?.title || 'None'}
            </div>
          </div>

          {/* Real IP & Protection Bypass Card */}
          <div className="p-3.5 rounded bg-zinc-950 border border-zinc-800 flex flex-col justify-between">
            <div className="text-xs text-zinc-400 mb-2 flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-zinc-400" />
              <span className="font-semibold uppercase tracking-wider text-[10px]">Session Status</span>
            </div>
            <div className="text-xs font-semibold text-white flex items-center gap-1.5 font-mono">
              <CheckCircle2 className="w-4 h-4 text-white" />
              <span>Residential Bridge</span>
            </div>
            <div className="text-[11px] text-zinc-400 mt-1">
              {isConnected ? 'Active on Residential IP' : 'Awaiting local browser link'}
            </div>
          </div>

          {/* Page DOM Token Footprint */}
          <div className="p-3.5 rounded bg-zinc-950 border border-zinc-800 flex flex-col justify-between">
            <div className="text-xs text-zinc-400 mb-2 flex items-center gap-1.5">
              <Code2 className="w-3.5 h-3.5 text-zinc-400" />
              <span className="font-semibold uppercase tracking-wider text-[10px]">Stripped DOM Payload</span>
            </div>
            <div className="text-xs font-mono font-bold text-white">
              {(realBrowserState?.cleanedHtmlLength || 0).toLocaleString()} chars
            </div>
            <div className="text-[11px] text-zinc-400 mt-1">
              {realBrowserState?.elementCount || 0} interactive elements
            </div>
          </div>
        </div>

        {/* Live Action Telemetry & Execution Stream */}
        <div className="p-4 rounded border border-zinc-800 bg-zinc-950 space-y-3 font-mono">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Terminal className="w-4 h-4 text-white" />
              <h2 className="text-xs font-bold uppercase tracking-wider text-white">
                Live Browser Action Telemetry
              </h2>
            </div>
            {isProcessing && (
              <div className="flex items-center gap-1.5 text-xs text-white font-mono">
                <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                <span>Executing in browser...</span>
              </div>
            )}
          </div>

          {lastAction ? (
            <div className="p-3.5 rounded bg-zinc-950 border border-zinc-800 font-mono text-xs space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded bg-black text-white font-bold uppercase text-[11px] border border-zinc-700">
                  {lastAction.type}
                </span>
                <span className="text-zinc-300 font-normal">
                  {lastAction.summary || 'Direct browser dispatch'}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 text-[11px] text-zinc-400">
                {lastAction.target && (
                  <div>
                    Target: <span className="text-white font-semibold">{lastAction.target}</span>
                  </div>
                )}
                {lastAction.value && (
                  <div>
                    Value: <span className="text-zinc-200">"{lastAction.value}"</span>
                  </div>
                )}
                {lastAction.url && (
                  <div>
                    URL: <span className="text-zinc-400">{lastAction.url}</span>
                  </div>
                )}
                {lastAction.direction && (
                  <div>
                    Scroll: <span className="text-zinc-300">{lastAction.direction}</span> ({lastAction.amount || 400}px)
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="p-6 rounded bg-zinc-950 border border-zinc-800 text-center text-xs text-zinc-500 font-mono">
              No actions executed yet.
            </div>
          )}
        </div>

        {/* DOM Live Snapshot Inspector Preview */}
        {realBrowserState?.cleanedHtml && (
          <div className="p-4 rounded bg-zinc-950 border border-zinc-800 space-y-2 font-mono">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold uppercase tracking-wider text-[11px] text-white flex items-center gap-1.5">
                <Code2 className="w-3.5 h-3.5 text-zinc-400" />
                Live Stripped DOM Observed by Model
              </span>
              <span className="text-zinc-500 font-mono text-[10px]">
                Indexed links (#L1...) & element IDs (el-1...)
              </span>
            </div>
            <pre className="max-h-48 overflow-y-auto p-3 rounded bg-black border border-zinc-800 font-mono text-[11px] text-zinc-300 leading-relaxed whitespace-pre-wrap select-all">
              {realBrowserState.cleanedHtml.substring(0, 3000)}
              {realBrowserState.cleanedHtml.length > 3000 ? '\n... [DOM Preview Truncated]' : ''}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
};
