import { GitBranch, CircleX, TriangleAlert, TerminalSquare } from "lucide-react";
import { useUIStore } from "../../store/uiStore";

export function StatusBar() {
  const { openTabs, activeTabKey, agentCommand, openSettings } = useUIStore();
  const activeTab = openTabs.find((t) => `${t.kind}:${t.path}` === activeTabKey);
  const file = activeTab ? activeTab.path.split("/").pop() : null;

  return (
    <div className="flex h-6 shrink-0 items-center justify-between border-t border-line bg-panel px-3 text-[11px] text-fg-2">
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1 hover:text-fg">
          <GitBranch size={11} />
          main*
        </span>
        <span className="flex items-center gap-1 hover:text-fg">
          <CircleX size={11} className="text-red" />
          1
        </span>
        <span className="flex items-center gap-1 hover:text-fg">
          <TriangleAlert size={11} className="text-yellow" />
          2
        </span>
      </div>

      <div className="flex items-center gap-3">
        <span>Ln 9, Col 24</span>
        <span>Spaces: 2</span>
        {file && <span>{file.endsWith(".rs") ? "Rust" : "TypeScript"}</span>}
        <button
          onClick={() => openSettings("agent")}
          title="Agent CLI settings"
          className="flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-accent-2 hover:bg-hover"
        >
          <TerminalSquare size={11} />
          {agentCommand}
        </button>
      </div>
    </div>
  );
}
