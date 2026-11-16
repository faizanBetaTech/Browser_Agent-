import React, { useState, useEffect } from 'react';
import { X, AlertCircle, CheckCircle2, RefreshCw, Copy, Check } from 'lucide-react';
import { ProxyTunnelConfig, EgressIpInfo } from '../../types/browser';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onProxyUpdated?: () => void;
}

export const ProxyTunnelModal: React.FC<Props> = ({ isOpen, onClose, onProxyUpdated }) => {
  const [proxyConfig, setProxyConfig] = useState<ProxyTunnelConfig>({
    enabled: false,
    server: '',
    username: '',
    password: '',
  });
  const [ipInfo, setIpInfo] = useState<EgressIpInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copiedCmd, setCopiedCmd] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadStatus();
    }
  }, [isOpen]);

  const loadStatus = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const res = await fetch('/api/proxy/status');
      const data = await res.json();
      if (data.proxyConfig) {
        setProxyConfig(data.proxyConfig);
      }
      const testRes = await fetch('/api/proxy/test', { method: 'POST' });
      const testData = await testRes.json();
      if (testData.ipInfo) {
        setIpInfo(testData.ipInfo);
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to load proxy status');
    } finally {
      setIsLoading(false);
    }
  };

  const handleTestIp = async () => {
    setIsTesting(true);
    setErrorMessage(null);
    try {
      const res = await fetch('/api/proxy/test', { method: 'POST' });
      const data = await res.json();
      if (data.ipInfo) {
        setIpInfo(data.ipInfo);
      } else if (data.error) {
        setErrorMessage(data.error);
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to check IP');
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    setSaveSuccess(false);
    try {
      const res = await fetch('/api/proxy/configure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(proxyConfig),
      });
      const data = await res.json();
      if (data.success) {
        setSaveSuccess(true);
        if (data.ipInfo) {
          setIpInfo(data.ipInfo);
        }
        onProxyUpdated?.();
        setTimeout(() => setSaveSuccess(false), 3000);
      } else {
        setErrorMessage(data.error || 'Failed to apply proxy settings');
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Error saving proxy settings');
    } finally {
      setIsLoading(false);
    }
  };

  const copyCmd = () => {
    navigator.clipboard.writeText('ssh -D 1080 -N localhost');
    setCopiedCmd(true);
    setTimeout(() => setCopiedCmd(false), 1800);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-[#111113] border border-white/[0.1] rounded-xl max-w-xl w-full overflow-hidden my-8">
        {/* Header */}
        <div className="px-6 py-4 border-b border-white/[0.08] flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">Proxy Settings</h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              Route Chromium requests through an HTTP or SOCKS5 proxy.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-zinc-400 hover:text-white hover:bg-white/[0.06] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-5 text-xs text-zinc-300">
          {/* Current IP Summary */}
          <div className="bg-[#0a0a0b] border border-white/[0.08] rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-medium text-zinc-200">Current Egress</span>
              <button
                onClick={handleTestIp}
                disabled={isTesting}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs bg-white/[0.05] hover:bg-white/[0.1] text-zinc-200 border border-white/[0.08] transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`w-3 h-3 ${isTesting ? 'animate-spin' : ''}`} />
                <span>{isTesting ? 'Checking...' : 'Check IP'}</span>
              </button>
            </div>

            <div className="grid grid-cols-3 gap-3 text-xs">
              <div>
                <div className="text-[11px] text-zinc-500">IP Address</div>
                <div className="font-mono tabular-nums text-zinc-100 mt-0.5 truncate">
                  {ipInfo?.query || '—'}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-zinc-500">Network</div>
                <div className="text-zinc-200 mt-0.5 truncate" title={ipInfo?.isp}>
                  {ipInfo?.isp || '—'}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-zinc-500">Location</div>
                <div className="text-zinc-200 mt-0.5 truncate">
                  {ipInfo?.city && ipInfo?.country ? `${ipInfo.city}, ${ipInfo.country}` : ipInfo?.country || '—'}
                </div>
              </div>
            </div>
          </div>

          {/* Toggle & Fields */}
          <div className="space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-white/[0.08]">
              <div>
                <div className="font-medium text-zinc-100">Enable Proxy</div>
                <div className="text-zinc-400 mt-0.5">
                  Applies to all new requests in Chromium.
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={proxyConfig.enabled}
                  onChange={(e) => setProxyConfig({ ...proxyConfig, enabled: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-10 h-5 bg-zinc-800 rounded-full peer peer-checked:bg-zinc-100 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-zinc-400 peer-checked:after:bg-zinc-950 after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-5" />
              </label>
            </div>

            <div>
              <label className="block font-medium text-zinc-200 mb-1.5">Server URL</label>
              <input
                type="text"
                placeholder="socks5://127.0.0.1:1080 or http://host:8080"
                value={proxyConfig.server}
                onChange={(e) => setProxyConfig({ ...proxyConfig, server: e.target.value })}
                className="w-full bg-[#0a0a0b] border border-white/[0.1] focus:border-white/[0.3] rounded-lg px-3 py-2 text-xs font-mono text-zinc-100 placeholder:text-zinc-600 outline-none"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-medium text-zinc-200 mb-1.5">Username (optional)</label>
                <input
                  type="text"
                  placeholder="Username"
                  value={proxyConfig.username || ''}
                  onChange={(e) => setProxyConfig({ ...proxyConfig, username: e.target.value })}
                  className="w-full bg-[#0a0a0b] border border-white/[0.1] focus:border-white/[0.3] rounded-lg px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-600 outline-none"
                />
              </div>

              <div>
                <label className="block font-medium text-zinc-200 mb-1.5">Password (optional)</label>
                <input
                  type="password"
                  placeholder="Password"
                  value={proxyConfig.password || ''}
                  onChange={(e) => setProxyConfig({ ...proxyConfig, password: e.target.value })}
                  className="w-full bg-[#0a0a0b] border border-white/[0.1] focus:border-white/[0.3] rounded-lg px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-600 outline-none"
                />
              </div>
            </div>

            <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-[#0a0a0b] border border-white/[0.06] text-[11px] text-zinc-400">
              <span className="font-mono">ssh -D 1080 -N localhost</span>
              <button
                onClick={copyCmd}
                className="text-zinc-400 hover:text-zinc-100 p-1 transition-colors"
                title="Copy SSH tunnel command"
              >
                {copiedCmd ? <Check className="w-3.5 h-3.5 text-zinc-100" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>

            {errorMessage && (
              <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-200 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}

            {saveSuccess && (
              <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-200 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>Proxy settings applied.</span>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-white/[0.08] flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg text-xs font-medium text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.05] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isLoading}
            className="px-4 py-1.5 rounded-lg text-xs font-medium bg-zinc-100 hover:bg-white text-zinc-950 transition-colors disabled:opacity-50"
          >
            {isLoading ? 'Applying...' : 'Apply'}
          </button>
        </div>
      </div>
    </div>
  );
};
