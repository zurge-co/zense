import { X, ChevronRight, File, Sparkles, SplitSquareHorizontal, GitCompareArrows } from "lucide-react";
import { useUIStore, tabKey } from "../../store/uiStore";
import { mockFiles, extraWorkingFiles, fallbackFile } from "../../lib/mockData";
import { CodeEditor } from "./CodeEditor";
import { DiffView } from "./DiffView";

export function EditorArea() {
  const { openTabs, activeTabKey, setActiveTab, closeTab, addChip, chatVisible, toggleChat } =
    useUIStore();
  const activeTab = openTabs.find((t) => tabKey(t) === activeTabKey) ?? null;

  const explainInAgent = () => {
    if (activeTab?.kind !== "file") return;
    // Mock: attach the current file with the visible line range.
    addChip({ path: activeTab.path, range: { start: 9, end: 20 } });
    if (!chatVisible) toggleChat();
  };

  const file =
    activeTab?.kind === "file"
      ? (mockFiles[activeTab.path] ?? extraWorkingFiles[activeTab.path] ?? fallbackFile)
      : null;

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-base">
      {/* Tab bar */}
      <div className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b border-line bg-panel">
        {openTabs.map((tab) => {
          const key = tabKey(tab);
          const name = tab.path.split("/").pop()!;
          const active = key === activeTabKey;
          return (
            <div
              key={key}
              onClick={() => setActiveTab(key)}
              className={`group flex cursor-pointer items-center gap-1.5 border-r border-line px-3 text-[12.5px] ${
                active ? "bg-base text-fg" : "text-fg-3 hover:bg-hover hover:text-fg-2"
              }`}
            >
              {tab.kind === "diff" ? (
                <GitCompareArrows size={13} className={active ? "text-purple" : "text-fg-3"} />
              ) : (
                <File size={13} className={active ? "text-accent-2" : "text-fg-3"} />
              )}
              <span>{name}</span>
              {tab.kind === "diff" && (
                <span className="rounded bg-purple/15 px-1 text-[9.5px] font-medium text-purple">DIFF</span>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(key);
                }}
                className={`rounded p-0.5 hover:bg-active ${
                  active ? "opacity-60 hover:opacity-100" : "opacity-0 group-hover:opacity-60"
                }`}
              >
                <X size={12} />
              </button>
            </div>
          );
        })}
        <div className="flex-1" />
        <button title="Split Editor" className="px-2 text-fg-3 hover:text-fg-2">
          <SplitSquareHorizontal size={14} />
        </button>
        <button
          onClick={explainInAgent}
          title="Attach this file to the agent composer"
          className="flex items-center gap-1 px-2 text-[11px] text-accent-2 hover:text-accent"
        >
          <Sparkles size={13} />
          Explain
        </button>
      </div>

      {activeTab?.kind === "diff" ? (
        <DiffView path={activeTab.path} />
      ) : activeTab && file ? (
        <>
          {/* Breadcrumb */}
          <div className="flex h-7 shrink-0 items-center gap-1 border-b border-line px-3 text-[11.5px] text-fg-3">
            {activeTab.path.split("/").map((seg, i, arr) => (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && <ChevronRight size={11} />}
                <span className={i === arr.length - 1 ? "text-fg-2" : ""}>{seg}</span>
              </span>
            ))}
            <ChevronRight size={11} />
            <span className="text-fg-2">login</span>
          </div>

          <div className="min-h-0 flex-1">
            <CodeEditor language={file.language} value={file.content} />
          </div>
        </>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-fg-3">
          <Sparkles size={28} strokeWidth={1.2} />
          <p className="text-sm">Open a file to start exploring</p>
          <p className="text-[11.5px]">or ask AI to explain the codebase</p>
        </div>
      )}
    </div>
  );
}
