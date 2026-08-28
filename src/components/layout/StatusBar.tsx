import { useState } from "react";
import { GitBranch, CircleX, TriangleAlert, SquareTerminal } from "lucide-react";
import { BranchMenu } from "./BranchMenu";
import { useUIStore, tabKey } from "../../store/uiStore";
import { useGitStore } from "../../store/gitStore";
import { detectLanguage } from "../../lib/lang";
import { TAB_SIZE } from "../editor/CodeEditor";

/** Human-readable labels for Monaco language ids. */
const LANGUAGE_LABELS: Record<string, string> = {
  typescript: "TypeScript",
  javascript: "JavaScript",
  json: "JSON",
  markdown: "Markdown",
  rust: "Rust",
  python: "Python",
  go: "Go",
  html: "HTML",
  css: "CSS",
  plaintext: "Plain Text",
};

export function StatusBar() {
  const { openTabs, activeTabKey } = useUIStore();
  const terminalActive = useUIStore((s) => s.activity) === "terminal";
  const cursorPos = useUIStore((s) => s.cursorPos);
  const { branchInfo, status } = useGitStore();
  const activeTab = openTabs.find((t) => tabKey(t) === activeTabKey);
  const langId = activeTab?.kind === "file" ? detectLanguage(activeTab.path) : null;
  const langLabel = langId ? (LANGUAGE_LABELS[langId] ?? langId) : null;
  const branchLabel = branchInfo.detached ? "detached HEAD" : (branchInfo.branch ?? "main");
  const dirty = status.files.length > 0;
  const [branchMenuOpen, setBranchMenuOpen] = useState(false);

  return (
    <div className="flex h-6 shrink-0 items-center justify-between border-t border-border bg-panel px-3 text-[11px] text-fg-muted">
      <div className="flex items-center gap-3">
        {!status.notARepo && (
          <button
            title="Git: fetch · pull · switch branch (no terminal needed)"
            onClick={() => setBranchMenuOpen(true)}
            className="flex items-center gap-1 hover:text-fg"
          >
            <GitBranch size={11} />
            {branchLabel}{dirty ? "*" : ""}{branchInfo.ahead > 0 && ` ↑${branchInfo.ahead}`}{branchInfo.behind > 0 && ` ↓${branchInfo.behind}`}
          </button>
        )}
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
        <button
          title="Toggle terminal (⌘`)"
          onClick={() => {
            const ui = useUIStore.getState();
            if (ui.activity === "terminal") ui.setActivity("editor");
            else ui.toggleTerminal();
          }}
          className={`transition-colors hover:text-fg ${terminalActive ? "text-accent" : ""}`}
        >
          <SquareTerminal size={12} />
        </button>
        {cursorPos && <span>Ln {cursorPos.line}, Col {cursorPos.col}</span>}
        <span>Spaces: {TAB_SIZE}</span>
        {langLabel && <span>{langLabel}</span>}
      </div>
      {branchMenuOpen && <BranchMenu onClose={() => setBranchMenuOpen(false)} />}
    </div>
  );
}
