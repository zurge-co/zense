import { Search, FileCode, Replace, CaseSensitive, Regex, Sparkles } from "lucide-react";
import { searchResults } from "../../lib/mockData";
import { useUIStore } from "../../store/uiStore";

export function SearchPanel() {
  const { openFile } = useUIStore();

  return (
    <div className="flex flex-col gap-2 p-2">
      <div className="flex items-center gap-1 rounded border border-line bg-base px-2 focus-within:border-accent">
        <Search size={13} className="shrink-0 text-fg-3" />
        <input
          defaultValue="auth"
          placeholder="Search"
          className="w-full bg-transparent py-1.5 text-[12.5px] text-fg outline-none placeholder:text-fg-3"
        />
        <button title="Match Case" className="rounded p-1 text-fg-3 hover:bg-hover hover:text-fg-2">
          <CaseSensitive size={13} />
        </button>
        <button title="Use Regex" className="rounded p-1 text-fg-3 hover:bg-hover hover:text-fg-2">
          <Regex size={13} />
        </button>
      </div>

      <div className="flex items-center gap-1 rounded border border-line bg-base px-2">
        <Replace size={13} className="shrink-0 text-fg-3" />
        <input
          placeholder="Replace"
          className="w-full bg-transparent py-1.5 text-[12.5px] text-fg outline-none placeholder:text-fg-3"
        />
      </div>

      <button className="flex items-center justify-center gap-1.5 rounded border border-accent/30 bg-accent/10 py-1.5 text-[12px] text-accent-2 hover:bg-accent/20">
        <Sparkles size={12} />
        Ask AI instead
      </button>

      <div className="mt-1 text-[11px] text-fg-3">3 results in 3 files</div>

      {searchResults.map((group) => (
        <div key={group.file}>
          <button
            onClick={() => openFile(group.file)}
            className="flex w-full items-center gap-1.5 rounded px-1 py-1 text-[12px] font-medium text-fg hover:bg-hover"
          >
            <FileCode size={13} className="shrink-0 text-fg-3" />
            <span className="truncate">{group.file}</span>
            <span className="ml-auto rounded-full bg-panel-2 px-1.5 text-[10px] text-fg-2">
              {group.matches.length}
            </span>
          </button>
          {group.matches.map((m, i) => (
            <button
              key={i}
              onClick={() => openFile(group.file)}
              className="flex w-full gap-2 rounded py-0.5 pl-6 pr-1 text-left font-mono text-[11.5px] text-fg-2 hover:bg-hover"
            >
              <span className="shrink-0 text-fg-3">{m.line}</span>
              <span className="truncate">{m.text.trim()}</span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
