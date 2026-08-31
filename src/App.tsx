import { useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useUIStore, tabKey } from "./store/uiStore";
import { useTerminalStore } from "./store/terminalStore";
import { useWorkspaceStore } from "./store/workspaceStore";
import { useFocusStore } from "./store/focusStore";
import { isTauri, openFolderFlow } from "./lib/workspace";
import { isUntitledPath, openUntitledTab, saveUntitledAs, untitledLabel } from "./lib/untitled";
import { adjustUiZoom, applyUiZoom, loadUiPrefs, UI_ZOOM_STEP } from "./lib/settings";
import { TitleBar } from "./components/layout/TitleBar";
import { ActivityBar } from "./components/layout/ActivityBar";
import { StatusBar } from "./components/layout/StatusBar";
import { SideBar } from "./components/sidebar/SideBar";
import { EditorArea } from "./components/editor/EditorArea";
import { ChatPanel } from "./components/chat/ChatPanel";
import { TerminalPanel } from "./components/terminal/TerminalPanel";
import { QuickOpen } from "./components/QuickOpen";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { useState } from "react";
import { SettingsModal } from "./components/settings/SettingsModal";
import { WelcomeScreen } from "./components/welcome/WelcomeScreen";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { UpdateDialog } from "./components/UpdateDialog";

export default function App() {
  const screen = useUIStore((s) => s.screen);

  useKeyboardShortcuts();
  useMenuEvents();
  useWindowDrag();
  // Mounted at the root so the close guard works on the welcome screen too.
  const closeGuardDialog = useCloseRequestGuard();
  useUiPrefs();
  useUiZoom();

  return (
    <>
      {/* A render crash must never take down the close guard or the
          conflict dialog — those live outside the boundary (spec v3). */}
      <ErrorBoundary>
        {screen === "welcome" ? (
          <>
            <WelcomeScreen />
            <SettingsModal />
          </>
        ) : (
          <WorkspaceLayout />
        )}
      </ErrorBoundary>
      {closeGuardDialog}
      <ConflictSaveDialog />
      <UpdateDialog />
    </>
  );
}

/**
 * ADR-003: confirm before a save (⌘S, auto-save, Save All) overwrites a
 * buffer whose on-disk file changed externally (git pull, other app).
 */
function ConflictSaveDialog() {
  const path = useWorkspaceStore((s) => s.pendingConflictSave);
  if (!path) return null;
  const kind = useWorkspaceStore.getState().conflicts[path] ?? "modified";
  const clear = () => useWorkspaceStore.setState({ pendingConflictSave: null });
  return (
    <ConfirmDialog
      title="File Changed on Disk"
      message={
        kind === "deleted"
          ? `"${path}" was deleted outside Zense. Saving will recreate it and remove the new on-disk state.`
          : `"${path}" was modified outside Zense (e.g. git pull). Saving will overwrite the on-disk version with your unsaved buffer.`
      }
      confirmLabel="Overwrite"
      danger
      onConfirm={() => {
        const ws = useWorkspaceStore.getState();
        ws.keepMine(path); // clear conflict so the write is not re-guarded
        const root = useUIStore.getState().workspacePath;
        clear();
        if (root) void ws.saveFile(root, path);
      }}
      onCancel={clear}
    />
  );
}

function WorkspaceLayout() {
  const { sidebarVisible, chatVisible, workspacePath, activity } = useUIStore();

  // Load the real file tree + index whenever the workspace changes.
  useEffect(() => {
    if (workspacePath) {
      void useWorkspaceStore.getState().loadWorkspace(workspacePath);
      void useFocusStore.getState().load(workspacePath);
    }
  }, [workspacePath]);

  // Lazily mount the terminal on its first visit, then keep it mounted so
  // the PTY session survives activity swaps — unmounting kills the shell
  // (pty_kill in TerminalPanel's unmount cleanup). While another activity is
  // selected it is concealed via CSS (absolute + invisible), and its
  // ResizeObserver refits xterm when it becomes visible again.
  const terminalMountedRef = useRef(false);
  if (activity === "terminal") terminalMountedRef.current = true;

  return (
    <div className="flex h-full flex-col">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <ActivityBar />
        {sidebarVisible && <SideBar />}
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          {activity !== "terminal" && <EditorArea />}
          {terminalMountedRef.current && (
            <div
              className={
                activity === "terminal"
                  ? "flex min-h-0 min-w-0 flex-1 flex-col"
                  : "invisible absolute inset-0 flex flex-col"
              }
            >
              <TerminalPanel />
            </div>
          )}
        </div>
        {chatVisible && <ChatPanel />}
      </div>
      <StatusBar />
      <SettingsModal />
      <QuickOpen />
    </div>
  );
}

