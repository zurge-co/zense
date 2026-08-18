import { GitBranch, CircleX, TriangleAlert } from "lucide-react";
import { useUIStore } from "../../store/uiStore";
import { useGitStore } from "../../store/gitStore";

export function StatusBar() {
  const { openTabs, activeTabKey } = useUIStore();
  const { branchInfo, status } = useGitStore();
  const activeTab = openTabs.find((t) => `${t.kind}:${t.path}` === activeTabKey);
  const file = activeTab ? activeTab.path.split("/").pop() : null;
  const branchLabel = branchInfo.detached ? "detached HEAD" : (branchInfo.branch ?? "main");
  const dirty = status.files.length > 0;

  return (
    <div className="flex h-6 shrink-0 items-center justify-between border-t border-border bg-panel px-3 text-[11px] text-fg-muted">
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1 hover:text-fg">
          <GitBranch size={11} />
          {branchLabel}{dirty ? "*" : ""}{branchInfo.ahead > 0 && ` ↑${branchInfo.ahead}`}{branchInfo.behind > 0 && ` ↓${branchInfo.behind}`}
        </span>
        <span className="flex items-center gap-1 hover:text-fg">
          <CircleX size={11} className="text-danger" />
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
      </div>
    </div>
  );
}
