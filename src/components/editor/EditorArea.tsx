import { useEffect, useState } from "react";
import { X, File, FileImage, Sparkles, SplitSquareHorizontal, GitCompareArrows, GitCommitHorizontal, TriangleAlert, CopyX, XCircle, RotateCcw, Eye } from "lucide-react";
import { useUIStore, tabKey, type EditorTab } from "../../store/uiStore";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { detectLanguage } from "../../lib/lang";
import { isImagePath } from "../../lib/image";
import { CodeEditor } from "./CodeEditor";
import { ImageViewer } from "./ImageViewer";
import { PreviewView } from "./PreviewView";
import { PathBreadcrumb } from "./PathBreadcrumb";
import { DiffView } from "./DiffView";
import { CommitDetail } from "./CommitDetail";
import { CompareView } from "./CompareView";
import { ContextMenu, type ContextMenuItem } from "../ContextMenu";
import { ConfirmDialog } from "../ConfirmDialog";

export function EditorArea() {
  const { openTabs, activeTabKey, setActiveTab, closeTab, closeOtherTabs, closeAllTabs, toggleSplit, closeSplit } = useUIStore();
  const splitTabKey = useUIStore((s) => s.splitTabKey);
  const closeNonce = useUIStore((s) => s.closeActiveTabNonce);
  const workspacePath = useUIStore((s) => s.workspacePath);
  const { saveFile, clearDirty } = useWorkspaceStore();
  const dirtyPaths = useWorkspaceStore((s) => s.dirtyPaths);
  const activeTab = openTabs.find((t) => tabKey(t) === activeTabKey) ?? null;
  const splitTab = openTabs.find((t) => tabKey(t) === splitTabKey) ?? null;

  const [menu, setMenu] = useState<{ key: string; x: number; y: number } | null>(null);
  const [confirm, setConfirm] = useState<{ kind: "others" | "all" | "single"; key?: string; count: number } | null>(null);

  // ── Tab close actions (dirty-aware) ──────────────────────────────────────

  const closeSingle = (key: string) => {
    const tab = openTabs.find((t) => tabKey(t) === key);
    if (tab?.kind === "file") {
      if (dirtyPaths.has(tab.path)) {
        setConfirm({ kind: "single", key, count: 1 });
        return;
      }
      clearDirty(tab.path);
    }
    closeTab(key);
  };

  // ⌘W from the global shortcuts: close the active tab with confirmation.
  useEffect(() => {
    if (closeNonce > 0 && activeTabKey) closeSingle(activeTabKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closeNonce]);

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
    if (confirm.kind === "single" && confirm.key) {
      const tab = openTabs.find((t) => tabKey(t) === confirm.key);
      if (tab?.kind === "file") clearDirty(tab.path);
      closeTab(confirm.key);
    } else if (confirm.kind === "others" && confirm.key) {
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
        ...((): ContextMenuItem[] => {
          const tab = openTabs.find((t) => tabKey(t) === menu.key);
          if (!tab || tab.kind !== "file" || !dirtyPaths.has(tab.path)) return [];
          return [
            {
              id: "save",
              label: "Save",
              icon: File,
              onClick: () => {
                if (workspacePath) void saveFile(workspacePath, tab.path);
              },
            },
            {
              id: "revert",
              label: "Revert File",
              icon: RotateCcw,
              onClick: () => {
                if (workspacePath) void useWorkspaceStore.getState().revertFile(workspacePath, tab.path);
              },
            },
          ];
        })(),
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
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-base">
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
              ) : tab.kind === "preview" ? (
                <Eye size={13} className={active ? "text-accent" : "text-fg-muted"} />
              ) : tab.kind === "file" && isImagePath(tab.path) ? (
                <FileImage size={13} className={active ? "text-accent" : "text-fg-muted"} />
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
                    closeSingle(key);
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
        <button
          title="Split Editor (⌘\)"
          onClick={() => toggleSplit()}
          className={`px-2 hover:text-fg ${splitTab ? "text-accent" : "text-fg-muted"}`}
        >
          <SplitSquareHorizontal size={14} />
        </button>
      </div>

      {/* Editor panes (single, or split right) */}
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          {activeTab ? (
            <TabContent tab={activeTab} showBreadcrumb />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-fg-muted">
              <Sparkles size={28} strokeWidth={1.2} />
              <p className="text-sm">Open a file to start exploring</p>
              <p className="text-[11.5px]">or press ⌘P to quick-open a file</p>
            </div>
          )}
        </div>
        {splitTab && (
          <div className="flex min-w-0 flex-1 flex-col border-l border-border">
            <div className="flex h-7 shrink-0 items-center justify-between border-b border-border bg-panel px-2 text-[11.5px] text-fg-muted">
              <span className="truncate">{splitTab.path.split("/").pop()}</span>
              <button
                title="Close split (⌘\)"
                onClick={closeSplit}
                className="rounded p-1 hover:bg-hover hover:text-fg"
              >
                <X size={12} />
              </button>
            </div>
            <TabContent tab={splitTab} showBreadcrumb />
          </div>
        )}
      </div>

      {menu && (
        <ContextMenu
          items={menuItems}
          position={{ x: menu.x, y: menu.y }}
          onClose={() => setMenu(null)}
        />
      )}

      {confirm && (
        <ConfirmDialog
          title={
            confirm.kind === "all"
              ? "Close All Tabs"
              : confirm.kind === "others"
                ? "Close Other Tabs"
                : "Close Tab"
          }
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

/** Renders one tab's content (file editor, diff, commit, compare). */
function TabContent({ tab, showBreadcrumb }: { tab: EditorTab; showBreadcrumb: boolean }) {
  const workspacePath = useUIStore((s) => s.workspacePath);
  const { fileContents, fileErrors, loadFile, markDirty, revertFile, keepMine } = useWorkspaceStore();
  const conflicts = useWorkspaceStore((s) => s.conflicts);

  const path = tab.kind === "file" ? tab.path : null;
  const isImage = path !== null && isImagePath(path);
  useEffect(() => {
    // Image files render via ImageViewer (binary fetch) — never through the
    // text-only loadFile/read_file path, which rejects non-UTF-8 bytes.
    if (path && workspacePath && !isImage) void loadFile(workspacePath, path);
  }, [path, workspacePath, loadFile, isImage]);

  const content = path ? fileContents[path] : undefined;
  const loadError = path ? fileErrors[path] : undefined;
  const conflict = path ? conflicts[path] : undefined;

  if (path && isImage) {
    if (!workspacePath) {
      return (
        <div className="flex flex-1 items-center justify-center text-[12px] text-fg-muted">
          Image preview requires the desktop app.
        </div>
      );
    }
    return (
      <>
        {showBreadcrumb && <PathBreadcrumb path={path} />}
        <div className="flex min-h-0 flex-1 flex-col">
          <ImageViewer root={workspacePath} path={path} />
        </div>
      </>
    );
  }
  if (tab.kind === "preview") {
    if (!workspacePath) {
      return (
        <div className="flex flex-1 items-center justify-center text-[12px] text-fg-muted">
          File preview requires the desktop app.
        </div>
      );
    }
    return (
      <>
        {showBreadcrumb && <PathBreadcrumb path={tab.path} />}
        <div className="flex min-h-0 flex-1 flex-col">
          <PreviewView root={workspacePath} path={tab.path} />
        </div>
      </>
    );
  }
  if (tab.kind === "diff" || tab.kind === "commitDiff") return <DiffView tab={tab} />;
  if (tab.kind === "commit") return <CommitDetail sha={tab.path} />;
  if (tab.kind === "compare") {
    return <CompareView fromSha={tab.fromSha!} toSha={tab.toSha!} />;
  }
  if (path && content !== undefined) {
    return (
      <>
        {conflict && (
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-yellow/10 px-3 py-1.5 text-[11.5px] text-yellow">
            <span className="truncate">
              {conflict === "deleted"
                ? "This file was deleted on disk. Keeping it will recreate it on save."
                : "This file changed on disk. Your unsaved changes may be overwritten."}
            </span>
            <span className="flex shrink-0 gap-2">
              {conflict === "deleted" ? (
                <button
                  onClick={() => {
                    if (workspacePath) {
                      const ws = useWorkspaceStore.getState();
                      ws.keepMine(path); // explicit choice — skip the ADR-003 re-prompt
                      void ws.saveFile(workspacePath, path);
                    }
                  }}
                  className="rounded border border-yellow/40 px-2 py-0.5 hover:bg-yellow/20"
                >
                  Save to restore
                </button>
              ) : (
                <button
                  onClick={() => {
                    if (workspacePath) void revertFile(workspacePath, path);
                  }}
                  className="rounded border border-yellow/40 px-2 py-0.5 hover:bg-yellow/20"
                >
                  Reload
                </button>
              )}
              <button
                onClick={() => keepMine(path)}
                className="rounded border border-yellow/40 px-2 py-0.5 hover:bg-yellow/20"
              >
                Keep mine
              </button>
            </span>
          </div>
        )}
        {showBreadcrumb && <PathBreadcrumb path={path} />}
        <div className="min-h-0 flex-1">
          <CodeEditor
            language={detectLanguage(path)}
            value={content}
            onChange={(value) => markDirty(path, value)}
          />
        </div>
      </>
    );
  }
  if (path && loadError) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-fg-muted">
        <TriangleAlert size={24} strokeWidth={1.5} className="text-yellow" />
        <p className="font-mono text-[12px]">{path}</p>
        <p className="max-w-96 text-center text-[11.5px]">{loadError}</p>
      </div>
    );
  }
  return (
    <div className="flex flex-1 items-center justify-center text-[12px] text-fg-muted">
      Loading {tab.path}…
    </div>
  );
}