/** Persisted UI prefs (auto-save) — load once when the workspace mounts. */
function useUiPrefs() {
  useEffect(() => {
    if (!isTauri()) return;
    void loadUiPrefs();
  }, []);
}

/** Mirror the persisted UI zoom (Settings > Appearance) onto the whole
 *  document. CSS zoom scales layout (panels, menus, editor chrome) — not
 *  just text — and the terminal/editor ResizeObservers refit themselves. */
function useUiZoom() {
  const uiZoom = useWorkspaceStore((s) => s.uiZoom);
  useEffect(() => {
    document.documentElement.style.zoom = String(uiZoom / 100);
  }, [uiZoom]);
}

/**
 * Unsaved-changes guard for window close: Rust prevents the close and emits
 * "app://close-requested"; here we either destroy immediately (clean) or
 * prompt (dirty buffers) — Save All & Close / Discard & Close / Cancel.
 */
function useCloseRequestGuard() {
  const [pending, setPending] = useState(false);
  const [failedSaves, setFailedSaves] = useState<string[]>([]);

  useEffect(() => {
    if (!isTauri()) return;
    const destroyWindow = async () => {
      await invoke("stop_watch").catch(() => {}); // release the watcher entry
      void getCurrentWindow().destroy();
    };
    destroyRef.current = destroyWindow;
    const unlisten = listen("app://close-requested", () => {
      if (useWorkspaceStore.getState().dirtyPaths.size === 0) {
        void destroyWindow();
      } else {
        setFailedSaves([]);
        setPending(true);
      }
    });
    return () => {
      void unlisten.then((u) => u());
    };
  }, []);

  if (!pending) return null;
  const dirtyCount = useWorkspaceStore.getState().dirtyPaths.size;
  // Untitled buffers can't be saved by Save All (they have no name yet) —
  // name each one via ⌘S in its tab, or close without saving.
  const failedNames = failedSaves.map((p) =>
    isUntitledPath(p) ? `${untitledLabel(p)} (unnamed — ⌘S in its tab)` : p,
  );
  const message =
    failedSaves.length > 0
      ? `Failed to save: ${failedNames.join(", ")}. Fix the problem and retry, or close without saving.`
      : `${dirtyCount} file${dirtyCount === 1 ? "" : "s"} have unsaved changes.`;
  return (
    <ConfirmDialog
      title="Unsaved Changes"
      message={message}
      confirmLabel="Save All & Close"
      secondaryLabel="Close Without Saving"
      danger
      onConfirm={() => {
        const root = useUIStore.getState().workspacePath;
        setPending(false);
        if (!root) {
          void destroyRef.current?.();
          return;
        }
        // Never destroy on failed saves — re-prompt instead of losing work.
        void useWorkspaceStore
          .getState()
          .saveAllDirty(root)
          .then((failed) => {
            if (failed.length === 0) {
              void destroyRef.current?.();
            } else {
              setFailedSaves(failed);
              setPending(true);
            }
          });
      }}
      onSecondary={() => {
        setPending(false);
        void destroyRef.current?.();
      }}
      onCancel={() => setPending(false)}
    />
  );
}

/** Latest window-destroy routine (stop watcher + destroy) for the guard. */
const destroyRef: { current: (() => Promise<void>) | null } = { current: null };

/** Save the file in the active editor tab (shared by ⌘S and File > Save).
 *  Untitled tabs go through the save-as flow first (name the file). */
function saveActiveTab() {
  const ui = useUIStore.getState();
  if (ui.screen !== "workspace" || !ui.workspacePath) return;
  const tab = ui.openTabs.find((t) => tabKey(t) === ui.activeTabKey);
  if (!tab) return;
  if (tab.kind === "untitled") {
    void saveUntitledAs(ui.workspacePath);
    return;
  }
  if (tab.kind !== "file") return;
  void useWorkspaceStore.getState().saveFile(ui.workspacePath, tab.path);
}

/**
 * ⌘N / File > New File — show an inline file-name input in the explorer
 * (VS Code style). Target: the selected folder, or the selected file's
 * parent directory, else the workspace root.
 */
function startNewFile() {
  const ui = useUIStore.getState();
  if (ui.screen !== "workspace" || !ui.workspacePath) return;
  const ws = useWorkspaceStore.getState();
  let parentPath = "";
  const sel = ws.selectedTreeNode;
  if (sel) {
    if (sel.type === "folder") {
      parentPath = sel.path;
    } else if (sel.path.includes("/")) {
      parentPath = sel.path.slice(0, sel.path.lastIndexOf("/"));
    }
  }
  // Make sure the explorer is visible (setActivity would toggle it off).
  useUIStore.setState({ activity: "editor", sidebarVisible: true });
  ws.setPendingCreate({ parentPath, isDir: false });
}

