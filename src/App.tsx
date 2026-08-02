import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useUIStore } from "./store/uiStore";
import { useTerminalStore } from "./store/terminalStore";
import { useWorkspaceStore } from "./store/workspaceStore";
import { isTauri, openFolderFlow } from "./lib/workspace";
import { loadSentLog } from "./lib/sentLog";
import { TitleBar } from "./components/layout/TitleBar";
import { ActivityBar } from "./components/layout/ActivityBar";
import { StatusBar } from "./components/layout/StatusBar";
import { BottomPanel } from "./components/layout/BottomPanel";
import { SideBar } from "./components/sidebar/SideBar";
import { EditorArea } from "./components/editor/EditorArea";
import { GraphView } from "./components/graph/GraphView";
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
  const { sidebarVisible, chatVisible, bottomVisible, mainView, workspacePath } = useUIStore();

  // Load the real file tree + index + sent log whenever the workspace changes.
  useEffect(() => {
    if (workspacePath) {
      void useWorkspaceStore.getState().loadWorkspace(workspacePath);
      void loadSentLog(workspacePath);
    }
  }, [workspacePath]);

  return (
    <div className="flex h-full flex-col">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <ActivityBar />
        {sidebarVisible && <SideBar />}
        <div className="flex min-w-0 flex-1 flex-col">
          {mainView === "graph" ? <GraphView /> : <EditorArea />}
          {/* Always mounted so PTY sessions survive ⌘J / graph view — hidden with CSS. */}
          <BottomPanel hidden={!bottomVisible || mainView === "graph"} />
        </div>
        {chatVisible && <ComposerPanel />}
      </div>
      <StatusBar />
      <SettingsModal />
    </div>
  );
}

function useKeyboardShortcuts() {
  const { toggleSidebar, toggleBottom, toggleChat, closeSettings, openSettings, addSelectionChip } =
    useUIStore();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;

      if (e.key === "b") {
        e.preventDefault();
        toggleSidebar();
      } else if (e.key === "o") {
        e.preventDefault();
        void openFolderFlow();
      } else if (e.key === "j") {
        e.preventDefault();
        toggleBottom();
      } else if (e.key === ",") {
        e.preventDefault();
        openSettings();
      } else if (e.key === "l") {
        e.preventDefault();
        addSelectionChip();
      } else if (e.shiftKey && (e.key === "C" || e.key === "c")) {
        e.preventDefault();
        toggleChat();
      } else if (e.key === "`") {
        e.preventDefault();
        const s = useUIStore.getState();
        if (s.screen !== "workspace") return;
        if (!s.bottomVisible) toggleBottom();
        useTerminalStore.getState().createShell(s.workspacePath, s.shellProfile.trim() || undefined);
      } else if (e.key === "w") {
        // Close the active terminal tab when the terminal is actually shown;
        // otherwise leave ⌘W to the OS (window close).
        const s = useUIStore.getState();
        if (s.screen === "workspace" && s.bottomVisible && s.mainView === "editor") {
          const t = useTerminalStore.getState();
          if (t.activeId) {
            e.preventDefault();
            t.close(t.activeId);
          }
        }
      }
    };

    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeSettings();
    };

    window.addEventListener("keydown", onKey);
    window.addEventListener("keydown", onEsc);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keydown", onEsc);
    };
  }, [toggleSidebar, toggleBottom, toggleChat, closeSettings, openSettings, addSelectionChip]);
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
