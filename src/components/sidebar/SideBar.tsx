import { useUIStore } from "../../store/uiStore";
import { FileTree } from "./FileTree";
import { HistoryPanel } from "./HistoryPanel";
import { SearchPanel } from "./SearchPanel";

export function SideBar() {
  const { activity, editorPanelMode, setEditorPanelMode } = useUIStore();

  // Terminal mode has no sidebar content — render nothing instead of an
  // empty header over an empty body section. Review is a full main-area
  // page now (ReviewView), so it never reaches the sidebar either.
  if (activity === "terminal" || activity === "review") return null;

  return (
    <div className="flex w-60 shrink-0 flex-col border-r border-border bg-panel">
      <div className="flex h-8 shrink-0 items-center px-3 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
        {activity === "editor" ? (
          <div className="flex gap-1">
            <button
              onClick={() => setEditorPanelMode("files")}
              className={editorPanelMode === "files" ? "text-fg" : "hover:text-fg"}
            >
              Files
            </button>
            <span className="text-fg-muted/50">·</span>
            <button
              onClick={() => setEditorPanelMode("search")}
              className={editorPanelMode === "search" ? "text-fg" : "hover:text-fg"}
            >
              Search
            </button>
          </div>
        ) : (
          "History"
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {activity === "editor" && (editorPanelMode === "search" ? <SearchPanel /> : <FileTree />)}
        {activity === "history" && <HistoryPanel />}
      </div>
    </div>
  );
}