/**
 * Native application menu events. Menu accelerators (⌘S, ⌘B, ⌘O, ⌘,, …)
 * are consumed before they reach the webview, so actions arrive through the
 * "menu-action" event instead of keydown handlers (which remain as the
 * fallback for browser dev mode).
 */
function useMenuEvents() {
  useEffect(() => {
    if (!isTauri()) return;
    const unlisten = listen<string>("menu-action", (e) => {
      const ui = useUIStore.getState();
      switch (e.payload) {
        case "new_file":
          // Context-sensitive ⌘N: in the terminal view it opens a new
          // terminal session, otherwise a new file (menu accelerator and
          // keydown both route through here, so keep them in sync).
          if (useUIStore.getState().activity === "terminal") {
            newTerminalSession();
          } else {
            startNewFile();
          }
          break;
        case "open_folder":
          void openFolderFlow();
          break;
        case "save_file":
          saveActiveTab();
          break;
        case "open_settings":
          ui.openSettings();
          break;
        case "toggle_sidebar":
          ui.toggleSidebar();
          break;
        case "toggle_chat":
          ui.toggleChat();
          break;
        case "toggle_diff_mode":
          ui.toggleDiffMode();
          break;
        case "find_in_files":
          ui.openSearch();
          break;
        case "toggle_terminal":
          ui.toggleTerminal();
          break;
        case "search":
          ui.openSearch();
          break;
        case "review":
          ui.setActivity("review");
          break;
        case "history":
          ui.setActivity("history");
          break;
        case "editor":
          ui.setActivity("editor");
          break;
        case "terminal":
          ui.toggleTerminal();
          break;
      }
    });
    return () => {
      void unlisten.then((u) => u());
    };
  }, []);
}

/**
 * ⌘N while the terminal view is active — open a new terminal session tab
 * (elsewhere ⌘N is New File). Used by both the keydown fallback and the
 * native "new_file" menu action.
 */
function newTerminalSession() {
  const ui = useUIStore.getState();
  if (ui.screen !== "workspace" || !ui.workspacePath) return;
  if (ui.activity !== "terminal") ui.setActivity("terminal");
  useTerminalStore.getState().addSession();
}

