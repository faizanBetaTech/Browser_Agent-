import React, { useState } from 'react';
import { Download, ExternalLink, Check, RefreshCw, X } from 'lucide-react';

interface Props {
  isConnected: boolean;
  activeTarget: 'cloud' | 'extension';
  clientInfo?: any;
  onSwitchTarget: (target: 'cloud' | 'extension') => void;
  onClose: () => void;
}

export const LocalBrowserModal: React.FC<Props> = ({
  isConnected,
  activeTarget,
  clientInfo,
  onSwitchTarget,
  onClose,
}) => {
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [copiedDebugUrl, setCopiedDebugUrl] = useState(false);

  const serverUrl = window.location.origin;
  const debugUrl = 'about:debugging#/runtime/this-firefox';

  const handleCopyServerUrl = () => {
    navigator.clipboard.writeText(serverUrl);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 1800);
  };

  const handleCopyDebugUrl = () => {
    navigator.clipboard.writeText(debugUrl);
    setCopiedDebugUrl(true);
    setTimeout(() => setCopiedDebugUrl(false), 1800);
  };

  const handleDownload = () => {
    setIsDownloading(true);
    window.location.href = '/api/extension/download';
    setTimeout(() => setIsDownloading(false), 1800);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#111113] border border-white/[0.1] rounded-xl max-w-xl w-full overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-white/[0.08] flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">Firefox Extension Bridge</h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              Connect your local Firefox browser to run tasks in your active session.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-zinc-400 hover:text-white hover:bg-white/[0.06] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Connection Status */}
        <div className="px-6 py-2.5 border-b border-white/[0.08] bg-[#0a0a0b] flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 text-zinc-300">
            <span className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-emerald-500' : 'bg-zinc-600'}`} />
            {isConnected ? (
              <span>Connected · {clientInfo?.activeTabTitle || 'Firefox Active'}</span>
            ) : (
              <span className="text-zinc-400">Waiting for extension connection</span>
            )}
          </div>

          {isConnected && (
            <button
              onClick={() => onSwitchTarget(activeTarget === 'extension' ? 'cloud' : 'extension')}
              className={`text-xs px-2.5 py-1 rounded-md font-medium transition-colors ${
                activeTarget === 'extension'
                  ? 'bg-zinc-100 text-zinc-950'
                  : 'bg-white/[0.06] hover:bg-white/[0.1] text-zinc-200'
              }`}
            >
              {activeTarget === 'extension' ? 'Using Firefox' : 'Use Firefox'}
            </button>
          )}
        </div>

        {/* Steps */}
        <div className="p-6 overflow-y-auto space-y-4 text-xs text-zinc-300">
          <div className="p-4 rounded-lg bg-[#0a0a0b] border border-white/[0.08] flex items-center justify-between gap-4">
            <div>
              <div className="font-medium text-zinc-100">1. Download extension package</div>
              <p className="text-zinc-400 mt-0.5">
                Includes <code className="font-mono text-zinc-200">firefox-agent-bridge.zip</code>.
              </p>
            </div>
            <button
              onClick={handleDownload}
              disabled={isDownloading}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-zinc-100 hover:bg-white text-zinc-950 font-medium text-xs transition-colors whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{isDownloading ? 'Downloading...' : 'Download .zip'}</span>
            </button>
          </div>

          <div className="p-4 rounded-lg bg-[#0a0a0b] border border-white/[0.08] space-y-2">
            <div className="font-medium text-zinc-100">2. Load temporary add-on in Firefox</div>
            <p className="text-zinc-400">
              Open Firefox debugging, click <span className="text-zinc-200">Load Temporary Add-on</span>, and pick the downloaded zip or <code className="font-mono text-zinc-200">manifest.json</code>.
            </p>
            <div className="flex items-center gap-2 pt-1">
              <code className="flex-1 bg-[#111113] px-2.5 py-1.5 rounded-md text-zinc-200 font-mono text-[11px] border border-white/[0.08] truncate select-all">
                {debugUrl}
              </code>
              <button
                onClick={handleCopyDebugUrl}
                className="p-1.5 rounded-md bg-white/[0.05] hover:bg-white/[0.1] text-zinc-300 border border-white/[0.08] transition-colors"
                title="Copy URL"
              >
                {copiedDebugUrl ? <Check className="w-3.5 h-3.5 text-zinc-100" /> : <ExternalLink className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>

          <div className="p-4 rounded-lg bg-[#0a0a0b] border border-white/[0.08] space-y-2">
            <div className="font-medium text-zinc-100">3. Set server URL in the extension popup</div>
            <div className="flex items-center gap-2 pt-1">
              <code className="flex-1 bg-[#111113] px-2.5 py-1.5 rounded-md text-zinc-200 font-mono text-[11px] border border-white/[0.08] truncate select-all">
                {serverUrl}
              </code>
              <button
                onClick={handleCopyServerUrl}
                className="p-1.5 rounded-md bg-white/[0.05] hover:bg-white/[0.1] text-zinc-300 border border-white/[0.08] transition-colors"
                title="Copy Server URL"
              >
                {copiedUrl ? <Check className="w-3.5 h-3.5 text-zinc-100" /> : <RefreshCw className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-white/[0.08] flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-zinc-200 text-xs font-medium transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
