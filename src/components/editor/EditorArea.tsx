import { useEffect, useState } from "react";
import { X, ChevronRight, File, Sparkles, SplitSquareHorizontal, GitCompareArrows, GitCommitHorizontal, TriangleAlert, CopyX, XCircle } from "lucide-react";
import { useUIStore, tabKey } from "../../store/uiStore";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { detectLanguage } from "../../lib/lang";
import { CodeEditor } from "./CodeEditor";
import { DiffView } from "./DiffView";
import { CommitDetail } from "./CommitDetail";
import { CompareView } from "./CompareView";
import { ContextMenu, type ContextMenuItem } from "../ContextMenu";
import { ConfirmDialog } from "../ConfirmDialog";

export function EditorArea() {
  const { openTabs, activeTabKey, setActiveTab, closeTab, closeOtherTabs, closeAllTabs } = useUIStore();
  const workspacePath = useUIStore((s) => s.workspacePath);
  const { fileContents, fileErrors, loadFile, markDirty, saveFile, clearDirty } = useWorkspaceStore();
  const dirtyPaths = useWorkspaceStore((s) => s.dirtyPaths);
  const activeTab = openTabs.find((t) => tabKey(t) === activeTabKey) ?? null;

  const [menu, setMenu] = useState<{ key: string; x: number; y: number } | null>(null);
  const [confirm, setConfirm] = useState<{ kind: "others" | "all"; key?: string; count: number } | null>(null);

  // Load the active file's content on demand.
  const activePath = activeTab?.kind === "file" ? activeTab.path : null;
  useEffect(() => {
    if (activePath && workspacePath) void loadFile(workspacePath, activePath);
  }, [activePath, workspacePath, loadFile]);

  const content = activePath ? fileContents[activePath] : undefined;
  const loadError = activePath ? fileErrors[activePath] : undefined;

  // ── Tab context-menu actions ────────────────────────────────────────────

  const closeSingle = (key: string) => {
    const tab = openTabs.find((t) => tabKey(t) === key);
    if (tab?.kind === "file") clearDirty(tab.path);
    closeTab(key);
  };

  const runCloseOthers = (key: string) => {
    const others = openTabs.filter((t) => tabKey(t) !== key && t.kind === "file" && dirtyPaths.has(t.path));
    if (others.length > 0) {
      setConfirm({ kind: "others", key, count: others.length });
    } else {
      openTabs.filter((t) => tabKey(t) !== key && t.kind === "file").forEach((t) => clearDirty(t.path));
      closeOtherTabs(key);
    }
  };

  const runCloseAll = () => {
    const dirty = openTabs.filter((t) => t.kind === "file" && dirtyPaths.has(t.path));
    if (dirty.length > 0) {
      setConfirm({ kind: "all", count: dirty.length });
    } else {
      openTabs.filter((t) => t.kind === "file").forEach((t) => clearDirty(t.path));
      closeAllTabs();
    }
  };

  const confirmAccept = () => {
    if (!confirm) return;
    if (confirm.kind === "others" && confirm.key) {
      openTabs.filter((t) => tabKey(t) !== confirm.key && t.kind === "file").forEach((t) => clearDirty(t.path));
      closeOtherTabs(confirm.key);
    } else if (confirm.kind === "all") {
      openTabs.filter((t) => t.kind === "file").forEach((t) => clearDirty(t.path));
      closeAllTabs();
    }
    setConfirm(null);
  };

  const menuItems: ContextMenuItem[] = menu
    ? [
        { id: "close", label: "Close", icon: X, onClick: () => closeSingle(menu.key) },
        {
          id: "close-others",
          label: "Close Others",
          icon: CopyX,
          onClick: () => runCloseOthers(menu.key),
          disabled: openTabs.length <= 1,
        },
        {
          id: "close-all",
          label: "Close All",
          icon: XCircle,
          onClick: runCloseAll,
          disabled: openTabs.length === 0,
        },
      ]
    : [];

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-base">
      {/* Tab bar */}
      <div className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b border-border bg-panel">
        {openTabs.map((tab) => {
          const key = tabKey(tab);
          const name =
            tab.kind === "commit"
              ? tab.path.slice(0, 7)
              : tab.kind === "compare"
                ? `${tab.fromSha?.slice(0, 7) ?? ""}..${tab.toSha?.slice(0, 7) ?? ""}`
                : tab.path.split("/").pop()!;
          const active = key === activeTabKey;
          return (
            <div
              key={key}
              onClick={() => setActiveTab(key)}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ key, x: e.clientX, y: e.clientY });
              }}
              className={`group flex cursor-pointer items-center gap-1.5 border-r border-border px-3 text-[12.5px] ${
                active ? "bg-base text-fg" : "text-fg-muted hover:bg-hover hover:text-fg"
              }`}
            >
              {tab.kind === "diff" || tab.kind === "commitDiff" || tab.kind === "compare" ? (
                <GitCompareArrows size={13} className={active ? "text-accent" : "text-fg-muted"} />
              ) : tab.kind === "commit" ? (
                <GitCommitHorizontal size={13} className={active ? "text-accent" : "text-fg-muted"} />
              ) : (
                <File size={13} className={active ? "text-accent" : "text-fg-muted"} />
              )}
              <span>{name}</span>
              {tab.kind === "diff" && (
                <span className="rounded bg-accent/15 px-1 text-[9.5px] font-medium text-accent">DIFF</span>
              )}
              {tab.kind === "commitDiff" && (
                <span className="rounded bg-accent/15 px-1 text-[9.5px] font-medium text-accent">DIFF</span>
              )}
              {tab.kind === "compare" && (
                <span className="rounded bg-accent/15 px-1 text-[9.5px] font-medium text-accent">CMP</span>
              )}
              {tab.kind === "file" && dirtyPaths.has(tab.path) ? (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (workspacePath) void saveFile(workspacePath, tab.path);
                  }}
                  title="Save file"
                  className={`rounded p-0.5 hover:bg-active ${
                    active ? "opacity-80 hover:opacity-100" : "opacity-0 group-hover:opacity-80"
                  }`}
                >
                  <span className="text-[10px] leading-none text-accent">●</span>
                </button>
              ) : (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (tab.kind === "file") clearDirty(tab.path);
                    closeTab(key);
                  }}
                  className={`rounded p-0.5 hover:bg-active ${
                    active ? "opacity-60 hover:opacity-100" : "opacity-0 group-hover:opacity-60"
                  }`}
                >
                  <X size={12} />
                </button>
              )}
            </div>
          );
        })}
        <div className="flex-1" />
        <button title="Split Editor" className="px-2 text-fg-muted hover:text-fg">
          <SplitSquareHorizontal size={14} />
        </button>
      </div>

      {activeTab?.kind === "diff" || activeTab?.kind === "commitDiff" ? (
        <DiffView tab={activeTab} />
      ) : activeTab?.kind === "commit" ? (
        <CommitDetail sha={activeTab.path} />
      ) : activeTab?.kind === "compare" ? (
        <CompareView fromSha={activeTab.fromSha!} toSha={activeTab.toSha!} />
      ) : activeTab && content !== undefined ? (
        <>
          {/* Breadcrumb */}
          <div className="flex h-7 shrink-0 items-center gap-1 border-b border-border px-3 text-[11.5px] text-fg-muted">
            {activeTab.path.split("/").map((seg, i, arr) => (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && <ChevronRight size={11} />}
                <span className={i === arr.length - 1 ? "text-fg-muted" : ""}>{seg}</span>
              </span>
            ))}
          </div>

          <div className="min-h-0 flex-1">
            <CodeEditor
              language={detectLanguage(activeTab.path)}
              value={content}
              onChange={(value) => markDirty(activeTab.path, value)}
            />
          </div>
        </>
      ) : activeTab && loadError ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-fg-muted">
          <TriangleAlert size={24} strokeWidth={1.5} className="text-yellow" />
          <p className="font-mono text-[12px]">{activeTab.path}</p>
          <p className="max-w-96 text-center text-[11.5px]">{loadError}</p>
        </div>
      ) : activeTab ? (
        <div className="flex flex-1 items-center justify-center text-[12px] text-fg-muted">
          Loading {activeTab.path}…
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-fg-muted">
          <Sparkles size={28} strokeWidth={1.2} />
          <p className="text-sm">Open a file to start exploring</p>
          <p className="text-[11.5px]">or ask AI to explain the codebase</p>
        </div>
      )}

      {menu && (
        <ContextMenu
          items={menuItems}
          position={{ x: menu.x, y: menu.y }}
          onClose={() => setMenu(null)}
        />
      )}

      {confirm && (
        <ConfirmDialog
          title={confirm.kind === "all" ? "Close All Tabs" : "Close Other Tabs"}
          message={
            confirm.count === 1
              ? "1 unsaved file will be closed. Changes will be lost."
              : `${confirm.count} unsaved files will be closed. Changes will be lost.`
          }
          confirmLabel="Close Without Saving"
          danger
          onConfirm={confirmAccept}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
