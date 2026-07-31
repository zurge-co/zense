import { GitBranch, Sparkles, Check, RefreshCw, FileDiff } from "lucide-react";
import { gitChanges, diffStats } from "../../lib/mockData";
import { useUIStore } from "../../store/uiStore";

const statusColor: Record<string, string> = {
  M: "text-yellow",
  A: "text-green",
  D: "text-red",
};

export function GitPanel() {
  const { openDiff } = useUIStore();

  return (
    <div className="flex flex-col gap-2 p-2">
      <div className="flex items-center justify-between rounded border border-line bg-base px-2 py-1.5">
        <span className="flex items-center gap-1.5 text-[12.5px] text-fg">
          <GitBranch size={13} className="text-fg-3" />
          main
        </span>
        <button title="Refresh" className="rounded p-1 text-fg-3 hover:bg-hover hover:text-fg-2">
          <RefreshCw size={12} />
        </button>
      </div>

      <textarea
        rows={3}
        placeholder="Commit message…"
        className="w-full resize-none rounded border border-line bg-base p-2 text-[12.5px] text-fg outline-none placeholder:text-fg-3 focus:border-accent"
      />

      <div className="flex gap-1.5">
        <button className="flex flex-1 items-center justify-center gap-1.5 rounded bg-accent py-1.5 text-[12px] font-medium text-white hover:opacity-90">
          <Check size={12} />
          Commit
        </button>
        <button
          title="Generate message with AI"
          className="flex items-center gap-1.5 rounded border border-accent/30 bg-accent/10 px-2.5 py-1.5 text-[12px] text-accent-2 hover:bg-accent/20"
        >
          <Sparkles size={12} />
          AI
        </button>
      </div>

      <div className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-fg-2">
        Changes · {gitChanges.length}
      </div>

      {gitChanges.map((c) => {
        const stats = diffStats[c.file];
        return (
          <button
            key={c.file}
            onClick={() => openDiff(c.file)}
            title={`Compare ${c.file} with HEAD`}
            className="group flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-[12.5px] text-fg-2 hover:bg-hover hover:text-fg"
          >
            <FileDiff size={13} className="shrink-0 text-fg-3" />
            <span className="flex-1 truncate text-left">{c.file}</span>
            {stats && (
              <span className="font-mono text-[10px]">
                <span className="text-green">+{stats.adds}</span>{" "}
                <span className="text-red">−{stats.dels}</span>
              </span>
            )}
            <span className={`font-mono text-[11px] font-semibold ${statusColor[c.status]}`}>{c.status}</span>
          </button>
        );
      })}
    </div>
  );
}
