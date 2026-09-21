import { useEffect, useRef, useState } from "react";
import { GitBranch, Sparkles, Check, CheckCircle2, RefreshCw, FileDiff, Plus, Minus, Loader2, RotateCcw, AlertTriangle, Upload, ChevronDown } from "lucide-react";
import { gitPush } from "../../lib/git";
import { errMessage } from "../../lib/errors";
import { generateCommitMessage } from "../../lib/commitMessage";
import { runAutoReview } from "../../lib/aiReview";
import { finishMerge } from "../../lib/aiConflict";
import { useGitStore } from "../../store/gitStore";
import { useAiReviewStore } from "../../store/aiReviewStore";
import { useUIStore } from "../../store/uiStore";
import { statusColor } from "../../lib/statusColor";
import { ConfirmDialog } from "../ConfirmDialog";
import { ContextMenu, type ContextMenuItem } from "../ContextMenu";
import { BranchMenu } from "../layout/BranchMenu";

export function ReviewPanel() {
  const { openDiff, openFile, openResolution, workspacePath } = useUIStore();
  const { status, branchInfo, diffSummary, loading, refresh, stageFile, unstageFile, stageAll, commit, discardFile, mergeInfo, conflicts, resolvedPaths } = useGitStore();
  const [message, setMessage] = useState("");
  const [commitError, setCommitError] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);
  const [generating, setGenerating] = useState(false);
  /** File pending a reset confirmation: path + whether it's new (delete). */
  const [resetTarget, setResetTarget] = useState<{ path: string; isNew: boolean } | null>(null);
  /** Right-click context menu (change rows + the AI Review button). */
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  /** Finish-merge in flight (all conflicts resolved → audit commit). */
  const [finishing, setFinishing] = useState(false);
  /** Push-from-Review state: in-flight push + last result (ok = accent, err = danger). */
  const [pushing, setPushing] = useState(false);
  const [pushFeedback, setPushFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  /** Branch dropdown: the branch name is a button; the menu is anchored to it. */
  const branchRef = useRef<HTMLButtonElement>(null);
  const [branchMenu, setBranchMenu] = useState<{ top: number; left: number } | null>(null);

  /** Push without leaving the panel — same friendly GitOpResult as the BranchMenu. */
  const doPush = async () => {
    if (!workspacePath || pushing) return;
    setPushing(true);
    setPushFeedback(null);
    try {
      const r = await gitPush(workspacePath);
      setPushFeedback(r);
    } catch (err) {
      setPushFeedback({ ok: false, message: errMessage(err) });
    } finally {
      setPushing(false);
      await refresh(workspacePath);
    }
  };

  const runAi = async (fn: () => Promise<void>) => {
    setReviewError(null);
    try {
      await fn();
    } catch (err) {
      setReviewError(errMessage(err));
    }
  };

  /** Right-click on a change row → open its diff. */
  const openFileMenu = (e: React.MouseEvent, path: string) => {
    e.preventDefault();
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          id: "open-diff",
          label: "Open diff",
          icon: FileDiff,
          onClick: () => openDiff(path),
        },
      ],
    });
  };

  useEffect(() => {
    if (workspacePath) void refresh(workspacePath);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspacePath]);

  const reviewRunning = useAiReviewStore((s) => s.running);
  const stagedStats = new Map(diffSummary.staged.map((e) => [e.path, e]));
  const unstagedStats = new Map(diffSummary.unstaged.map((e) => [e.path, e]));

  const stagedFiles = status.files.filter((f) => f.staged);
  const unstagedFiles = status.files.filter((f) => f.unstaged);

  return (
    <div className="flex flex-col gap-2 p-2">
      <div className="flex items-center justify-between rounded border border-border bg-base px-2 py-1.5">
        <button
          ref={branchRef}
          disabled={status.notARepo}
          title={
            status.notARepo
              ? undefined
              : "Git branches — fetch, pull, switch branch, or create a new one (no terminal needed)"
          }
          onClick={() => {
            const rect = branchRef.current?.getBoundingClientRect();
            if (rect) setBranchMenu({ top: rect.bottom + 4, left: rect.left });
          }}
          className="flex items-center gap-1.5 rounded px-1 py-0.5 text-[12.5px] text-fg hover:bg-hover disabled:cursor-default disabled:hover:bg-transparent"
        >
          <GitBranch size={13} className="text-fg-muted" />
          {branchInfo.branch ?? (branchInfo.detached ? "detached HEAD" : "main")}
          {(branchInfo.ahead > 0 || branchInfo.behind > 0) && (
            <span className="text-[10px] text-fg-muted">
              {branchInfo.ahead > 0 && ` ↑${branchInfo.ahead}`}
              {branchInfo.behind > 0 && ` ↓${branchInfo.behind}`}
            </span>
          )}
          {!status.notARepo && <ChevronDown size={12} className="text-fg-muted" />}
        </button>
        <span className="flex items-center gap-0.5">
          {!status.notARepo && (
            <button
              // Lock push on states where it can't or shouldn't run:
              // detached HEAD (no branch name to push) and merge in-progress
              // (a half-resolved merge must not reach the server). A branch
              // that was never pushed has ahead = 0 yet still needs the
              // button — git_push links it with --set-upstream on first push.
              disabled={pushing || branchInfo.detached || mergeInfo.inProgress || (branchInfo.hasUpstream && branchInfo.ahead === 0)}
              title={
                branchInfo.detached
                  ? "You're looking at an old commit, not a branch — switch back to a branch first, then push"
                  : mergeInfo.inProgress
                    ? "Conflict Mode is on — finish the merge first (Push is locked for safety)"
                    : branchInfo.hasUpstream
                      ? branchInfo.ahead === 0
                        ? "Nothing to push — all your commits are on the server already"
                        : `Upload ${branchInfo.ahead} commit${branchInfo.ahead === 1 ? "" : "s"} to the server`
                      : "Upload your commits to the server — the first push also links this branch to it"
              }
              onClick={() => void doPush()}
              className="rounded p-1 text-fg-muted hover:bg-hover hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
            >
              {pushing ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
            </button>
          )}
          <button
            title="Refresh"
            onClick={() => {
              if (workspacePath) void refresh(workspacePath);
            }}
            className="rounded p-1 text-fg-muted hover:bg-hover hover:text-fg"
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
          </button>
        </span>
      </div>

      {status.notARepo ? (
        <div className="text-[12.5px] text-fg-muted">Not a git repository</div>
      ) : (
        <>
          {/* ── AI conflict resolution (spec V1): story-centric list ── */}
          {mergeInfo.inProgress && (
            <section className="rounded border border-danger/40 bg-danger/5 p-2">
              <div className="mb-1 flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-danger">
                <AlertTriangle size={12} />
                Conflicts · {resolvedPaths.length}/{conflicts.length + resolvedPaths.length} resolved
              </div>
              <div className="mb-1.5 text-[10.5px] leading-snug text-fg-muted">
                Open a file — Zense proposes a resolution with verified
                evidence; you accept, ask, or hand it to a teammate.
              </div>
              {conflicts.map((c) => (
                <div
                  key={`conflict-${c.path}`}
                  onClick={() => openResolution(c.path)}
                  title={
                    c.binary
                      ? "Both sides changed this binary file"
                      : c.conflictType === "modify-delete"
                        ? "One side edited this file, the other deleted it"
                        : `Both sides edited ${c.path}`
                  }
                  className="group flex w-full cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 text-[12.5px] text-fg hover:bg-hover"
                >
                  <AlertTriangle size={12} className="shrink-0 text-danger" />
                  <span className="flex-1 truncate text-left">{c.path}</span>
                  {c.binary && (
                    <span className="shrink-0 rounded border border-danger/30 px-1 text-[9px] uppercase tracking-wide text-danger">
                      binary
                    </span>
                  )}
                  {c.conflictType === "modify-delete" && (
                    <span className="shrink-0 rounded border border-danger/30 px-1 text-[9px] uppercase tracking-wide text-danger">
                      edited + deleted
                    </span>
                  )}
                  <button
                    title="Open the raw conflicted file in the editor (advanced)"
                    onClick={(e) => {
                      e.stopPropagation();
                      openFile(c.path);
                    }}
                    className="rounded p-0.5 text-fg-muted opacity-0 hover:bg-hover hover:text-fg group-hover:opacity-100"
                  >
                    <FileDiff size={12} />
                  </button>
                  <button
                    title="Stage as resolved — manual escape hatch"
                    onClick={(e) => {
                      e.stopPropagation();
                      void stageFile(c.path);
                    }}
                    className="rounded p-0.5 text-fg-muted opacity-0 hover:bg-hover hover:text-fg group-hover:opacity-100"
                  >
                    <Plus size={12} />
                  </button>
                </div>
              ))}
              {resolvedPaths.map((p) => (
                <div
                  key={`resolved-${p}`}
                  onClick={() => openFile(p)}
                  className="flex w-full cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 text-[12.5px] text-fg-muted hover:bg-hover"
                >
                  <CheckCircle2 size={12} className="shrink-0 text-green" />
                  <span className="flex-1 truncate text-left line-through opacity-70">{p}</span>
                </div>
              ))}
              {conflicts.length === 0 && resolvedPaths.length > 0 && (
                <div className="mt-1">
                  {mergeInfo.operation === "merge" ? (
                    <button
                      disabled={finishing || !workspacePath}
                      title="Create the merge commit — the AI audit trail goes into its message"
                      onClick={() => {
                        if (!workspacePath) return;
                        setFinishing(true);
                        setReviewError(null);
                        const source = mergeInfo.sourceBranch
                          ? `Merge branch '${mergeInfo.sourceBranch}'`
                          : "";
                        void finishMerge(workspacePath, source)
                          .catch((err) => setReviewError(errMessage(err)))
                          .finally(() => setFinishing(false));
                      }}
                      className="flex w-full items-center justify-center gap-1.5 rounded bg-accent px-2 py-1.5 text-[12px] font-medium text-white hover:brightness-110 disabled:opacity-60"
                    >
                      {finishing ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                      Finish merge · {resolvedPaths.length} file{resolvedPaths.length === 1 ? "" : "s"} resolved
                    </button>
                  ) : (
                    <div className="text-[11px] text-accent">
                      Every conflict is resolved — continue the {mergeInfo.operation ?? "operation"}{" "}
                      from the integrated terminal.
                    </div>
                  )}
                </div>
              )}
            </section>
          )}

          {/* Auto Review — the staged diff is reviewed chunk by chunk by
              the configured LLM; findings land in the bottom panel grouped
              as Bug / Risk / Human Review (re-run starts a fresh session). */}
          <button
            disabled={reviewRunning || stagedFiles.length === 0}
            title={
              stagedFiles.length === 0
                ? "Stage changes first — Auto Review reads the staged diff"
                : "Review the staged diff with AI and list the findings below"
            }
            onClick={() => {
              if (!workspacePath) return;
              void runAi(() => runAutoReview(workspacePath));
            }}
            className="flex w-full items-center justify-center gap-1.5 rounded border border-accent/30 bg-accent/10 py-1.5 text-[12px] text-accent hover:bg-accent/20 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {reviewRunning ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
            Auto Review
          </button>

          {reviewError && <div className="text-[11px] text-danger">{reviewError}</div>}
          {pushFeedback && (
            <div className={`whitespace-pre-line text-[11px] ${pushFeedback.ok ? "text-accent" : "text-danger"}`}>
              {pushFeedback.message}
            </div>
          )}

          {stagedFiles.length > 0 && (
            <>
              <div className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-fg-muted">
                Staged · {stagedFiles.length}
              </div>
              {stagedFiles.map((f) => {
                const stats = stagedStats.get(f.path);
                return (
                  <div
                    key={`staged-${f.path}`}
                    onClick={() => openDiff(f.path)}
                    onContextMenu={(e) => openFileMenu(e, f.path)}
                    title={`Compare ${f.path} with HEAD — right-click for AI review`}
                    className="group flex w-full cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 text-[12.5px] text-fg-muted hover:bg-hover hover:text-fg"
                  >
                    <FileDiff size={13} className="shrink-0 text-fg-muted" />
                    <span className="flex-1 truncate text-left">{f.path}</span>
                    {stats && (
                      <span className="font-mono text-[10px]">
                        <span className="text-green">+{stats.additions}</span>{" "}
                        <span className="text-danger">−{stats.deletions}</span>
                      </span>
                    )}
                    <span className={`font-mono text-[11px] font-semibold ${statusColor[f.staged!]}`}>
                      {f.staged}
                    </span>
                    <button
                      title="Reset — discard this file's changes back to HEAD"
                      onClick={(e) => {
                        e.stopPropagation();
                        setResetTarget({ path: f.path, isNew: f.staged === "A" });
                      }}
                      className="rounded p-0.5 text-fg-muted opacity-0 hover:bg-hover hover:text-fg group-hover:opacity-100"
                    >
                      <RotateCcw size={12} />
                    </button>
                    <button
                      title="Unstage"
                      onClick={(e) => {
                        e.stopPropagation();
                        void unstageFile(f.path);
                      }}
                      className="rounded p-0.5 text-fg-muted opacity-0 hover:bg-hover hover:text-fg group-hover:opacity-100"
                    >
                      <Minus size={12} />
                    </button>
                  </div>
                );
              })}
            </>
          )}

          <div className="flex items-center justify-between">
            <div className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-fg-muted">
              Changes · {unstagedFiles.length}
            </div>
            {unstagedFiles.length > 0 && (
              <button onClick={() => void stageAll()} className="text-[11px] text-accent hover:opacity-80">
                Stage All
              </button>
            )}
          </div>

          {unstagedFiles.map((f) => {
            const stats = unstagedStats.get(f.path);
            return (
              <div
                key={`unstaged-${f.path}`}
                onClick={() => openDiff(f.path)}
                onContextMenu={(e) => openFileMenu(e, f.path)}
                title={`Compare ${f.path} with HEAD — right-click for AI review`}
                className="group flex w-full cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 text-[12.5px] text-fg-muted hover:bg-hover hover:text-fg"
              >
                <FileDiff size={13} className="shrink-0 text-fg-muted" />
                <span className="flex-1 truncate text-left">{f.path}</span>
                {stats && (
                  <span className="font-mono text-[10px]">
                    <span className="text-green">+{stats.additions}</span>{" "}
                    <span className="text-danger">−{stats.deletions}</span>
                  </span>
                )}
                <span className={`font-mono text-[11px] font-semibold ${statusColor[f.unstaged!]}`}>
                  {f.unstaged}
                </span>
                <button
                  title="Stage"
                  onClick={(e) => {
                    e.stopPropagation();
                    void stageFile(f.path);
                  }}
                  className="rounded p-0.5 text-fg-muted opacity-0 hover:bg-hover hover:text-fg group-hover:opacity-100"
                >
                  <Plus size={12} />
                </button>
                <button
                  title="Reset — discard this file's changes back to HEAD"
                  onClick={(e) => {
                    e.stopPropagation();
                    setResetTarget({ path: f.path, isNew: !f.staged && f.unstaged === "A" });
                  }}
                  className="rounded p-0.5 text-fg-muted opacity-0 hover:bg-hover hover:text-fg group-hover:opacity-100"
                >
                  <RotateCcw size={12} />
                </button>
              </div>
            );
          })}

          {stagedFiles.length === 0 && unstagedFiles.length === 0 && (
            <div className="text-[12.5px] text-fg-muted">No changes</div>
          )}

          {/* Commit box last — the workflow is review the changes, then
              write the message and commit. */}
          <textarea
            rows={3}
            placeholder="Commit message…"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            className="w-full resize-none rounded border border-border bg-base p-2 text-[12.5px] text-fg outline-none placeholder:text-fg-muted focus:border-accent"
          />

          <div className="flex gap-1.5">
            <button
              disabled={committing || !message.trim() || mergeInfo.inProgress}
              title={
                mergeInfo.inProgress
                  ? "Conflict Mode is on — resolve the conflicts first (Commit is locked for safety)"
                  : undefined
              }
              onClick={async () => {
                setCommitting(true);
                setCommitError(null);
                try {
                  await commit(message);
                  setMessage("");
                } catch (err) {
                  setCommitError(errMessage(err));
                } finally {
                  setCommitting(false);
                }
              }}
              className="flex flex-1 items-center justify-center gap-1.5 rounded bg-accent py-1.5 text-[12px] font-medium text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Check size={12} />
              {committing ? "Committing…" : "Commit"}
            </button>
            <button
              disabled={committing || generating || stagedFiles.length === 0}
              title={
                stagedFiles.length === 0
                  ? "Stage changes first, then AI can write the message"
                  : "Write a commit message from the staged changes with AI"
              }
              onClick={async () => {
                if (!workspacePath || generating) return;
                setGenerating(true);
                setCommitError(null);
                try {
                  setMessage(await generateCommitMessage(workspacePath));
                } catch (err) {
                  setCommitError(errMessage(err));
                } finally {
                  setGenerating(false);
                }
              }}
              className="flex items-center gap-1.5 rounded border border-accent/30 bg-accent/10 px-2.5 py-1.5 text-[12px] text-accent hover:bg-accent/20 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {generating ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
              AI
            </button>
          </div>

          {commitError && <div className="text-[11px] text-danger">{commitError}</div>}
        </>
      )}

      {menu && (
        <ContextMenu items={menu.items} position={{ x: menu.x, y: menu.y }} onClose={() => setMenu(null)} />
      )}

      {branchMenu && (
        <BranchMenu onClose={() => setBranchMenu(null)} anchorStyle={{ top: branchMenu.top, left: branchMenu.left }} />
      )}

      {resetTarget && (
        <ConfirmDialog
          title="Reset File"
          message={
            resetTarget.isNew
              ? `"${resetTarget.path}" is a new file — resetting will delete it permanently.`
              : `Discard all changes to "${resetTarget.path}" and restore it to the last commit (HEAD)? This cannot be undone.`
          }
          confirmLabel="Reset File"
          danger
          onConfirm={() => {
            void discardFile(resetTarget.path);
            setResetTarget(null);
          }}
          onCancel={() => setResetTarget(null)}
        />
      )}
    </div>
  );
}
