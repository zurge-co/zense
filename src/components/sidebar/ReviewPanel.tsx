import { useEffect, useState } from "react";
import { GitBranch, Sparkles, Check, RefreshCw, FileDiff, Plus, Minus, Loader2, RotateCcw } from "lucide-react";
import { generateCommitMessage } from "../../lib/commitMessage";
import { useGitStore } from "../../store/gitStore";
import { useUIStore } from "../../store/uiStore";
import { statusColor } from "../../lib/statusColor";
import { ConfirmDialog } from "../ConfirmDialog";

export function ReviewPanel() {
  const { openDiff, workspacePath } = useUIStore();
  const { status, branchInfo, diffSummary, loading, refresh, stageFile, unstageFile, stageAll, commit, discardFile } = useGitStore();
  const [message, setMessage] = useState("");
  const [commitError, setCommitError] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);
  const [generating, setGenerating] = useState(false);
  /** File pending a reset confirmation: path + whether it's new (delete). */
  const [resetTarget, setResetTarget] = useState<{ path: string; isNew: boolean } | null>(null);

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

      {status.notARepo ? (
        <div className="text-[12.5px] text-fg-muted">Not a git repository</div>
      ) : (
        <>
          <textarea
            rows={3}
            placeholder="Commit message…"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            className="w-full resize-none rounded border border-border bg-base p-2 text-[12.5px] text-fg outline-none placeholder:text-fg-muted focus:border-accent"
          />

          <div className="flex gap-1.5">
            <button
              disabled={committing || !message.trim()}
              onClick={async () => {
                setCommitting(true);
                setCommitError(null);
                try {
                  await commit(message);
                  setMessage("");
                } catch (err) {
                  setCommitError(String(err));
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
                  setCommitError(String(err));
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
                    title={`Compare ${f.path} with HEAD`}
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
                title={`Compare ${f.path} with HEAD`}
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
