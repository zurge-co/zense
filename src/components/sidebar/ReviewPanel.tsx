import { useEffect, useState } from "react";
import { GitBranch, Sparkles, Bug, Check, CheckCircle2, RefreshCw, FileDiff, Plus, Minus, Loader2, RotateCcw, AlertTriangle, Upload } from "lucide-react";
import { gitPush } from "../../lib/git";
import { errMessage } from "../../lib/errors";
import { generateCommitMessage } from "../../lib/commitMessage";
import { summarizeFileChange, reviewAllChanges, findBugsInChanges } from "../../lib/aiReview";
import { useGitStore } from "../../store/gitStore";
import { useUIStore } from "../../store/uiStore";
import { statusColor } from "../../lib/statusColor";
import { ConfirmDialog } from "../ConfirmDialog";
import { ContextMenu, type ContextMenuItem } from "../ContextMenu";

export function ReviewPanel() {
  const { openDiff, openFile, workspacePath } = useUIStore();
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
  /** Push-from-Review state: in-flight push + last result (ok = accent, err = danger). */
  const [pushing, setPushing] = useState(false);
  const [pushFeedback, setPushFeedback] = useState<{ ok: boolean; message: string } | null>(null);

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

  /** Right-click on a change row → per-file AI review actions. */
  const openFileMenu = (e: React.MouseEvent, path: string, staged: boolean) => {
    e.preventDefault();
    if (!workspacePath) return;
    const root = workspacePath;
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          id: "ai-summarize",
          label: "Summarize with AI",
          icon: Sparkles,
          onClick: () => void runAi(() => summarizeFileChange(root, path, staged, "Summarize with AI")),
        },
        {
          id: "ai-find-bugs",
          label: "Find bugs with AI",
          icon: Bug,
          onClick: () => void runAi(() => findBugsInChanges(root, path, staged, "Find bugs with AI")),
        },
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

  const stagedStats = new Map(diffSummary.staged.map((e) => [e.path, e]));
  const unstagedStats = new Map(diffSummary.unstaged.map((e) => [e.path, e]));

  const stagedFiles = status.files.filter((f) => f.staged);
  const unstagedFiles = status.files.filter((f) => f.unstaged);

  return (
    <div className="flex flex-col gap-2 p-2">
      <div className="flex items-center justify-between rounded border border-border bg-base px-2 py-1.5">
        <span className="flex items-center gap-1.5 text-[12.5px] text-fg">
          <GitBranch size={13} className="text-fg-muted" />
          {branchInfo.branch ?? (branchInfo.detached ? "detached HEAD" : "main")}
          {(branchInfo.ahead > 0 || branchInfo.behind > 0) && (
            <span className="text-[10px] text-fg-muted">
              {branchInfo.ahead > 0 && ` ↑${branchInfo.ahead}`}
              {branchInfo.behind > 0 && ` ↓${branchInfo.behind}`}
            </span>
          )}
        </span>
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
          {/* ── Chunk 2: conflict overview while Conflict Mode is on ── */}
          {mergeInfo.inProgress && (
            <section className="rounded border border-danger/40 bg-danger/5 p-2">
              <div className="mb-1 flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-danger">
                <AlertTriangle size={12} />
                Conflicts · {resolvedPaths.length}/{conflicts.length + resolvedPaths.length} resolved
              </div>
              <div className="mb-1.5 text-[10.5px] leading-snug text-fg-muted">
                Open each file, keep the version you want, then Stage it — a
                staged file counts as resolved.
              </div>
              {conflicts.map((c) => (
                <div
                  key={`conflict-${c.path}`}
                  onClick={() => openFile(c.path)}
                  title={
                    c.conflictType === "modify-delete"
                      ? "One side edited this file, the other deleted it"
                      : `Both sides edited ${c.path}`
                  }
                  className="group flex w-full cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 text-[12.5px] text-fg hover:bg-hover"
                >
                  <AlertTriangle size={12} className="shrink-0 text-danger" />
                  <span className="flex-1 truncate text-left">{c.path}</span>
                  {c.conflictType === "modify-delete" && (
                    <span className="shrink-0 rounded border border-danger/30 px-1 text-[9px] uppercase tracking-wide text-danger">
                      edited + deleted
                    </span>
                  )}
                  <button
                    title="Stage as resolved"
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
                <div className="mt-1 text-[11px] text-accent">
                  Every conflict is resolved — finish the merge from the
                  integrated terminal (`git commit`).
                </div>
              )}
            </section>
          )}

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

          {/* AI Review — summarize every change + what a human must check,
              or scan all changes for bugs */}
          <button
            disabled={status.notARepo || (stagedFiles.length === 0 && unstagedFiles.length === 0)}
            title="Let AI summarize all changes and flag what a human must review"
            onClick={(e) => {
              if (!workspacePath) return;
              const root = workspacePath;
              const rect = e.currentTarget.getBoundingClientRect();
              setMenu({
                x: rect.left,
                y: rect.bottom + 4,
                items: [
                  {
                    id: "ai-review-all",
                    label: "Summarize all changes + review points",
                    icon: Sparkles,
                    onClick: () => void runAi(() => reviewAllChanges(root, "Summarize all changes + review points")),
                  },
                  {
                    id: "ai-bugs-all",
                    label: "Find bugs in all changes",
                    icon: Bug,
                    onClick: () => void runAi(() => findBugsInChanges(root, undefined, false, "Find bugs in all changes")),
                  },
                ],
              });
            }}
            className="flex w-full items-center justify-center gap-1.5 rounded border border-accent/30 bg-accent/10 py-1.5 text-[12px] text-accent hover:bg-accent/20 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Sparkles size={12} />
            AI Review
          </button>

          {commitError && <div className="text-[11px] text-danger">{commitError}</div>}
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
                    onContextMenu={(e) => openFileMenu(e, f.path, true)}
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
                onContextMenu={(e) => openFileMenu(e, f.path, false)}
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
        </>
      )}

      {menu && (
        <ContextMenu items={menu.items} position={{ x: menu.x, y: menu.y }} onClose={() => setMenu(null)} />
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
