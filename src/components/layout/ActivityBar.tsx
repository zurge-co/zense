import { Files, Search, GitBranch, Network, Library, Settings } from "lucide-react";
import { useUIStore, type Activity } from "../../store/uiStore";

const items: { id: Activity; icon: typeof Files; label: string }[] = [
  { id: "git", icon: GitBranch, label: "Source Control" },
  { id: "explorer", icon: Files, label: "Explorer" },
  { id: "search", icon: Search, label: "Search" },
  { id: "graph", icon: Network, label: "Code Graph" },
  { id: "prompts", icon: Library, label: "Prompt Library" },
];

export function ActivityBar() {
  const { activity, setActivity, sidebarVisible, mainView, openSettings } = useUIStore();

  return (
    <div className="flex w-11 shrink-0 flex-col items-center border-r border-line bg-panel py-1">
      {items.map(({ id, icon: Icon, label }) => {
        const active =
          activity === id && (id === "graph" ? mainView === "graph" : sidebarVisible);
        return (
          <button
            key={id}
            title={label}
            onClick={() => setActivity(id)}
            className={`relative mb-0.5 rounded-md p-2.5 transition-colors ${
              active ? "text-fg" : "text-fg-3 hover:text-fg-2"
            }`}
          >
            {active && <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-accent" />}
            <Icon size={18} strokeWidth={1.7} />
          </button>
        );
      })}

      <div className="flex-1" />

      <button
        title="Settings"
        onClick={() => openSettings()}
        className="rounded-md p-2.5 text-fg-3 transition-colors hover:text-fg-2"
      >
        <Settings size={18} strokeWidth={1.7} />
      </button>
    </div>
  );
}
