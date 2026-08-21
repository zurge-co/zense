import { useEffect, useState } from "react";
import { FolderOpen, Clock, X } from "lucide-react";
import { useUIStore } from "../../store/uiStore";
import {
  formatRelativeTime,
  loadRecents,
  openFolderFlow,
  removeRecent,
  touchRecent,
  type RecentWorkspace,
} from "../../lib/workspace";

export function WelcomeScreen() {
  const { openWorkspace } = useUIStore();
  const [recents, setRecents] = useState<RecentWorkspace[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadRecents().then((r) => {
      if (!cancelled) setRecents(r);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const openRecent = (w: RecentWorkspace) => {
    void touchRecent(w.path);
    openWorkspace(w.path);
  };

  const forgetRecent = (path: string) => {
    // Update the UI immediately; persistence happens in the background.
    setRecents((rs) => (rs ?? []).filter((r) => r.path !== path));
    void removeRecent(path);
  };

  return (
    <div className="flex h-full flex-col bg-base">
      {/* Drag region for the custom titlebar area */}
      <div data-tauri-drag-region className="h-10 shrink-0" />

      <div className="flex flex-1 items-center justify-center">
        <div className="w-[520px]">
          <div className="mb-8 flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent/15">
              <img src="/zense-logo.svg" alt="Zense" width={28} height={28} />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-fg">Zense</h1>
              <p className="text-[12.5px] text-fg-muted">Review before you commit.</p>
            </div>
          </div>

          <div className="grid grid-cols-[1fr_220px] gap-8">
            {/* Recent */}
            <div>
              <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
                <Clock size={11} />
                Recent Workspaces
              </div>
              <div className="space-y-0.5">
                {recents === null ? (
                  <p className="px-2 py-1.5 text-[12px] text-fg-muted">Loading…</p>
                ) : recents.length === 0 ? (
                  <p className="px-2 py-1.5 text-[12px] text-fg-muted">No recent workspaces</p>
                ) : (
                  recents.map((w) => (
                    <div
                      key={w.path}
                      className="group flex w-full items-center justify-between rounded px-2 py-1.5 hover:bg-hover"
                    >
                      <button onClick={() => openRecent(w)} className="min-w-0 flex-1 text-left">
                        <span className="block truncate text-[13px] text-fg">{w.name}</span>
                        <span className="block truncate font-mono text-[10.5px] text-fg-muted">{w.path}</span>
                      </button>
                      <span className="flex shrink-0 items-center gap-1.5 pl-2">
                        <span className="text-[10.5px] text-fg-muted group-hover:text-fg">
                          {formatRelativeTime(w.lastOpenedAt)}
                        </span>
                        <button
                          title={`Remove ${w.name} from recent workspaces`}
                          aria-label={`Remove ${w.name} from recent workspaces`}
                          onClick={(e) => {
                            e.stopPropagation();
                            forgetRecent(w.path);
                          }}
                          className="rounded p-0.5 text-fg-muted opacity-0 transition-opacity hover:text-danger focus:opacity-100 group-hover:opacity-100"
                        >
                          <X size={12} strokeWidth={1.7} />
                        </button>
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Actions */}
            <div className="space-y-1.5">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">Start</div>
              <Action
                icon={FolderOpen}
                label="Open Folder…"
                hint="⌘O"
                onClick={() => void openFolderFlow()}
                primary
              />
            </div>
          </div>

          <p className="mt-10 text-center text-[10.5px] text-fg-muted">
            Local-first · Privacy by default · Bring Your Own Key
          </p>
        </div>
      </div>
    </div>
  );
}

function Action({
  icon: Icon,
  label,
  hint,
  onClick,
  primary,
}: {
  icon: typeof FolderOpen;
  label: string;
  hint?: string;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center justify-between rounded border px-3 py-2 text-[12.5px] transition-colors ${
        primary
          ? "border-accent/50 bg-accent/10 text-accent hover:bg-accent/20"
          : "border-border bg-panel text-fg-muted hover:border-border hover:text-fg"
      }`}
    >
      <span className="flex items-center gap-2">
        <Icon size={14} />
        {label}
      </span>
      {hint && <span className="text-[10.5px] text-fg-muted">{hint}</span>}
    </button>
  );
}
