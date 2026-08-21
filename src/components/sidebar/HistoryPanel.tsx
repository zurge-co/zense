import { useEffect, useRef, useState } from "react";
import { RefreshCw, GitCompareArrows, X, Copy } from "lucide-react";
import { useGitStore } from "../../store/gitStore";
import { useUIStore } from "../../store/uiStore";
import { formatRelativeTime, formatFullTime } from "../../lib/time";
import { ContextMenu, type ContextMenuItem } from "../ContextMenu";
import { writeClipboardText } from "../../lib/clipboard";

export function HistoryPanel() {
  const {
    workspacePath,
    openCommit,
    openCompare,
    historyCompareBase,
    setHistoryCompareBase,
  } = useUIStore();
  const {
    commits,
    logHasMore,
    logLoading,
    loading,
    error,
    status,
    refresh,
    loadMoreCommits,
  } = useGitStore();

  const [menu, setMenu] = useState<{ sha: string; x: number; y: number } | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (workspacePath) void refresh(workspacePath);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspacePath]);

  // Infinite scroll: load the next page when the sentinel scrolls into view.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadMoreCommits();
      },
      { rootMargin: "120px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadMoreCommits]);

  const short = (sha: string) => sha.slice(0, 7);

  const menuItems: ContextMenuItem[] = menu
    ? [
        {
          id: "open",
          label: "Open Commit",
          onClick: () => openCommit(menu.sha),
        },
        {
          id: "copy-sha",
          label: "Copy Commit SHA",
          icon: Copy,
          onClick: () => void writeClipboardText(menu.sha),
        },
        ...(historyCompareBase && historyCompareBase !== menu.sha
          ? [
              {
                id: "compare",
                label: `Compare with ${short(historyCompareBase)} → ${short(menu.sha)}`,
                icon: GitCompareArrows,
                onClick: () => openCompare(historyCompareBase, menu.sha),
              },
            ]
          : [
              {
                id: "select-compare",
                label:
                  historyCompareBase === menu.sha
                    ? "Clear Compare Selection"
                    : "Select for Compare",
                icon: GitCompareArrows,
                onClick: () =>
                  setHistoryCompareBase(historyCompareBase === menu.sha ? null : menu.sha),
              },
            ]),
      ]
    : [];

  return (
    <div className="flex flex-col p-2">
      {/* Toolbar */}
      <div className="mb-1 flex items-center justify-between rounded border border-border bg-base px-2 py-1.5">
        <span className="text-[12.5px] text-fg">
          {commits.length} commit{commits.length === 1 ? "" : "s"}
        </span>
        <button
          title="Refresh"
          onClick={() => {
            if (workspacePath) void refresh(workspacePath);
          }}
          className="rounded p-1 text-fg-muted hover:bg-hover hover:text-fg"
        >
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      {/* Compare-base hint */}
      {historyCompareBase && (
        <div className="mb-1 flex items-center gap-1.5 rounded border border-accent/30 bg-accent/10 px-2 py-1 text-[11px] text-accent">
          <GitCompareArrows size={11} />
          <span className="flex-1 font-mono">base: {short(historyCompareBase)}</span>
          <button
            title="Clear compare selection"
            onClick={() => setHistoryCompareBase(null)}
            className="rounded p-0.5 hover:bg-accent/20"
          >
            <X size={11} />
          </button>
        </div>
      )}

      {status.notARepo ? (
        <div className="p-1 text-[12.5px] text-fg-muted">Not a git repository</div>
      ) : commits.length === 0 && !loading ? (
        <div className="p-1 text-[12.5px] text-fg-muted">
          {error ? `Failed to load history: ${error}` : "No commits yet"}
        </div>
      ) : (
        <>
          {error && (
            <div className="mb-1 rounded border border-danger/40 bg-danger/10 px-2 py-1 text-[11px] text-danger">
              Refresh failed: {error}
            </div>
          )}
        </>
      )}
      {!status.notARepo && commits.length > 0 && (
        <>
          {commits.map((c) => (
            <div
              key={c.sha}
              onClick={() => openCommit(c.sha)}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ sha: c.sha, x: e.clientX, y: e.clientY });
              }}
              title={`${c.summary}\n${c.author} · ${formatFullTime(c.time)}\n${c.sha}`}
              className={`w-full cursor-pointer rounded px-2 py-1.5 text-left hover:bg-hover ${
                historyCompareBase === c.sha ? "bg-accent/10 ring-1 ring-accent/30" : ""
              }`}
            >
              <div className="flex items-center gap-1.5">
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-fg">
                  {c.summary || "(no message)"}
                </span>
                {c.isMerge && (
                  <span className="shrink-0 rounded bg-accent/15 px-1 text-[9.5px] font-medium text-accent">
                    merge
                  </span>
                )}
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-[10.5px] text-fg-muted">
                <span className="truncate">
                  {c.author} · {formatRelativeTime(c.time)}
                </span>
                <span className="flex-1" />
                {(c.additions > 0 || c.deletions > 0) && (
                  <span className="shrink-0 font-mono">
                    <span className="text-green">+{c.additions}</span>{" "}
                    <span className="text-danger">−{c.deletions}</span>
                  </span>
                )}
                <span className="shrink-0 font-mono">{c.shortSha}</span>
              </div>
            </div>
          ))}

          {/* Infinite-scroll sentinel + footer state */}
          <div ref={sentinelRef} className="h-1" />
          {logLoading && (
            <div className="py-2 text-center text-[11px] text-fg-muted">Loading…</div>
          )}
          {!logHasMore && commits.length > 0 && !logLoading && (
            <div className="py-2 text-center text-[10.5px] text-fg-muted/60">
              — end of history —
            </div>
          )}
        </>
      )}

      {menu && (
        <ContextMenu
          items={menuItems}
          position={{ x: menu.x, y: menu.y }}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}
