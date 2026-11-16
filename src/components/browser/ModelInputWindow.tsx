import React, { useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Maximize2,
  Minimize2,
  Copy,
  Check,
} from 'lucide-react';
import { ModelInputInspector } from '../../types/browser';

interface Props {
  inspectorData: ModelInputInspector | null;
}

type InspectorTab =
  | 'raw_input'
  | 'raw_output'
  | 'history'
  | 'prompt'
  | 'accessibility'
  | 'system'
  | 'screenshot';

export const ModelInputWindow: React.FC<Props> = ({ inspectorData }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<InspectorTab>('raw_input');
  const [copied, setCopied] = useState(false);

  if (!inspectorData) {
    return (
      <div className="h-8 bg-[#111113] border-t border-white/[0.08] text-[11px] text-zinc-500 px-4 flex items-center justify-between shrink-0">
        <span>Inspector</span>
        <span className="text-zinc-600">Idle</span>
      </div>
    );
  }

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const getContentToCopy = () => {
    switch (activeTab) {
      case 'raw_input':
        return JSON.stringify(inspectorData.rawInputJson || {}, null, 2);
      case 'raw_output':
        return JSON.stringify(inspectorData.rawOutputJson || {}, null, 2);
      case 'prompt':
        return inspectorData.fullCurrentTurnPrompt;
      case 'accessibility':
        return inspectorData.accessibilityTree;
      case 'history':
        return JSON.stringify(inspectorData.chatHistory, null, 2);
      case 'system':
        return inspectorData.fullSystemInstruction;
      default:
        return inspectorData.fullCurrentTurnPrompt;
    }
  };

  const tabs: { id: InspectorTab; label: string }[] = [
    { id: 'raw_input', label: 'Input' },
    { id: 'raw_output', label: 'Output' },
    { id: 'history', label: 'History' },
    { id: 'prompt', label: 'Prompt' },
    { id: 'accessibility', label: 'Elements' },
    { id: 'system', label: 'Rules' },
  ];
  if (inspectorData.screenshotPreview) {
    tabs.push({ id: 'screenshot', label: 'Screenshot' });
  }

  return (
    <div
      className={`bg-[#111113] border-t border-white/[0.08] transition-all duration-150 z-40 flex flex-col shrink-0 ${
        isOpen ? (isExpanded ? 'h-[460px]' : 'h-[240px]') : 'h-8'
      }`}
    >
      {/* Slim Monochrome Titlebar */}
      <div className="h-8 px-4 flex items-center justify-between gap-4 select-none border-b border-white/[0.06]">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-2 text-[11px] text-zinc-300 hover:text-white transition-colors min-w-0"
        >
          <span className="font-medium">Inspector</span>
          <span className="text-zinc-600" aria-hidden="true">·</span>
          <span className="font-mono text-zinc-400 truncate">{inspectorData.model}</span>
          {inspectorData.decisionGate && (
            <>
              <span className="text-zinc-600 hidden sm:inline" aria-hidden="true">·</span>
              <span className="font-mono tabular-nums text-zinc-500 hidden sm:inline">
                {inspectorData.decisionGate.route} ({inspectorData.decisionGate.latencyMs}ms)
              </span>
            </>
          )}
        </button>

        <div className="flex items-center gap-1.5 shrink-0">
          {isOpen && (
            <>
              <div className="hidden md:flex items-center bg-[#0a0a0b] p-0.5 rounded-md border border-white/[0.08] text-[11px]">
                {tabs.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setActiveTab(t.id)}
                    className={`px-2 py-0.5 rounded transition-colors whitespace-nowrap ${
                      activeTab === t.id
                        ? 'bg-zinc-100 text-zinc-950 font-medium'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {activeTab !== 'screenshot' && (
                <button
                  onClick={() => handleCopy(getContentToCopy())}
                  className="p-1 rounded hover:bg-white/[0.06] text-zinc-400 hover:text-zinc-100 transition-colors"
                  title="Copy payload"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-zinc-100" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              )}

              <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="p-1 rounded hover:bg-white/[0.06] text-zinc-400 hover:text-zinc-100 transition-colors"
                title={isExpanded ? 'Collapse height' : 'Expand height'}
              >
                {isExpanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
              </button>
            </>
          )}

          <button
            onClick={() => setIsOpen(!isOpen)}
            className="p-1 rounded hover:bg-white/[0.06] text-zinc-400 hover:text-zinc-100 transition-colors"
            title={isOpen ? 'Minimize inspector' : 'Open inspector'}
          >
            {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Body */}
      {isOpen && (
        <div className="flex-1 overflow-auto bg-[#0a0a0b] p-3 font-mono text-[11px] text-zinc-300">
          {activeTab === 'raw_input' && (
            <pre className="whitespace-pre-wrap leading-relaxed select-text">
              {JSON.stringify(inspectorData.rawInputJson || {}, null, 2)}
            </pre>
          )}

          {activeTab === 'raw_output' && (
            <pre className="whitespace-pre-wrap leading-relaxed select-text">
              {JSON.stringify(inspectorData.rawOutputJson || {}, null, 2)}
            </pre>
          )}

          {activeTab === 'history' && (
            <pre className="whitespace-pre-wrap leading-relaxed select-text">
              {JSON.stringify(inspectorData.chatHistory, null, 2)}
            </pre>
          )}

          {activeTab === 'prompt' && (
            <pre className="whitespace-pre-wrap leading-relaxed select-text">
              {inspectorData.fullCurrentTurnPrompt}
            </pre>
          )}

          {activeTab === 'accessibility' && (
            <pre className="whitespace-pre-wrap leading-relaxed select-text">
              {inspectorData.accessibilityTree || 'No interactive elements found.'}
            </pre>
          )}

          {activeTab === 'system' && (
            <pre className="whitespace-pre-wrap leading-relaxed select-text">
              {inspectorData.fullSystemInstruction}
            </pre>
          )}

          {activeTab === 'screenshot' && inspectorData.screenshotPreview && (
            <div className="flex justify-center">
              <img
                src={inspectorData.screenshotPreview}
                alt="Viewport screenshot"
                className="max-h-[380px] object-contain rounded border border-white/[0.1]"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
};
