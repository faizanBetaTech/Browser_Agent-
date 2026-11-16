import React, { useState, useRef, useEffect } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  RotateCw,
  Home,
  Lock,
  Copy,
  Plus,
  X,
  Code2,
  ChevronUp,
  ChevronDown,
  Check,
  Globe,
  RefreshCw,
  Keyboard,
  CornerDownLeft,
  Delete,
} from 'lucide-react';
import { BrowserAction, RealBrowserStateResponse } from '../../types/browser';

interface Props {
  realBrowserState: RealBrowserStateResponse | null;
  isLoadingBrowser: boolean;
  onNavigate: (url: string) => void;
  onOpenTab: (url?: string) => void;
  onSwitchTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onRefresh: () => void;
  onScroll: (direction: 'up' | 'down') => void;
  onManualClickCanvas: (x: number, y: number) => void;
  onKeyboardType?: (text: string) => void;
  onKeyboardPress?: (key: string) => void;
  onClearInput?: () => void;
  lastAction: BrowserAction | null;
  activeTarget?: 'cloud' | 'extension';
  isExtensionConnected?: boolean;
  clientInfo?: any;
  onToggleTarget?: (target: 'cloud' | 'extension') => void;
  onOpenExtensionModal?: () => void;
  onOpenProxyModal?: () => void;
}

