import { useEffect, useMemo, useRef, useState } from "react";
import { File } from "lucide-react";
import { useUIStore } from "../store/uiStore";
import { useWorkspaceStore } from "../store/workspaceStore";

const MAX_RESULTS = 20;

/**
 * Quick-open file modal (⌘P): substring match over the workspace file
 * index, keyboard navigation (↑/↓/Enter/Esc). Ranked so filename hits and
 * earlier matches float to the top.
 */
export function QuickOpen() {
  const visible = useUIStore((s) => s.quickOpenVisible);
  const { setQuickOpenVisible, openFile } = useUIStore();
  const fileIndex = useWorkspaceStore((s) => s.fileIndex);

  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (visible) {
      setQuery("");
      setSel(0);
      // Focus after the modal mounts.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [visible]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = q ? fileIndex.filter((p) => p.toLowerCase().includes(q)) : fileIndex;
    const name = (p: string) => p.split("/").pop()!.toLowerCase();
    return [...pool]
      .sort((a, b) => {
        if (!q) return a.localeCompare(b);
        const aName = name(a).includes(q) ? 0 : 1;
        const bName = name(b).includes(q) ? 0 : 1;
        if (aName !== bName) return aName - bName;
        return a.toLowerCase().indexOf(q) - b.toLowerCase().indexOf(q);
      })
      .slice(0, MAX_RESULTS);
  }, [fileIndex, query]);

  if (!visible) return null;

  const pick = (path: string) => {
    setQuickOpenVisible(false);
    openFile(path);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setQuickOpenVisible(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((s) => Math.min(s + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter" && results[sel]) {
      pick(results[sel]);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-center bg-black/50 pt-[12vh]"
      onClick={() => setQuickOpenVisible(false)}
    >
      <div
        className="h-fit w-[520px] overflow-hidden rounded-lg border border-border bg-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSel(0);
          }}
          onKeyDown={onKey}
          placeholder="Type a file name…"
          className="w-full border-b border-border bg-transparent px-4 py-3 font-mono text-[13px] text-fg outline-none placeholder:text-fg-muted"
        />
        <div className="max-h-[320px] overflow-y-auto py-1">
          {results.length === 0 && (
            <div className="px-4 py-3 text-[12px] text-fg-muted">No matching files</div>
          )}
          {results.map((p, i) => (
            <button
              key={p}
              onClick={() => pick(p)}
              onMouseEnter={() => setSel(i)}
              className={`flex w-full items-center gap-2 px-4 py-1.5 text-left font-mono text-[12px] ${
                i === sel ? "bg-active text-fg" : "text-fg-muted"
              }`}
            >
              <File size={12} className="shrink-0" />
              <span className="truncate">{p}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
