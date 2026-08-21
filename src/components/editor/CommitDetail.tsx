import { useEffect, useState } from "react";
import { FileDiff, GitCommitHorizontal, Copy, TriangleAlert } from "lucide-react";
import { useUIStore } from "../../store/uiStore";
import { gitShow, type GitShowCommit } from "../../lib/git";
import { formatRelativeTime, formatFullTime } from "../../lib/time";
import { statusColor } from "../../lib/statusColor";
import { writeClipboardText } from "../../lib/clipboard";

/**
 * Commit detail tab: header (message, author, time, sha) + the files changed
 * in this commit with per-file +/− stats. Clicking a file opens the diff
 * against the commit's first parent.
 */
export function CommitDetail({ sha }: { sha: string }) {
  const { workspacePath, openCommitFileDiff } = useUIStore();
  const [commit, setCommit] = useState<GitShowCommit | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setCommit(null);
    setLoadError(null);
    // Without Tauri the gitShow wrapper returns mock data (browser dev).
    gitShow(workspacePath ?? "", sha)
      .then((c) => {
        if (!cancelled) setCommit(c);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [workspacePath, sha]);

  if (loadError) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-fg-muted">
        <TriangleAlert size={24} strokeWidth={1.5} className="text-yellow" />
        <p className="font-mono text-[12px]">{sha.slice(0, 7)}</p>
        <p className="max-w-96 text-center text-[11.5px]">{loadError}</p>
      </div>
    );
  }

  if (!commit) {
    return (
      <div className="flex flex-1 items-center justify-center text-[12px] text-fg-muted">
        Loading commit {sha.slice(0, 7)}…
      </div>
    );
  }

  const additions = commit.files.reduce((n, f) => n + f.additions, 0);
  const deletions = commit.files.reduce((n, f) => n + f.deletions, 0);
  const [summary, ...bodyLines] = commit.message.split("\n");
  const body = bodyLines.join("\n").trim();

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {/* Header */}
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-start gap-2">
          <GitCommitHorizontal size={16} className="mt-0.5 shrink-0 text-accent" />
          <div className="min-w-0 flex-1">
            <p className="text-[13.5px] font-medium text-fg">{summary || "(no message)"}</p>
            {body && (
              <pre className="mt-1.5 whitespace-pre-wrap font-sans text-[12px] text-fg-muted">
                {body}
              </pre>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-fg-muted">
              <span>{commit.author}</span>
              <span title={formatFullTime(commit.time)}>
                {formatRelativeTime(commit.time)}
              </span>
              <button
                title={`Copy ${commit.sha}`}
                onClick={() => void writeClipboardText(commit.sha)}
                className="flex items-center gap-1 rounded font-mono hover:text-fg"
              >
                {commit.shortSha}
                <Copy size={10} />
              </button>
              {commit.isMerge && (
                <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-medium text-accent">
                  merge · {commit.parentCount} parents
                </span>
              )}
              <span className="font-mono">
                <span className="text-green">+{additions}</span>{" "}
                <span className="text-danger">−{deletions}</span>
              </span>
              <span>{commit.files.length} file{commit.files.length === 1 ? "" : "s"}</span>
            </div>
          </div>
        </div>
      </div>

      {/* File list */}
      {commit.isMerge ? (
        <div className="px-4 py-3 text-[12px] text-fg-muted">
          Merge commit — combined diff is not shown yet. Compare with a parent to inspect changes.
        </div>
      ) : (
        <div className="flex flex-col gap-0.5 p-2">
          {commit.files.map((f) => (
            <div
              key={f.path}
              onClick={() => openCommitFileDiff(f.path, commit.sha)}
              title={`Show ${f.path} changes in ${commit.shortSha}`}
              className="group flex w-full cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-[12.5px] text-fg-muted hover:bg-hover hover:text-fg"
            >
              <FileDiff size={13} className="shrink-0 text-fg-muted" />
              <span className="flex-1 truncate text-left">
                {f.oldPath ? `${f.oldPath} → ${f.path}` : f.path}
              </span>
              <span className="font-mono text-[10px]">
                <span className="text-green">+{f.additions}</span>{" "}
                <span className="text-danger">−{f.deletions}</span>
              </span>
              <span className={`font-mono text-[11px] font-semibold ${statusColor[f.status]}`}>
                {f.status}
              </span>
            </div>
          ))}
          {commit.files.length === 0 && (
            <div className="px-2 py-1 text-[12px] text-fg-muted">No file changes</div>
          )}
        </div>
      )}
    </div>
  );
}
