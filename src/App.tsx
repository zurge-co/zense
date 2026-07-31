import { useEffect } from "react";
import { useUIStore } from "./store/uiStore";
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
  const { sidebarVisible, chatVisible, bottomVisible, mainView } = useUIStore();

  return (
    <div className="flex h-full flex-col">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <ActivityBar />
        {sidebarVisible && <SideBar />}
        {mainView === "graph" ? (
          <GraphView />
        ) : (
          <div className="flex min-w-0 flex-1 flex-col">
            <EditorArea />
            {bottomVisible && <BottomPanel />}
          </div>
        )}
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
