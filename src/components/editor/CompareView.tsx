import { useEffect, useState } from "react";
import { FileDiff, GitCompareArrows, TriangleAlert } from "lucide-react";
import { useUIStore } from "../../store/uiStore";
import { gitDiffCommits, type GitDiffCommits } from "../../lib/git";
import { statusColor } from "../../lib/statusColor";

/**
 * Compare tab: per-file changes between two commits (from → to) with totals.
 * Clicking a file opens the diff between those two commits.
 */
export function CompareView({ fromSha, toSha }: { fromSha: string; toSha: string }) {
  const { workspacePath, openCommitFileDiff } = useUIStore();
  const [result, setResult] = useState<GitDiffCommits | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setResult(null);
    setLoadError(null);
    gitDiffCommits(workspacePath ?? "", fromSha, toSha)
      .then((r) => {
        if (!cancelled) setResult(r);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [workspacePath, fromSha, toSha]);

  const short = (s: string) => s.slice(0, 7);

  if (loadError) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-fg-muted">
        <TriangleAlert size={24} strokeWidth={1.5} className="text-yellow" />
        <p className="font-mono text-[12px]">
          {short(fromSha)}..{short(toSha)}
        </p>
        <p className="max-w-96 text-center text-[11.5px]">{loadError}</p>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="flex flex-1 items-center justify-center text-[12px] text-fg-muted">
        Comparing {short(fromSha)}..{short(toSha)}…
      </div>
    );
  }

  const additions = result.files.reduce((n, f) => n + f.additions, 0);
  const deletions = result.files.reduce((n, f) => n + f.deletions, 0);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {/* Header */}
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <GitCompareArrows size={15} className="shrink-0 text-accent" />
          <span className="font-mono text-[13px] text-fg">
            {short(fromSha)} <span className="text-fg-muted">→</span> {short(toSha)}
          </span>
          <span className="font-mono text-[11px]">
            <span className="text-green">+{additions}</span>{" "}
            <span className="text-danger">−{deletions}</span>
          </span>
          <span className="text-[11px] text-fg-muted">
            {result.files.length} file{result.files.length === 1 ? "" : "s"}
          </span>
        </div>
      </div>

      {/* File list */}
      <div className="flex flex-col gap-0.5 p-2">
        {result.files.map((f) => (
          <div
            key={f.path}
            onClick={() => openCommitFileDiff(f.path, toSha, fromSha)}
            title={`Show ${f.path} changes ${short(fromSha)} → ${short(toSha)}`}
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
        {result.files.length === 0 && (
          <div className="px-2 py-1 text-[12px] text-fg-muted">
            No differences between these commits
          </div>
        )}
      </div>
    </div>
  );
}
