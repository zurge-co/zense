import { X, MessageSquare } from "lucide-react";
import { useUIStore } from "../../store/uiStore";

export function ComposerPanel() {
  const { toggleChat, openSettings } = useUIStore();

  return (
    <div className="flex w-80 shrink-0 flex-col border-l border-border bg-panel">
      {/* Header */}
      <div className="flex h-8 shrink-0 items-center justify-between border-b border-border px-3">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
          <MessageSquare size={12} className="text-accent" />
          Chat
        </span>
        <button onClick={toggleChat} className="rounded p-1 text-fg-muted hover:bg-hover hover:text-fg">
          <X size={13} />
        </button>
      </div>

      {/* Empty state — LLM not configured yet (Phase 3) */}
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-fg-muted">
        <MessageSquare size={22} strokeWidth={1.2} />
        <p className="text-[12px]">AI chat coming soon</p>
        <button
          onClick={() => openSettings()}
          className="rounded border border-border bg-base px-3 py-1.5 text-[12px] text-fg-muted hover:text-fg"
        >
          Open Settings
        </button>
      </div>
    </div>
  );
}
