import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useUIStore, tabKey } from "./store/uiStore";
import { useWorkspaceStore } from "./store/workspaceStore";
import { isTauri, openFolderFlow } from "./lib/workspace";
import { TitleBar } from "./components/layout/TitleBar";
import { ActivityBar } from "./components/layout/ActivityBar";
import { StatusBar } from "./components/layout/StatusBar";
import { SideBar } from "./components/sidebar/SideBar";
import { EditorArea } from "./components/editor/EditorArea";
import { ComposerPanel } from "./components/chat/ComposerPanel";
import { SettingsModal } from "./components/settings/SettingsModal";
import { WelcomeScreen } from "./components/welcome/WelcomeScreen";

export default function App() {
  const screen = useUIStore((s) => s.screen);

  useKeyboardShortcuts();
  useWindowDrag();

  if (screen === "welcome") {
    return (
      <>
        <WelcomeScreen />
        <SettingsModal />
      </>
    );
  }

  return <WorkspaceLayout />;
}

function WorkspaceLayout() {
  const { sidebarVisible, chatVisible, workspacePath } = useUIStore();

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
        <div className="flex min-w-0 flex-1 flex-col">
          <EditorArea />
        </div>
        {chatVisible && <ComposerPanel />}
      </div>
      <StatusBar />
      <SettingsModal />
    </div>
  );
}

function useKeyboardShortcuts() {
  const { toggleSidebar, toggleChat, closeSettings, openSettings } =
    useUIStore();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;

      // ── Modifier-based shortcuts (⌘X / Ctrl+X) ────────────────────────
      if (mod) {
        if (e.key === "s") {
          e.preventDefault();
          const ui = useUIStore.getState();
          if (ui.screen !== "workspace" || !ui.workspacePath) return;
          const tab = ui.openTabs.find((t) => tabKey(t) === ui.activeTabKey);
          if (!tab || tab.kind !== "file") return;
          void useWorkspaceStore.getState().saveFile(ui.workspacePath, tab.path);
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
  }, [toggleSidebar, toggleChat, closeSettings, openSettings]);
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
