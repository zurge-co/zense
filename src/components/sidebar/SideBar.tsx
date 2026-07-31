import { useUIStore } from "../../store/uiStore";
import { FileTree } from "./FileTree";
import { SearchPanel } from "./SearchPanel";
import { GitPanel } from "./GitPanel";
import { PromptPanel } from "./PromptPanel";

const titles: Record<string, string> = {
  explorer: "Explorer",
  search: "Search",
  git: "Source Control",
  prompts: "Prompt Library",
};

export function SideBar() {
  const { activity } = useUIStore();

  return (
    <div className="flex w-60 shrink-0 flex-col border-r border-line bg-panel">
      <div className="flex h-8 shrink-0 items-center px-3 text-[11px] font-semibold uppercase tracking-wider text-fg-2">
        {titles[activity]}
      </div>
      <div className="flex-1 overflow-y-auto">
        {activity === "explorer" && <FileTree />}
        {activity === "search" && <SearchPanel />}
        {activity === "git" && <GitPanel />}
        {activity === "prompts" && <PromptPanel />}
      </div>
    </div>
  );
}