function useKeyboardShortcuts() {
  const { toggleSidebar, toggleChat, closeSettings, openSettings, openSearch, toggleTerminal } =
    useUIStore();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;

      // ── Modifier-based shortcuts (⌘X / Ctrl+X) ────────────────────────
      if (mod) {
        if (e.key === "=" || e.key === "+") {
          // ⌘/Ctrl+= (same physical key as +) → zoom the whole UI in
          e.preventDefault();
          adjustUiZoom(UI_ZOOM_STEP);
        } else if (e.key === "-") {
          e.preventDefault();
          adjustUiZoom(-UI_ZOOM_STEP);
        } else if (e.key === "0") {
          e.preventDefault();
          void applyUiZoom(100);
        } else if (e.key === "s") {
          e.preventDefault();
          saveActiveTab();
        } else if (e.key === "n" && !e.shiftKey) {
          e.preventDefault();
          // Context-sensitive ⌘N: terminal view → new terminal session,
          // anywhere else → new file (mirrors the native-menu handler).
          if (useUIStore.getState().activity === "terminal") {
            newTerminalSession();
          } else {
            startNewFile();
          }
        } else if (e.key === "t" && !e.shiftKey) {
          e.preventDefault();
          // Ctrl/⌘T, context-sensitive — terminal view: new shell session
          // tab; anywhere else: new untitled editor tab (name it later
          // via ⌘S save-as). Monaco binds ⌘T to "Go to Symbol" when the
          // editor is focused — monacoKeybindings.ts reroutes it here.
          if (useUIStore.getState().activity === "terminal") {
            newTerminalSession();
          } else if (
            useUIStore.getState().screen === "workspace" &&
            useUIStore.getState().workspacePath
          ) {
            openUntitledTab();
          }
        } else if (e.key === "b") {
          e.preventDefault();
          toggleSidebar();
        } else if (e.key === "o") {
          e.preventDefault();
          void openFolderFlow();
        } else if (e.key === ",") {
          e.preventDefault();
          openSettings();
        } else if (e.shiftKey && (e.key === "C" || e.key === "c")) {
          e.preventDefault();
          toggleChat();
        } else if (e.shiftKey && (e.key === "F" || e.key === "f")) {
          e.preventDefault();
          openSearch();
        } else if (e.key === "`") {
          e.preventDefault();
          // Terminal is an ActivityBar main view: ⌘` jumps to it, and jumps
          // back to the editor when already there (matches the X button).
          if (useUIStore.getState().activity === "terminal") {
            useUIStore.getState().setActivity("editor");
          } else {
            toggleTerminal();
          }
        } else if (e.key === "p" && !e.shiftKey) {
          e.preventDefault();
          useUIStore.getState().toggleQuickOpen();
        } else if (e.key === "w") {
          e.preventDefault();
          useUIStore.getState().requestCloseActiveTab();
        } else if (e.key === "\\") {
          e.preventDefault();
          useUIStore.getState().toggleSplit();
        } else if (/^[1-9]$/.test(e.key)) {
          // ⌘1–9 → activate the nth open tab
          const ui = useUIStore.getState();
          const tab = ui.openTabs[Number(e.key) - 1];
          if (tab) {
            e.preventDefault();
            ui.setActiveTab(tabKey(tab));
          }
        } else if (e.key === "Tab" && e.ctrlKey) {
          // Ctrl(+Shift)+Tab → cycle open tabs (VS Code style)
          const ui = useUIStore.getState();
          if (ui.openTabs.length > 1) {
            e.preventDefault();
            const idx = ui.openTabs.findIndex((t) => tabKey(t) === ui.activeTabKey);
            const dir = e.shiftKey ? -1 : 1;
            const next = ui.openTabs[(idx + dir + ui.openTabs.length) % ui.openTabs.length];
            ui.setActiveTab(tabKey(next));
          }
        }
        return;
      }

      // ── Non-modifier shortcuts (F2, Delete) — only when not typing ────
      if (isInputFocused()) return;

      const ui = useUIStore.getState();
      if (ui.screen !== "workspace" || !ui.workspacePath) return;
      const ws = useWorkspaceStore.getState();
      if (!ws.selectedTreeNode) return;

      if (e.key === "F2") {
        e.preventDefault();
        ws.setPendingRename(ws.selectedTreeNode.path);
      } else if (e.key === "Backspace" || e.key === "Delete") {
        e.preventDefault();
        ws.setPendingDelete(ws.selectedTreeNode);
      }
    };

    // ── Copy / Paste / Duplicate — modifier-based, tree-only context ────
    const onTreeKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (!["c", "v", "d"].includes(e.key.toLowerCase())) return;

      const ui = useUIStore.getState();
      if (ui.screen !== "workspace" || !ui.workspacePath) return;
      if (isInputFocused()) return; // don't hijack editor/input copy-paste

      const ws = useWorkspaceStore.getState();
      if (!ws.selectedTreeNode) return;

      if (e.key.toLowerCase() === "c") {
        e.preventDefault();
        ws.copyNode(ws.selectedTreeNode.path, ws.selectedTreeNode.type);
      } else if (e.key.toLowerCase() === "v") {
        e.preventDefault();
        const dir = ws.selectedTreeNode.type === "folder"
          ? ws.selectedTreeNode.path
          : (ws.selectedTreeNode.path.includes("/")
              ? ws.selectedTreeNode.path.slice(0, ws.selectedTreeNode.path.lastIndexOf("/"))
              : ".");
        void ws.pasteNode(ui.workspacePath, dir);
      } else if (e.key.toLowerCase() === "d") {
        e.preventDefault();
        void ws.duplicateNode(ui.workspacePath);
      }
    };

    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeSettings();
    };

    window.addEventListener("keydown", onKey);
    window.addEventListener("keydown", onTreeKey);
    window.addEventListener("keydown", onEsc);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keydown", onTreeKey);
      window.removeEventListener("keydown", onEsc);
    };
  }, [toggleSidebar, toggleChat, closeSettings, openSettings, openSearch, toggleTerminal]);
}

/** True when the user is typing in an input, textarea, or Monaco editor. */
function isInputFocused(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  return !!el.closest('input, textarea, [contenteditable], .monaco-editor');
}

/**
 * Window dragging for the custom titlebar. Tauri's built-in
 * `data-tauri-drag-region` only fires when the mousedown target is the
 * element carrying the attribute itself (not its children), so we handle it
 * manually: a left-press anywhere inside a drag region starts dragging,
 * unless the press landed on an interactive element.
 */
function useWindowDrag() {
  useEffect(() => {
    if (!isTauri()) return;

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement | null;
      if (!target?.closest("[data-tauri-drag-region]")) return;
      if (target.closest("button, a, input, textarea, select, [data-no-drag]")) return;
      getCurrentWindow()
        .startDragging()
        .catch((err) => console.error("startDragging failed:", err));
    };

    window.addEventListener("mousedown", onMouseDown);
    return () => window.removeEventListener("mousedown", onMouseDown);
  }, []);
}
