import { PanelLeft, PanelBottom, PanelRight, GitBranch } from "lucide-react";
import { useUIStore } from "../../store/uiStore";

export function TitleBar() {
  const { toggleSidebar, toggleBottom, toggleChat, sidebarVisible, bottomVisible, chatVisible } =
    useUIStore();
  const workspaceName = useUIStore((s) => s.workspaceName);

  return (
    <div
      data-tauri-drag-region
      className="flex h-10 shrink-0 items-center border-b border-line bg-panel pl-20 pr-2"
    >
      <div data-tauri-drag-region className="flex items-center gap-2 text-xs text-fg-2">
        <span className="font-semibold text-fg">zense</span>
        <span className="text-fg-3">—</span>
        <span>{workspaceName ?? "no workspace"}</span>
        <span className="ml-2 flex items-center gap-1 rounded bg-panel-2 px-1.5 py-0.5 text-[11px] text-fg-2">
          <GitBranch size={11} />
          main
        </span>
      </div>

      <div data-tauri-drag-region className="flex-1" />

      <div className="flex items-center gap-0.5">
        <button
          onClick={toggleSidebar}
          title="Toggle Sidebar (⌘B)"
          className={`rounded p-1.5 hover:bg-hover ${sidebarVisible ? "text-fg" : "text-fg-3"}`}
        >
          <PanelLeft size={15} />
        </button>
        <button
          onClick={toggleBottom}
          title="Toggle Panel (⌘J)"
          className={`rounded p-1.5 hover:bg-hover ${bottomVisible ? "text-fg" : "text-fg-3"}`}
        >
          <PanelBottom size={15} />
        </button>
        <button
          onClick={toggleChat}
          title="Toggle AI Chat"
          className={`rounded p-1.5 hover:bg-hover ${chatVisible ? "text-fg" : "text-fg-3"}`}
        >
          <PanelRight size={15} />
        </button>
      </div>
    </div>
  );
}