export const ChromiumBrowser: React.FC<Props> = ({
  realBrowserState,
  isLoadingBrowser,
  onNavigate,
  onOpenTab,
  onSwitchTab,
  onCloseTab,
  onRefresh,
  onScroll,
  onManualClickCanvas,
  onKeyboardType,
  onKeyboardPress,
  onClearInput,
  lastAction,
}) => {
  const [urlInputValue, setUrlInputValue] = useState(
    realBrowserState?.url || 'https://news.ycombinator.com'
  );
  const [typeInputValue, setTypeInputValue] = useState('');
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [showKeyboardBar, setShowKeyboardBar] = useState(false);
  const [showDevDrawer, setShowDevDrawer] = useState(false);
  const [devTab, setDevTab] = useState<'overview' | 'dom' | 'action'>('overview');
  const [clickIndicator, setClickIndicator] = useState<{ x: number; y: number } | null>(null);
  const [isViewportFocused, setIsViewportFocused] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (realBrowserState?.url) {
      setUrlInputValue(realBrowserState.url);
    }
  }, [realBrowserState?.url]);

  const handleUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!urlInputValue.trim()) return;
    onNavigate(urlInputValue.trim());
  };

  const handleCopyUrl = () => {
    navigator.clipboard.writeText(realBrowserState?.url || '');
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 1500);
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    const rect = img.getBoundingClientRect();
    const scaleX = 1280 / rect.width;
    const scaleY = 800 / rect.height;
    const x = Math.max(0, Math.min(1280, Math.round((e.clientX - rect.left) * scaleX)));
    const y = Math.max(0, Math.min(800, Math.round((e.clientY - rect.top) * scaleY)));

    setClickIndicator({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    setTimeout(() => setClickIndicator(null), 650);

    onManualClickCanvas(x, y);
    viewportRef.current?.focus();
    setIsViewportFocused(true);
  };

  const handleViewportKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
      return;
    }

    if (e.key === 'Tab' || e.key === 'Enter' || e.key === 'Backspace' || e.key === 'Escape') {
      e.preventDefault();
      onKeyboardPress?.(e.key);
      return;
    }
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      e.preventDefault();
      onKeyboardPress?.(e.key);
      return;
    }
    if (e.key === ' ') {
      e.preventDefault();
      onKeyboardType?.(' ');
      return;
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      onKeyboardType?.(e.key);
    }
  };

  const handleQuickTypeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!typeInputValue) return;
    onKeyboardType?.(typeInputValue);
    setTypeInputValue('');
  };

  const tabs = realBrowserState?.tabs || [
    {
      id: 'tab-1',
      title: 'New Tab',
      url: realBrowserState?.url || 'https://news.ycombinator.com',
    },
  ];
  const activeTabId = realBrowserState?.activeTabId || 'tab-1';

  return (
    <div className="flex-1 flex flex-col h-full bg-[#0a0a0b] text-zinc-100 overflow-hidden select-none">
      {/* 1. Minimal Tab Strip */}
      <div className="h-9 bg-[#0a0a0b] border-b border-white/[0.08] px-2 flex items-end gap-1 overflow-x-auto no-scrollbar">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              onClick={() => onSwitchTab(tab.id)}
              className={`group flex items-center gap-2 px-3 py-1.5 rounded-t-md text-xs cursor-pointer transition-colors max-w-[220px] min-w-[120px] ${
                isActive
                  ? 'bg-[#161619] text-zinc-100 border-t border-x border-white/[0.1]'
                  : 'text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.03]'
              }`}
            >
              <span className="truncate flex-1">{tab.title || tab.url}</span>
              {tabs.length > 1 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseTab(tab.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 hover:bg-white/[0.08] p-0.5 rounded text-zinc-400 hover:text-white transition-opacity"
                  title="Close tab"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          );
        })}

        <button
          onClick={() => onOpenTab('https://news.ycombinator.com')}
          className="p-1.5 mb-0.5 text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.05] rounded-md transition-colors shrink-0"
          title="New tab"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* 2. Clean Address & Navigation Toolbar */}
      <div className="h-11 bg-[#111113] border-b border-white/[0.08] px-3 flex items-center gap-2">
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            onClick={() => onNavigate(realBrowserState?.url || '')}
            className="p-1.5 rounded-md hover:bg-white/[0.06] text-zinc-400 hover:text-zinc-100 transition-colors"
            title="Back"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => onNavigate(realBrowserState?.url || '')}
            className="p-1.5 rounded-md hover:bg-white/[0.06] text-zinc-400 hover:text-zinc-100 transition-colors"
            title="Forward"
          >
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onRefresh}
            className="p-1.5 rounded-md hover:bg-white/[0.06] text-zinc-400 hover:text-zinc-100 transition-colors"
            title="Reload"
          >
            <RotateCw className={`w-3.5 h-3.5 ${isLoadingBrowser ? 'animate-spin text-zinc-100' : ''}`} />
          </button>
          <button
            onClick={() => onNavigate('https://news.ycombinator.com')}
            className="p-1.5 rounded-md hover:bg-white/[0.06] text-zinc-400 hover:text-zinc-100 transition-colors"
            title="Home"
          >
            <Home className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Omnibox */}
        <form onSubmit={handleUrlSubmit} className="flex-1 max-w-3xl relative flex items-center">
          <div className="absolute left-3 flex items-center text-zinc-500">
            {urlInputValue.startsWith('https://') ? (
              <Lock className="w-3 h-3 text-zinc-400" />
            ) : (
              <Globe className="w-3 h-3" />
            )}
          </div>

          <input
            type="text"
            value={urlInputValue}
            onChange={(e) => setUrlInputValue(e.target.value)}
            className="w-full bg-[#0a0a0b] border border-white/[0.08] hover:border-white/[0.14] focus:border-white/[0.28] rounded-lg py-1.5 pl-8 pr-9 text-xs text-zinc-100 font-mono transition-colors outline-none"
            placeholder="Enter URL or search..."
          />

          <button
            type="button"
            onClick={handleCopyUrl}
            className="absolute right-2 p-1 text-zinc-500 hover:text-zinc-200 rounded transition-colors"
            title="Copy URL"
          >
            {copiedUrl ? <Check className="w-3 h-3 text-zinc-100" /> : <Copy className="w-3 h-3" />}
          </button>
        </form>

        {/* Quiet Utility Controls */}
        <div className="flex items-center gap-1 ml-auto shrink-0">
          <button
            onClick={() => onScroll('up')}
            className="p-1.5 rounded-md hover:bg-white/[0.06] text-zinc-400 hover:text-zinc-100 transition-colors"
            title="Scroll up"
          >
            <ChevronUp className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => onScroll('down')}
            className="p-1.5 rounded-md hover:bg-white/[0.06] text-zinc-400 hover:text-zinc-100 transition-colors"
            title="Scroll down"
          >
            <ChevronDown className="w-3.5 h-3.5" />
          </button>

          <div className="w-px h-4 bg-white/[0.08] mx-1" />

          <button
            onClick={() => setShowKeyboardBar(!showKeyboardBar)}
            className={`p-1.5 rounded-md transition-colors ${
              showKeyboardBar
                ? 'bg-zinc-100 text-zinc-950'
                : 'text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.06]'
            }`}
            title="Toggle quick keyboard bar"
          >
            <Keyboard className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={() => setShowDevDrawer(!showDevDrawer)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
              showDevDrawer
                ? 'bg-zinc-100 text-zinc-950'
                : 'text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.06]'
            }`}
            title="Toggle DOM inspector"
          >
            <Code2 className="w-3.5 h-3.5" />
            <span className="hidden lg:inline">DOM</span>
          </button>
        </div>
      </div>

      {/* Optional Quick Keyboard Bar (Collapsed by default for clean viewport) */}
      {showKeyboardBar && (
        <div className="bg-[#111113] border-b border-white/[0.08] px-3 py-1.5 flex flex-wrap items-center gap-2 text-xs">
          <form onSubmit={handleQuickTypeSubmit} className="flex-1 min-w-[220px] flex items-center gap-1.5">
            <input
              type="text"
              value={typeInputValue}
              onChange={(e) => setTypeInputValue(e.target.value)}
              placeholder={
                realBrowserState?.focusedElement?.isInput
                  ? `Type into ${realBrowserState.focusedElement.placeholder || realBrowserState.focusedElement.tagName}...`
                  : 'Click a field in the browser, then type here...'
              }
              className="flex-1 bg-[#0a0a0b] border border-white/[0.08] focus:border-white/[0.25] rounded-md px-2.5 py-1 text-xs text-zinc-100 placeholder:text-zinc-500 outline-none"
            />
            <button
              type="submit"
              disabled={!typeInputValue}
              className="px-2.5 py-1 bg-zinc-100 hover:bg-white disabled:opacity-30 text-zinc-950 rounded-md font-medium text-xs flex items-center gap-1 shrink-0 transition-colors"
            >
              <span>Type</span>
              <CornerDownLeft className="w-3 h-3" />
            </button>
          </form>

          <div className="flex items-center gap-1 font-mono text-[11px]">
            <button
              onClick={() => onKeyboardPress?.('Tab')}
              className="px-2 py-1 rounded-md bg-[#18181b] hover:bg-zinc-800 border border-white/[0.08] text-zinc-300 transition-colors"
            >
              Tab
            </button>
            <button
              onClick={() => onKeyboardPress?.('Enter')}
              className="px-2 py-1 rounded-md bg-[#18181b] hover:bg-zinc-800 border border-white/[0.08] text-zinc-300 transition-colors"
            >
              Enter
            </button>
            <button
              onClick={() => onKeyboardPress?.('Backspace')}
              className="p-1.5 rounded-md bg-[#18181b] hover:bg-zinc-800 border border-white/[0.08] text-zinc-300 transition-colors"
              title="Backspace"
            >
              <Delete className="w-3 h-3" />
            </button>
            {onClearInput && (
              <button
                onClick={onClearInput}
                className="px-2 py-1 rounded-md bg-[#18181b] hover:bg-zinc-800 border border-white/[0.08] text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      )}

      {/* 3. Main Browser Viewport */}
      <div className="flex-1 relative bg-[#0a0a0b] overflow-hidden flex flex-col items-center justify-center">
        {realBrowserState?.screenshotBase64 ? (
          <div
            ref={viewportRef}
            tabIndex={0}
            onKeyDown={handleViewportKeyDown}
            onFocus={() => setIsViewportFocused(true)}
            onBlur={() => setIsViewportFocused(false)}
            className="w-full h-full relative overflow-auto flex items-start justify-center p-3 outline-none"
            title="Click to interact directly with the page"
          >
            <div
              className={`relative border rounded-lg overflow-hidden bg-black transition-colors ${
                isViewportFocused ? 'border-white/[0.22]' : 'border-white/[0.08]'
              }`}
            >
              <img
                src={realBrowserState.screenshotBase64}
                alt="Live browser viewport"
                className="max-w-full h-auto cursor-crosshair block select-none"
                onClick={handleCanvasClick}
              />

              {clickIndicator && (
                <div
                  className="absolute w-5 h-5 -ml-2.5 -mt-2.5 rounded-full border border-white bg-white/25 animate-ping pointer-events-none z-30"
                  style={{ left: clickIndicator.x, top: clickIndicator.y }}
                />
              )}

              {lastAction && (
                <div className="absolute bottom-2.5 left-2.5 bg-[#111113]/90 backdrop-blur-md border border-white/[0.1] rounded-md px-2.5 py-1 flex items-center gap-2 text-[11px] font-mono pointer-events-none z-20 text-zinc-300">
                  <span className="text-zinc-100 font-medium">{lastAction.type}</span>
                  {lastAction.target && <span className="text-zinc-400">{lastAction.target}</span>}
                  {lastAction.summary && (
                    <span className="text-zinc-500 max-w-[260px] truncate">{lastAction.summary}</span>
                  )}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-3 text-zinc-500 p-8 text-center">
            <RefreshCw className="w-5 h-5 text-zinc-300 animate-spin" />
            <p className="text-xs text-zinc-400">Starting browser...</p>
          </div>
        )}

        {/* 4. Clean Slide-up DOM Drawer */}
        {showDevDrawer && (
          <div className="absolute inset-x-0 bottom-0 max-h-[55%] h-64 bg-[#111113] border-t border-white/[0.1] flex flex-col z-20">
            <div className="h-9 flex items-center justify-between px-4 border-b border-white/[0.08] text-xs">
              <div className="flex items-center gap-4">
                <button
                  onClick={() => setDevTab('overview')}
                  className={`py-2 text-xs font-medium border-b-2 transition-colors ${
                    devTab === 'overview'
                      ? 'text-zinc-100 border-zinc-100'
                      : 'text-zinc-500 border-transparent hover:text-zinc-300'
                  }`}
                >
                  Overview
                </button>
                <button
                  onClick={() => setDevTab('dom')}
                  className={`py-2 text-xs font-medium border-b-2 transition-colors ${
                    devTab === 'dom'
                      ? 'text-zinc-100 border-zinc-100'
                      : 'text-zinc-500 border-transparent hover:text-zinc-300'
                  }`}
                >
                  DOM ({realBrowserState?.cleanedHtmlLength?.toLocaleString() || 0})
                </button>
                <button
                  onClick={() => setDevTab('action')}
                  className={`py-2 text-xs font-medium border-b-2 transition-colors ${
                    devTab === 'action'
                      ? 'text-zinc-100 border-zinc-100'
                      : 'text-zinc-500 border-transparent hover:text-zinc-300'
                  }`}
                >
                  Last Action
                </button>
              </div>

              <button
                onClick={() => setShowDevDrawer(false)}
                className="text-zinc-400 hover:text-white p-1 rounded hover:bg-white/[0.06] transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="flex-1 overflow-auto p-4 text-xs">
              {devTab === 'overview' && (
                <div className="grid grid-cols-3 gap-4 max-w-2xl">
                  <div className="p-3 rounded-lg bg-[#0a0a0b] border border-white/[0.08]">
                    <div className="text-[11px] text-zinc-500">Raw HTML</div>
                    <div className="text-sm font-mono tabular-nums font-medium text-zinc-100 mt-1">
                      {(realBrowserState?.rawHtmlLength || 0).toLocaleString()} B
                    </div>
                  </div>
                  <div className="p-3 rounded-lg bg-[#0a0a0b] border border-white/[0.08]">
                    <div className="text-[11px] text-zinc-500">Stripped Payload</div>
                    <div className="text-sm font-mono tabular-nums font-medium text-zinc-100 mt-1">
                      {(realBrowserState?.cleanedHtmlLength || 0).toLocaleString()} B
                    </div>
                  </div>
                  <div className="p-3 rounded-lg bg-[#0a0a0b] border border-white/[0.08]">
                    <div className="text-[11px] text-zinc-500">Indexed Elements</div>
                    <div className="text-sm font-mono tabular-nums font-medium text-zinc-100 mt-1">
                      {realBrowserState?.elementCount || 0}
                    </div>
                  </div>
                </div>
              )}

              {devTab === 'dom' && (
                <pre className="font-mono text-[11px] text-zinc-300 whitespace-pre-wrap leading-relaxed select-all">
                  {realBrowserState?.cleanedHtml || 'No DOM content available.'}
                </pre>
              )}

              {devTab === 'action' && (
                <div className="font-mono text-xs text-zinc-300">
                  {lastAction ? (
                    <pre className="p-3 rounded-lg bg-[#0a0a0b] border border-white/[0.08] whitespace-pre-wrap">
                      {JSON.stringify(lastAction, null, 2)}
                    </pre>
                  ) : (
                    <span className="text-zinc-500">No actions executed yet.</span>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
