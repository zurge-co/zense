import { useEffect, useRef, useState } from "react";
import { PanelLeft, PanelRight, GitBranch, FolderOpen, Clock } from "lucide-react";
import { useUIStore } from "../../store/uiStore";
import {
  formatRelativeTime,
  loadRecents,
  openFolderFlow,
  switchWorkspaceFlow,
  type RecentWorkspace,
} from "../../lib/workspace";

export function TitleBar() {
  const { toggleSidebar, toggleChat, sidebarVisible, chatVisible } =
    useUIStore();
  const workspaceName = useUIStore((s) => s.workspaceName);
  const workspacePath = useUIStore((s) => s.workspacePath);
  const [menuOpen, setMenuOpen] = useState(false);
  const [recents, setRecents] = useState<RecentWorkspace[]>([]);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    loadRecents().then((r) => {
      setRecents(r.filter((w) => w.path !== workspacePath));
    });
  }, [menuOpen, workspacePath]);

  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onEsc);
    return () => {
      window.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onEsc);
    };
  }, [menuOpen]);

  return (
    <div
      data-tauri-drag-region
      className="flex h-10 shrink-0 items-center border-b border-border bg-panel pl-20 pr-2"
    >
      <div data-tauri-drag-region className="flex items-center gap-2 text-xs text-fg-muted">
        <img src="/zense-logo.svg" alt="Zense" width={16} height={16} />
        <span className="font-semibold text-fg">zense</span>
        <span className="text-fg-muted">—</span>
        <span>{workspaceName ?? "no workspace"}</span>
        <span className="ml-2 flex items-center gap-1 rounded bg-panel px-1.5 py-0.5 text-[11px] text-fg-muted">
          <GitBranch size={11} />
          main
        </span>
      </div>

      <div data-tauri-drag-region className="flex-1" />

      <div className="flex items-center gap-0.5">
        <button
          onClick={() => setMenuOpen((o) => !o)}
          title="Switch Workspace"
          className={`rounded p-1.5 hover:bg-hover ${menuOpen ? "text-fg" : "text-fg-muted"}`}
        >
          <FolderOpen size={15} />
        </button>
        <button
          onClick={toggleSidebar}
          title="Toggle Sidebar (⌘B)"
          className={`rounded p-1.5 hover:bg-hover ${sidebarVisible ? "text-fg" : "text-fg-muted"}`}
        >
          <PanelLeft size={15} />
        </button>
        <button
          onClick={toggleChat}
          title="Toggle AI Chat"
          className={`rounded p-1.5 hover:bg-hover ${chatVisible ? "text-fg" : "text-fg-muted"}`}
        >
          <PanelRight size={15} />
        </button>
      </div>

      {menuOpen && (
        <div
          ref={menuRef}
          className="absolute right-2 top-10 z-50 w-72 rounded-md border border-border bg-panel shadow-xl"
          data-no-drag
        >
          <div className="flex items-center gap-1.5 border-b border-border px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
            <Clock size={11} />
            Recent Workspaces
          </div>
          <div className="max-h-72 overflow-y-auto p-1">
            {recents.length === 0 ? (
              <p className="px-2 py-1.5 text-[12px] text-fg-muted">No recent workspaces</p>
            ) : (
              recents.map((w) => (
                <button
                  key={w.path}
                  onClick={() => {
                    setMenuOpen(false);
                    void switchWorkspaceFlow(w.path);
                  }}
                  className="group flex w-full items-center justify-between rounded px-2 py-1.5 text-left hover:bg-hover"
                >
                  <span>
                    <span className="block text-[13px] text-fg">{w.name}</span>
                    <span className="block font-mono text-[10.5px] text-fg-muted">{w.path}</span>
                  </span>
                  <span className="text-[10.5px] text-fg-muted group-hover:text-fg">
                    {formatRelativeTime(w.lastOpenedAt)}
                  </span>
                </button>
              ))
            )}
          </div>
          <div className="border-t border-border p-1">
            <button
              onClick={() => {
                setMenuOpen(false);
                void openFolderFlow();
              }}
              className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-[12.5px] text-fg hover:bg-hover"
            >
              <span className="flex items-center gap-2">
                <FolderOpen size={13} />
                Open Folder…
              </span>
              <span className="text-[10.5px] text-fg-muted">⌘O</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
