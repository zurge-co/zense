import { useEffect, useRef, useState } from "react";
import {
  CaseSensitive,
  ChevronDown,
  ChevronRight,
  File,
  Regex,
  Replace,
  ReplaceAll,
  X,
} from "lucide-react";
import { useUIStore } from "../../store/uiStore";
import { useWorkspaceStore } from "../../store/workspaceStore";
import {
  searchWorkspace,
  replaceInWorkspace,
  groupByFile,
  targetOf,
  totalReplaced,
  type SearchMatch,
  type SearchOptions,
} from "../../lib/search";
import { getActiveEditor } from "../../lib/editorRef";
import { ConfirmDialog, type ConfirmDialogProps } from "../ConfirmDialog";

/**
 * Workspace-wide search & replace (⌘⇧F), VSCode-style: literal or regex
 * query (with $1 capture references in replace), files-to-include/exclude
 * glob filters, per-match / per-file / workspace-wide replace on disk,
 * results grouped by file, click a match to open the file at that line.
 */
export function SearchPanel() {
  const workspacePath = useUIStore((s) => s.workspacePath);
  const searchFocusNonce = useUIStore((s) => s.searchFocusNonce);

  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [isRegex, setIsRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [include, setInclude] = useState("");
  const [exclude, setExclude] = useState("");
  const [matches, setMatches] = useState<SearchMatch[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [confirmReplaceAll, setConfirmReplaceAll] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  // Guards against out-of-order responses when typing quickly.
  const searchSeq = useRef(0);
  // Bumped after a replace to force a fresh search.
  const [refreshNonce, setRefreshNonce] = useState(0);

  // Focus the input whenever ⌘⇧F asks for it.
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [searchFocusNonce]);

  const opts: SearchOptions = { caseSensitive, isRegex, include, exclude };

  // Debounced search on query / options / workspace / post-replace refresh.
  useEffect(() => {
    const seq = ++searchSeq.current;
    setNotice(null);
    if (!workspacePath || query.trim() === "") {
      setMatches([]);
      setError(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(() => {
      void searchWorkspace(workspacePath, query, { caseSensitive, isRegex, include, exclude })
        .then((hits) => {
          if (searchSeq.current !== seq) return;
          setMatches(hits);
          setError(null);
          setSearching(false);
        })
        .catch((err) => {
          if (searchSeq.current !== seq) return;
          setError(String(err));
          setSearching(false);
        });
    }, 250);
    return () => clearTimeout(timer);
  }, [workspacePath, query, caseSensitive, isRegex, include, exclude, refreshNonce]);

  const openMatch = (match: SearchMatch) => {
    useUIStore.getState().openFile(match.path);
    // The editor may still be mounting for freshly opened files — poll
    // briefly until it registers itself, then reveal and select the match.
    const deadline = Date.now() + 3000;
    const tryReveal = () => {
      const editor = getActiveEditor();
      if (!editor) {
        if (Date.now() < deadline) setTimeout(tryReveal, 60);
        return;
      }
      editor.revealLineInCenter(match.line);
      editor.setSelection({
        startLineNumber: match.line,
        startColumn: match.column,
        endLineNumber: match.line,
        endColumn: match.column + match.length,
      });
      editor.focus();
    };
    setTimeout(tryReveal, 60);
  };

  /** Apply a (scoped or global) replace, then invalidate caches + refresh. */
  const runReplace = async (scope: "all" | { targets: SearchMatch[] }) => {
    if (!workspacePath || query.trim() === "") return;
    try {
      const summaries = await replaceInWorkspace(
        workspacePath,
        query,
        replacement,
        opts,
        scope === "all" ? undefined : scope.targets.map(targetOf),
      );
      void useWorkspaceStore
        .getState()
        .refreshFiles(
          workspacePath,
          summaries.map((s) => s.path),
        );
      const n = totalReplaced(summaries);
      setNotice(
        n === 0
          ? "Nothing to replace (results may be stale — try a fresh search)"
          : `Replaced ${n} occurrence${n === 1 ? "" : "s"} in ${summaries.length} file${summaries.length === 1 ? "" : "s"}`,
      );
      setRefreshNonce((v) => v + 1);
    } catch (err) {
      setError(String(err));
    }
  };

  const toggleCollapsed = (path: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const groups = groupByFile(matches);
  // The backend caps results — hint that they may be truncated.
  const CAPPED = 500;
  const canReplace = !searching && matches.length > 0;

  return (
    <div className="flex flex-col gap-2 p-2">
      {/* Search input + option toggles */}
      <div className="flex items-center gap-1 rounded border border-border bg-base px-2 py-1 focus-within:border-accent">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={isRegex ? "Search (regex)" : "Search"}
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent text-[12.5px] text-fg outline-none placeholder:text-fg-muted"
        />
        {query && (
          <button
            title="Clear"
            onClick={() => setQuery("")}
            className="rounded p-0.5 text-fg-muted hover:text-fg"
          >
            <X size={12} />
          </button>
        )}
        <OptionToggle
          title="Match Case"
          active={caseSensitive}
          onClick={() => setCaseSensitive((v) => !v)}
        >
          <CaseSensitive size={14} />
        </OptionToggle>
        <OptionToggle
          title="Use Regular Expression"
          active={isRegex}
          onClick={() => setIsRegex((v) => !v)}
        >
          <Regex size={14} />
        </OptionToggle>
      </div>

      {/* Replace input + Replace All */}
      <div className="flex items-center gap-1 rounded border border-border bg-base px-2 py-1 focus-within:border-accent">
        <input
          value={replacement}
          onChange={(e) => setReplacement(e.target.value)}
          placeholder={isRegex ? "Replace ($1 = capture groups)" : "Replace"}
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent text-[12.5px] text-fg outline-none placeholder:text-fg-muted"
        />
        <button
          title="Replace All"
          disabled={!canReplace}
          onClick={() => setConfirmReplaceAll(true)}
          className="rounded p-0.5 text-fg-muted hover:text-fg disabled:opacity-30"
        >
          <ReplaceAll size={14} />
        </button>
      </div>

      {/* files to include / exclude */}
      <input
        value={include}
        onChange={(e) => setInclude(e.target.value)}
        placeholder="files to include (e.g. *.ts, src/**)"
        spellCheck={false}
        className="rounded border border-border bg-base px-2 py-1 text-[11.5px] text-fg outline-none placeholder:text-fg-muted focus:border-accent"
      />
      <input
        value={exclude}
        onChange={(e) => setExclude(e.target.value)}
        placeholder="files to exclude (e.g. dist/**)"
        spellCheck={false}
        className="rounded border border-border bg-base px-2 py-1 text-[11.5px] text-fg outline-none placeholder:text-fg-muted focus:border-accent"
      />

      {/* Status line */}
      {error ? (
        <div className="px-1 text-[11.5px] text-danger">{error}</div>
      ) : notice ? (
        <div className="px-1 text-[11.5px] text-green">{notice}</div>
      ) : query.trim() !== "" && !searching ? (
        <div className="px-1 text-[11px] text-fg-muted">
          {matches.length === 0
            ? "No results"
            : `${matches.length}${matches.length >= CAPPED ? "+" : ""} results in ${groups.length} files`}
        </div>
      ) : null}

      {/* Results grouped by file */}
      <div className="flex flex-col gap-0.5">
        {groups.map(([path, hits]) => {
          const isCollapsed = collapsed.has(path);
          return (
            <div key={path} className="group/file">
              <div className="flex items-center gap-1 rounded px-1 py-0.5 text-[12px] text-fg hover:bg-hover">
                <button
                  onClick={() => toggleCollapsed(path)}
                  className="flex min-w-0 flex-1 items-center gap-1 text-left"
                >
                  {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                  <File size={12} className="shrink-0 text-fg-muted" />
                  <span className="min-w-0 flex-1 truncate">{path}</span>
                </button>
                <button
                  title={`Replace all ${hits.length} in ${path}`}
                  onClick={() => void runReplace({ targets: hits })}
                  className="shrink-0 rounded p-0.5 text-fg-muted opacity-0 hover:bg-active hover:text-fg group-hover/file:opacity-100"
                >
                  <ReplaceAll size={12} />
                </button>
                <span className="shrink-0 rounded bg-hover px-1 text-[10px] text-fg-muted">
                  {hits.length}
                </span>
              </div>
              {!isCollapsed &&
                hits.map((m, i) => (
                  <div
                    key={`${m.line}:${m.column}:${i}`}
                    className="group/match flex items-baseline rounded py-0.5 pl-6 pr-1 text-[12px] text-fg hover:bg-hover"
                  >
                    <button
                      onClick={() => openMatch(m)}
                      className="flex min-w-0 flex-1 items-baseline gap-1.5 text-left"
                    >
                      <span className="shrink-0 text-[10.5px] tabular-nums text-fg-muted">
                        {m.line}
                      </span>
                      <MatchLine match={m} />
                    </button>
                    <button
                      title="Replace"
                      onClick={() => void runReplace({ targets: [m] })}
                      className="shrink-0 rounded p-0.5 text-fg-muted opacity-0 hover:bg-active hover:text-fg group-hover/match:opacity-100"
                    >
                      <Replace size={12} />
                    </button>
                  </div>
                ))}
            </div>
          );
        })}
      </div>

      {confirmReplaceAll && (
        <ReplaceAllConfirm
          count={matches.length}
          filesCount={groups.length}
          onCancel={() => setConfirmReplaceAll(false)}
          onConfirm={() => {
            setConfirmReplaceAll(false);
            void runReplace("all");
          }}
        />
      )}
    </div>
  );
}

/** Small toggle button in the search box (Aa / .*). */
function OptionToggle({
  title,
  active,
  onClick,
  children,
}: {
  title: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`rounded p-0.5 ${
        active ? "bg-accent/20 text-accent" : "text-fg-muted hover:text-fg"
      }`}
    >
      {children}
    </button>
  );
}

/** Match line text with the hit portion highlighted. */
function MatchLine({ match }: { match: SearchMatch }) {
  const chars = [...match.lineText.trimStart()];
  // Column is relative to the untrimmed line; adjust for trimmed indent.
  const trim = match.lineText.length - match.lineText.trimStart().length;
  const start = Math.max(0, match.column - 1 - trim);
  const before = chars.slice(0, start).join("");
  const hit = chars.slice(start, start + match.length).join("");
  const after = chars.slice(start + match.length).join("");
  return (
    <span className="truncate">
      {before}
      <span className="rounded bg-accent/25 text-accent">{hit}</span>
      {after}
    </span>
  );
}

/** Confirm dialog for a workspace-wide Replace All. */
function ReplaceAllConfirm({
  count,
  filesCount,
  onConfirm,
  onCancel,
}: Pick<ConfirmDialogProps, "onConfirm" | "onCancel"> & {
  count: number;
  filesCount: number;
}) {
  return (
    <ConfirmDialog
      title="Replace All"
      message={`Replace ${count} occurrence${count === 1 ? "" : "s"} across ${filesCount} file${filesCount === 1 ? "" : "s"}? Files are modified on disk.`}
      confirmLabel="Replace"
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
