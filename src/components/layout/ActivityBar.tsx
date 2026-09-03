import { Files, GitBranch, History, Search, Settings, Terminal } from "lucide-react";
import { useUIStore, type Activity } from "../../store/uiStore";

const items: { id: Activity; icon: typeof Files; label: string }[] = [
  { id: "review", icon: GitBranch, label: "Review" },
  { id: "history", icon: History, label: "History" },
  { id: "editor", icon: Files, label: "Editor" },
  { id: "search", icon: Search, label: "Search (⌘⇧F)" },
  { id: "terminal", icon: Terminal, label: "Terminal (⌘`)" },
];

export function ActivityBar() {
  const { activity, setActivity, sidebarVisible, openSettings } = useUIStore();

  return (
    <div className="flex w-11 shrink-0 flex-col items-center border-r border-border bg-panel py-1">
      {items.map(({ id, icon: Icon, label }) => {
        const active = activity === id && sidebarVisible;
        return (
          <button
            key={id}
            title={label}
            onClick={() => setActivity(id)}
            className={`relative mb-0.5 rounded-md p-2.5 transition-colors ${
              active ? "text-fg" : "text-fg-muted hover:text-fg"
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
        className="rounded-md p-2.5 text-fg-muted transition-colors hover:text-fg"
      >
        <Settings size={18} strokeWidth={1.7} />
      </button>
    </div>
  );
}
