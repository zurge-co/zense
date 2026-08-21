import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { useUIStore, tabKey } from "./store/uiStore";
import { useWorkspaceStore } from "./store/workspaceStore";
import { isTauri, openFolderFlow } from "./lib/workspace";
import { TitleBar } from "./components/layout/TitleBar";
import { ActivityBar } from "./components/layout/ActivityBar";
import { StatusBar } from "./components/layout/StatusBar";
import { SideBar } from "./components/sidebar/SideBar";
import { EditorArea } from "./components/editor/EditorArea";
import { ComposerPanel } from "./components/chat/ComposerPanel";
import { TerminalPanel } from "./components/terminal/TerminalPanel";
import { QuickOpen } from "./components/QuickOpen";
import { useTerminalStore } from "./store/terminalStore";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { useState } from "react";
import { SettingsModal } from "./components/settings/SettingsModal";
import { WelcomeScreen } from "./components/welcome/WelcomeScreen";

export default function App() {
  const screen = useUIStore((s) => s.screen);

  useKeyboardShortcuts();
  useMenuEvents();
  useWindowDrag();
  // Mounted at the root so the close guard works on the welcome screen too.
  const closeGuardDialog = useCloseRequestGuard();
  useUiPrefs();

  return (
    <>
      {screen === "welcome" ? (
        <>
          <WelcomeScreen />
          <SettingsModal />
        </>
      ) : (
        <WorkspaceLayout />
      )}
      {closeGuardDialog}
    </>
  );
}

function WorkspaceLayout() {
  const { sidebarVisible, chatVisible, workspacePath, activity } = useUIStore();

  // Load the real file tree + index whenever the workspace changes.
  useEffect(() => {
    if (workspacePath) {
      void useWorkspaceStore.getState().loadWorkspace(workspacePath);
    }
  }, [workspacePath]);

  return (
    <div className="flex h-full flex-col">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <ActivityBar />
        {sidebarVisible && <SideBar />}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {activity === "terminal" ? (
            <TerminalPanel />
          ) : (
            <EditorArea />
          )}
        </div>
        {chatVisible && <ComposerPanel />}
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
    void import("./lib/settings").then((m) => m.loadUiPrefs());
  }, []);
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
      const { invoke } = await import("@tauri-apps/api/core");
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
  return (
    <ConfirmDialog
      title="Unsaved Changes"
      message={
        failedSaves.length > 0
          ? `Failed to save: ${failedSaves.join(", ")}. Fix the problem and retry, or close without saving.`
          : `${dirtyCount} file${dirtyCount === 1 ? "" : "s"} have unsaved changes.`
      }
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

/** Save the file in the active editor tab (shared by ⌘S and File > Save). */
function saveActiveTab() {
  const ui = useUIStore.getState();
  if (ui.screen !== "workspace" || !ui.workspacePath) return;
  const tab = ui.openTabs.find((t) => tabKey(t) === ui.activeTabKey);
  if (!tab || tab.kind !== "file") return;
  void useWorkspaceStore.getState().saveFile(ui.workspacePath, tab.path);
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

function useKeyboardShortcuts() {
  const { toggleSidebar, toggleChat, closeSettings, openSettings, openSearch, toggleTerminal } =
    useUIStore();
  const toggleTerminalShortcut = useTerminalStore.getState().toggle;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;

      // ── Modifier-based shortcuts (⌘X / Ctrl+X) ────────────────────────
      if (mod) {
        if (e.key === "s") {
          e.preventDefault();
          saveActiveTab();
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
        } else if ((e.key === "`") && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          toggleTerminalShortcut();
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
  }, [toggleSidebar, toggleChat, closeSettings, openSettings, openSearch, toggleTerminal, toggleTerminalShortcut]);
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
