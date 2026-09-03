import { useState } from "react";
import { AlertTriangle, Loader2, RotateCcw, X } from "lucide-react";

import { useGitStore } from "../../store/gitStore";
import { useUIStore } from "../../store/uiStore";
import { ConfirmDialog } from "../ConfirmDialog";
import type { GitMergeInProgress } from "../../lib/git";

/**
 * Plain-language header for the parked operation — no git jargon.
 * (`git_merge_in_progress` gives us the operation + what is coming in.)
 */
function headline(info: GitMergeInProgress, currentBranch: string): string {
  const into = `into '${currentBranch}'`;
  const source = info.sourceBranch ? `'${info.sourceBranch}'` : "another branch";
  switch (info.operation) {
    case "merge":
      return `Merging ${source} ${into}`;
    case "rebase":
      return `Replaying your commits on top of ${source}`;
    case "cherry-pick":
      return `Applying commit "${info.sourceSummary ?? "(unknown commit)"}" ${into}`;
    case "revert":
      return `Undoing commit "${info.sourceSummary ?? "(unknown commit)"}"`;
    default:
      return "A git operation is in progress";
  }
}

/**
 * Git Experience Chunk 2: Conflict Resolution Mode banner. Renders under
 * the TitleBar for the whole workspace whenever a merge/rebase/cherry-pick/
 * revert is parked mid-flight: plain-language header, "resolved x/y"
 * progress, a jump to the Review panel, and a big confirm-guarded Abort
 * as the safety net. Non-merge operations can't be aborted from here — the
 * backend's terminal-hint error is shown verbatim instead.
 */
export function ConflictBanner() {
  const mergeInfo = useGitStore((s) => s.mergeInfo);
  const conflicts = useGitStore((s) => s.conflicts);
  const resolvedPaths = useGitStore((s) => s.resolvedPaths);
  const branchInfo = useGitStore((s) => s.branchInfo);
  const [confirmingAbort, setConfirmingAbort] = useState(false);
  const [aborting, setAborting] = useState(false);
  const [abortError, setAbortError] = useState<string | null>(null);

  if (!mergeInfo.inProgress) return null;

  const currentBranch = branchInfo.branch ?? (branchInfo.detached ? "detached HEAD" : "current branch");
  const remaining = conflicts.length;
  const done = resolvedPaths.length;
  const total = remaining + done;

  const doAbort = async () => {
    setConfirmingAbort(false);
    setAborting(true);
    setAbortError(null);
    try {
      await useGitStore.getState().abortMerge();
    } catch (err) {
      // Backend's message verbatim — e.g. the terminal hint for
      // rebase/cherry-pick/revert, which Abort doesn't support yet.
      setAbortError(String(err));
    } finally {
      setAborting(false);
    }
  };

  return (
    <>
      <div className="flex items-center gap-3 border-b border-danger/40 bg-danger/10 px-3 py-1.5">
        <span className="flex min-w-0 items-center gap-1.5 text-[12.5px] font-medium text-danger">
          <AlertTriangle size={13} className="shrink-0" />
          <span className="truncate">{headline(mergeInfo, currentBranch)}</span>
        </span>
        <span className="shrink-0 rounded border border-danger/30 px-1.5 py-0.5 text-[10.5px] uppercase tracking-wide text-danger">
          Conflict Mode
        </span>
        <span className="shrink-0 text-[11.5px] text-fg-muted">
          {total === 0
            ? "No files left in conflict"
            : `resolved ${done}/${total}${remaining > 0 ? ` · ${remaining} to go` : ""}`}
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <button
            onClick={() => {
              const ui = useUIStore.getState();
              if (!ui.sidebarVisible) ui.toggleSidebar();
              ui.setActivity("review");
            }}
            className="rounded border border-border bg-panel px-2 py-1 text-[11.5px] text-fg hover:bg-hover"
          >
            Review Conflicts
          </button>
          <button
            disabled={aborting}
            onClick={() => setConfirmingAbort(true)}
            title="Give up on this merge and put everything back the way it was"
            className="flex items-center gap-1 rounded bg-danger px-2 py-1 text-[11.5px] font-medium text-white hover:brightness-110 disabled:opacity-60"
          >
            {aborting ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
            Abort
          </button>
        </div>
      </div>
      {abortError && (
        <div className="flex items-start gap-2 border-b border-danger/40 bg-base px-3 py-1.5 text-[11.5px] leading-snug text-danger">
          <span className="min-w-0 flex-1 whitespace-pre-line">{abortError}</span>
          <button
            onClick={() => setAbortError(null)}
            className="shrink-0 rounded p-0.5 text-fg-muted hover:text-fg"
          >
            <X size={11} />
          </button>
        </div>
      )}
      {confirmingAbort && (
        <ConfirmDialog
          title="Abort Merge"
          message={`Give up and put everything back the way it was before this ${mergeInfo.operation ?? "operation"} started? Conflict fixes you've already made will be thrown away.`}
          confirmLabel="Abort — I'm sure"
          danger
          onConfirm={() => void doAbort()}
          onCancel={() => setConfirmingAbort(false)}
        />
      )}
    </>
  );
}
