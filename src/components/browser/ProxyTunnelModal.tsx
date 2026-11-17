import React, { useState, useEffect, useCallback } from 'react';
import { X, AlertCircle, CheckCircle2, RefreshCw, Copy, Check, ChevronDown, ChevronRight } from 'lucide-react';
import { ProxyTunnelConfig, EgressIpInfo } from '../../types/browser';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onProxyUpdated?: () => void;
}

const GOST_BORE_CMD = 'gost -L "http://myuser:mypass@127.0.0.1:8080" & bore local 8080 --to bore.pub';

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
  const [showGuide, setShowGuide] = useState(false);
  const [copiedCmd, setCopiedCmd] = useState(false);

  const loadStatus = useCallback(async () => {
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
  }, []);

  useEffect(() => {
    if (isOpen) {
      loadStatus();
    }
  }, [isOpen, loadStatus]);

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

  const applyConfig = async (nextConfig: ProxyTunnelConfig) => {
    setIsLoading(true);
    setErrorMessage(null);
    setSaveSuccess(false);
    try {
      const res = await fetch('/api/proxy/configure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nextConfig),
      });
      const data = await res.json();
      if (data.proxyConfig) {
        setProxyConfig(data.proxyConfig);
      }
      if (data.success) {
        setSaveSuccess(true);
        if (data.ipInfo) {
          setIpInfo(data.ipInfo);
        }
        onProxyUpdated?.();
        setTimeout(() => setSaveSuccess(false), 2500);
      } else {
        setErrorMessage(data.error || 'Failed to apply proxy settings');
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Error saving proxy settings');
    } finally {
      setIsLoading(false);
    }
  };

  const handleToggleEnabled = async (nextEnabled: boolean) => {
    const nextConfig: ProxyTunnelConfig = {
      ...proxyConfig,
      enabled: nextEnabled,
    };
    setProxyConfig(nextConfig);

    // Turning OFF or turning ON with a Server URL already filled applies immediately
    if (!nextEnabled || proxyConfig.server.trim()) {
      await applyConfig(nextConfig);
    }
  };

  const handleSave = async () => {
    await applyConfig(proxyConfig);
  };

  const copyCmd = () => {
    navigator.clipboard.writeText(GOST_BORE_CMD);
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
                  Only routes Chromium traffic through the proxy when toggled ON.
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={proxyConfig.enabled}
                  disabled={isLoading}
                  onChange={(e) => handleToggleEnabled(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-10 h-5 bg-zinc-800 rounded-full peer peer-checked:bg-zinc-100 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-zinc-400 peer-checked:after:bg-zinc-950 after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-5" />
              </label>
            </div>

            <div>
              <label className="block font-medium text-zinc-200 mb-1.5">Server URL</label>
              <input
                type="text"
                placeholder="http://bore.pub:12345 or socks5://host:1080"
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
                  placeholder="myuser"
                  value={proxyConfig.username || ''}
                  onChange={(e) => setProxyConfig({ ...proxyConfig, username: e.target.value })}
                  className="w-full bg-[#0a0a0b] border border-white/[0.1] focus:border-white/[0.3] rounded-lg px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-600 outline-none"
                />
              </div>

              <div>
                <label className="block font-medium text-zinc-200 mb-1.5">Password (optional)</label>
                <input
                  type="password"
                  placeholder="mypass"
                  value={proxyConfig.password || ''}
                  onChange={(e) => setProxyConfig({ ...proxyConfig, password: e.target.value })}
                  className="w-full bg-[#0a0a0b] border border-white/[0.1] focus:border-white/[0.3] rounded-lg px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-600 outline-none"
                />
              </div>
            </div>

            {/* Expandable antiX gost + bore guide */}
            <div className="rounded-lg bg-[#0a0a0b] border border-white/[0.08] overflow-hidden">
              <button
                type="button"
                onClick={() => setShowGuide(!showGuide)}
                className="w-full px-3 py-2.5 flex items-center justify-between text-left text-zinc-300 hover:text-zinc-100 transition-colors"
              >
                <span className="font-medium">Use your antiX PC as a free proxy (gost + bore)</span>
                {showGuide ? <ChevronDown className="w-3.5 h-3.5 text-zinc-500" /> : <ChevronRight className="w-3.5 h-3.5 text-zinc-500" />}
              </button>

              {showGuide && (
                <div className="px-3 pb-3 pt-1 border-t border-white/[0.06] space-y-2 text-[11px] text-zinc-400">
                  <p>
                    Run an authenticated <code className="text-zinc-200">http://</code> proxy on antiX (Chromium supports username/password auth on HTTP proxies, not SOCKS5) and expose it with <code className="text-zinc-200">bore</code>:
                  </p>
                  <div className="flex items-center justify-between gap-2 px-2.5 py-2 rounded bg-[#111113] border border-white/[0.08] text-zinc-200">
                    <code className="font-mono break-all select-all">{GOST_BORE_CMD}</code>
                    <button
                      type="button"
                      onClick={copyCmd}
                      className="text-zinc-400 hover:text-zinc-100 p-1 shrink-0 transition-colors"
                      title="Copy command"
                    >
                      {copiedCmd ? <Check className="w-3.5 h-3.5 text-zinc-100" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                  <p>
                    Copy the <code className="text-zinc-200">bore.pub:&lt;port&gt;</code> printed in terminal, enter <code className="text-zinc-200">http://bore.pub:&lt;port&gt;</code> plus your username/password above, then toggle Enable Proxy ON.
                  </p>
                </div>
              )}
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
            Close
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
