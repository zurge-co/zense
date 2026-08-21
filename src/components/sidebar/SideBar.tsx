import { useUIStore } from "../../store/uiStore";
import { FileTree } from "./FileTree";
import { ReviewPanel } from "./ReviewPanel";
import { HistoryPanel } from "./HistoryPanel";

const titles: Record<string, string> = {
  review: "Review",
  history: "History",
  explorer: "Explorer",
};

export function SideBar() {
  const { activity } = useUIStore();

  return (
    <div className="flex w-60 shrink-0 flex-col border-r border-border bg-panel">
      <div className="flex h-8 shrink-0 items-center px-3 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
        {titles[activity]}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {activity === "explorer" && <FileTree />}
        {activity === "review" && <ReviewPanel />}
        {activity === "history" && <HistoryPanel />}
      </div>
    </div>
  );
}
