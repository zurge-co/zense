import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Code2,
  Loader2,
  MessageCircleQuestion,
  Send,
  UserCheck,
  X,
} from "lucide-react";

import { useGitStore } from "../../store/gitStore";
import { useUIStore } from "../../store/uiStore";
import {
  useConflictResolutionStore,
  effectiveContent,
  type ResolutionRecord,
} from "../../store/conflictResolutionStore";
import {
  analyzeConflict,
  acceptResolution,
  acceptSide,
  acceptDeletion,
  askConflictQuestion,
  buildReviewPacket,
} from "../../lib/aiConflict";
import { gitReadConflictFile } from "../../lib/git";
import { detectLanguage } from "../../lib/lang";
import { errMessage } from "../../lib/errors";
import { writeClipboardText } from "../../lib/clipboard";
import { CodeEditor } from "../editor/CodeEditor";
import { ConfirmDialog } from "../ConfirmDialog";

/**
 * AI Conflict Resolution Workspace (spec V1) — the story-first surface:
 * what happened (Change Story) → what Zense proposes (evidence-checked)
 * → show code. FACT (VERIFIED, tool-generated) and INTERPRETATION (AI)
 * are visually separated; ours/theirs jargon never appears; the raw
 * sides stay reachable as the opt-in third tier.
 *
 * Merge gets the full flow. Rebase/cherry-pick/revert render the story
 * read-only with an explicit continue-in-terminal handoff — never faked.
 */
export function ResolutionWorkspace() {
  const path = useUIStore((s) => s.resolutionPath);
  const closeResolution = useUIStore((s) => s.closeResolution);
  const entry = useGitStore((s) => s.conflicts.find((c) => c.path === path));
  const mergeInfo = useGitStore((s) => s.mergeInfo);
  const record = useConflictResolutionStore((s) => (path ? s.records[path] : undefined));
  const root = useGitStore((s) => s.currentRoot);

  const isMerge = mergeInfo.operation === "merge" || mergeInfo.operation === undefined;

  // Kick the analysis as soon as a path opens (idempotent — the store
  // refuses to regress proposed/accepted records).
  useEffect(() => {
    if (path && root && entry) void analyzeConflict(root, path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, root, entry?.path]);

  if (!path) return null;

  const kindLabel =
    record?.kind === "modify-delete"
      ? "edited + deleted"
      : record?.kind === "binary"
        ? "binary"
        : "content";

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50" onClick={closeResolution}>
      <div
        className="flex max-h-[85vh] w-[860px] max-w-[94vw] flex-col overflow-hidden rounded-lg border border-border bg-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
          <AlertTriangle size={14} className="shrink-0 text-danger" />
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-fg" title={path}>
            {path}
          </span>
          <span className="shrink-0 rounded border border-danger/30 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-danger">
            {kindLabel}
          </span>
          <button onClick={closeResolution} className="shrink-0 rounded p-1 text-fg-muted hover:bg-hover hover:text-fg">
            <X size={14} />
          </button>
        </div>

        {!isMerge && (
          <div className="border-b border-border bg-base px-4 py-2 text-[12px] leading-snug text-fg-muted">
            Zense can explain this conflict, but it cannot safely continue a{" "}
            <span className="font-medium text-fg">{mergeInfo.operation}</span> yet — apply the
            resolution in the integrated terminal after reviewing.
          </div>
        )}

        {!entry ? (
          <div className="flex items-center gap-2 px-4 py-8 text-[12.5px] text-fg-muted">
            <CheckCircle2 size={14} className="text-green" />
            This file is no longer in conflict — it may already be resolved.
          </div>
        ) : !record ? (
          <Busy text="Preparing…" />
        ) : record.kind === "modify-delete" ? (
          <ModifyDeleteFlow record={record} root={root} isMerge={isMerge} />
        ) : record.kind === "binary" ? (
          <BinaryFlow record={record} root={root} isMerge={isMerge} />
        ) : (
          <ContentFlow record={record} entry={entry} root={root} isMerge={isMerge} operation={mergeInfo.operation} />
        )}
      </div>
    </div>
  );
}

function Busy({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 px-4 py-8 text-[12.5px] text-fg-muted">
      <Loader2 size={14} className="animate-spin" />
      {text}
    </div>
  );
}

function Failure({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2 border-b border-danger/40 bg-danger/10 px-4 py-2 text-[12px] leading-snug text-danger">
      <AlertTriangle size={13} className="mt-0.5 shrink-0" />
      <span className="whitespace-pre-line">{text}</span>
    </div>
  );
}

/** Accepted → close + refresh already happened via apply; show nothing
 *  else (the workspace closes itself on success). */
function useApply(path: string, fn: (root: string, path: string) => Promise<void>) {
  const closeResolution = useUIStore((s) => s.closeResolution);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (root: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn(root, path);
      closeResolution();
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

function ReviewRequest({ record }: { record: ResolutionRecord }) {
  const markReviewRequested = useConflictResolutionStore((s) => s.markReviewRequested);
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        void writeClipboardText(buildReviewPacket(record)).then(() => {
          markReviewRequested(record.path);
          setCopied(true);
        });
      }}
      title="Copy the full context (story, verified facts, proposal) and hand this decision to a teammate"
      className="flex items-center gap-1 rounded border border-border bg-panel px-2 py-1 text-[11.5px] text-fg hover:bg-hover"
    >
      {copied || record.status === "review-requested" ? <Check size={12} className="text-green" /> : <UserCheck size={12} />}
      {copied || record.status === "review-requested" ? "Review packet copied" : "Request review"}
    </button>
  );
}

// ── modify-delete ───────────────────────────────────────────────────────

function ModifyDeleteFlow({ record, root, isMerge }: { record: ResolutionRecord; root: string | null; isMerge: boolean }) {
  const entry = useGitStore((s) => s.conflicts.find((c) => c.path === record.path));
  // The side holding a stage blob still has the file; the other deleted it.
  const currentHasFile = Boolean(entry?.ours);
  const modified = useApply(record.path, (r, p) => acceptSide(r, p, currentHasFile ? "ours" : "theirs"));
  const deleted = useApply(record.path, acceptDeletion);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const who = currentHasFile
    ? { modified: "The current branch", deleted: "The incoming work" }
    : { modified: "The incoming work", deleted: "The current branch" };

  return (
    <div className="flex flex-col gap-3 overflow-y-auto px-4 py-3">
      <div className="text-[12.5px] leading-relaxed text-fg">
        <p>
          One side edited this file while the other side deleted it — git cannot decide for you.
        </p>
        <ul className="mt-2 flex flex-col gap-1 text-[12px] text-fg-muted">
          <li>• {who.modified} modified <span className="text-fg">{record.path}</span></li>
          <li>• {who.deleted} deleted it</li>
        </ul>
      </div>
      {modified.error && <Failure text={modified.error} />}
      {deleted.error && <Failure text={deleted.error} />}
      <div className="flex items-center gap-2 border-t border-border pt-3">
        {isMerge ? (
          <>
            <button
              disabled={modified.busy || deleted.busy || !root}
              onClick={() => root && void modified.run(root)}
              className="flex items-center gap-1 rounded bg-accent px-2.5 py-1 text-[11.5px] font-medium text-white hover:brightness-110 disabled:opacity-60"
            >
              {modified.busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
              Keep modified
            </button>
            <button
              disabled={modified.busy || deleted.busy || !root}
              onClick={() => setConfirmDelete(true)}
              className="flex items-center gap-1 rounded bg-danger px-2.5 py-1 text-[11.5px] font-medium text-white hover:brightness-110 disabled:opacity-60"
            >
              {deleted.busy ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />}
              Keep deleted
            </button>
          </>
        ) : null}
        <span className="ml-auto">
          <ReviewRequest record={record} />
        </span>
      </div>
      {confirmDelete && (
        <ConfirmDialog
          title="Keep the File Deleted"
          message={`The deletion will be staged and ${record.path} removed from your working tree. The modified content will be lost.`}
          confirmLabel="Keep deleted"
          danger
          onConfirm={() => {
            setConfirmDelete(false);
            if (root) void deleted.run(root);
          }}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </div>
  );
}

// ── binary ──────────────────────────────────────────────────────────────

function BinaryFlow({ record, root, isMerge }: { record: ResolutionRecord; root: string | null; isMerge: boolean }) {
  const keepCurrent = useApply(record.path, (r, p) => acceptSide(r, p, "ours"));
  const keepIncoming = useApply(record.path, (r, p) => acceptSide(r, p, "theirs"));
  const keep = { busy: keepCurrent.busy || keepIncoming.busy, error: keepCurrent.error ?? keepIncoming.error };
  return (
    <div className="flex flex-col gap-3 overflow-y-auto px-4 py-3">
      <p className="text-[12.5px] leading-relaxed text-fg">
        Both sides changed this binary file. Zense cannot merge binary content — pick which version
        stays.
      </p>
      {keep.error && <Failure text={keep.error} />}
      <div className="flex items-center gap-2 border-t border-border pt-3">
        {isMerge ? (
          <>
            <button
              disabled={keep.busy || !root}
              onClick={() => root && void keepCurrent.run(root)}
              className="flex items-center gap-1 rounded bg-accent px-2.5 py-1 text-[11.5px] font-medium text-white hover:brightness-110 disabled:opacity-60"
            >
              {keepCurrent.busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
              Keep current
            </button>
            <button
              disabled={keep.busy || !root}
              onClick={() => root && void keepIncoming.run(root)}
              className="flex items-center gap-1 rounded bg-accent px-2.5 py-1 text-[11.5px] font-medium text-white hover:brightness-110 disabled:opacity-60"
            >
              {keepIncoming.busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
              Keep incoming
            </button>
          </>
        ) : null}
        <span className="ml-auto">
          <ReviewRequest record={record} />
        </span>
      </div>
    </div>
  );
}

// ── content: the story-first workspace ──────────────────────────────────

function ContentFlow({
  record,
  entry,
  root,
  isMerge,
  operation,
}: {
  record: ResolutionRecord;
  entry: { path: string };
  root: string | null;
  isMerge: boolean;
  operation?: string;
}) {
  void operation;
  const setDraft = useConflictResolutionStore((s) => s.setDraft);
  const accept = useApply(record.path, acceptResolution);
  const [askOpen, setAskOpen] = useState(false);
  const [rawOpen, setRawOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
  const [rawSides, setRawSides] = useState<{ ours: string; theirs: string } | null>(null);

  // Third tier (opt-in): the raw two sides, jargon-free labels.
  useEffect(() => {
    if (!rawOpen || rawSides || !root) return;
    void (async () => {
      try {
        const [ours, theirs] = await Promise.all([
          gitReadConflictFile(root, entry.path, "ours"),
          gitReadConflictFile(root, entry.path, "theirs"),
        ]);
        setRawSides({ ours, theirs });
      } catch {
        setRawSides({ ours: "(unavailable)", theirs: "(unavailable)" });
      }
    })();
  }, [rawOpen, rawSides, root, entry.path]);

  if (record.status === "analyzing" || record.status === "detected") {
    return <Busy text="Zense is analyzing what each change was trying to accomplish…" />;
  }

  const content = effectiveContent(record);
  const edited = record.editDraft !== null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
      {record.status === "error" && (
        <div className="flex flex-col gap-2">
          <Failure text={record.error ?? "Analysis failed"} />
          {root && (
            <button
              onClick={() => void analyzeConflict(root, record.path)}
              className="self-start rounded border border-border bg-panel px-2 py-1 text-[11.5px] text-fg hover:bg-hover"
            >
              Retry analysis
            </button>
          )}
        </div>
      )}

      {record.story && (
        <section className="rounded border border-border bg-base p-2.5">
          <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-fg-muted">
            AI interpretation — what each side was trying to do
          </div>
          <p className="whitespace-pre-line text-[12px] leading-relaxed text-fg">{record.story}</p>
          {record.reasoningPoints && record.reasoningPoints.length > 0 && (
            <ul className="mt-1.5 flex flex-col gap-0.5 text-[11.5px] text-fg-muted">
              {record.reasoningPoints.map((p, i) => (
                <li key={i}>• {p}</li>
              ))}
            </ul>
          )}
          {record.confidence && (
            <div className="mt-1.5 text-[10.5px] uppercase tracking-wide text-fg-muted">
              AI confidence: {record.confidence}
              {record.trivial ? " · trivial (mechanical)" : ""}
            </div>
          )}
        </section>
      )}

      {record.evidence.length > 0 && (
        <section className="rounded border border-border bg-base p-2.5">
          <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-fg-muted">
            Verified — tool-generated facts
          </div>
          <ul className="flex flex-col gap-0.5 text-[12px]">
            {record.evidence.map((f, i) => (
              <li key={i} title={f.detail} className="flex items-center gap-1.5">
                {f.ok ? (
                  <Check size={12} className="shrink-0 text-green" />
                ) : (
                  <AlertTriangle size={12} className="shrink-0 text-yellow" />
                )}
                <span className={f.ok ? "text-fg" : "text-fg-muted"}>{f.label}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {content !== undefined && (
        <section className="flex flex-col gap-1">
          <div className="flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-wide text-fg-muted">
            Proposed resolution
            {edited && (
              <span className="rounded border border-accent/40 px-1 text-[9.5px] normal-case text-accent">
                edited by you
              </span>
            )}
          </div>
          <div className="h-64 overflow-hidden rounded border border-border">
            <CodeEditor
              language={detectLanguage(record.path)}
              value={content}
              path={record.path}
              onChange={(v) => setDraft(record.path, v === record.proposal ? null : v)}
            />
          </div>
        </section>
      )}

      {record.qa.length > 0 && (
        <section className="flex flex-col gap-1.5">
          {record.qa.map((x, i) => (
            <div key={i} className="rounded border border-border bg-base p-2 text-[12px] leading-relaxed">
              <div className="font-medium text-fg">Q: {x.question}</div>
              <div className="mt-0.5 whitespace-pre-line text-fg-muted">{x.answer}</div>
            </div>
          ))}
        </section>
      )}
      {askError && <Failure text={askError} />}

      {askOpen && (
        <div className="flex items-center gap-1.5">
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && question.trim() && root && !asking) {
                setAsking(true);
                setAskError(null);
                const q = question.trim();
                setQuestion("");
                void askConflictQuestion(root, record, q)
                  .catch((err) => setAskError(errMessage(err)))
                  .finally(() => setAsking(false));
              }
            }}
            placeholder="Ask Zense about this conflict… (read-only — it explains, never edits)"
            className="min-w-0 flex-1 rounded border border-border bg-base px-2 py-1 text-[12px] text-fg outline-none placeholder:text-fg-muted"
          />
          <span className="shrink-0 text-fg-muted">
            {asking ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
          </span>
        </div>
      )}

      {rawOpen && (
        <section className="flex flex-col gap-1">
          <div className="text-[10.5px] font-semibold uppercase tracking-wide text-fg-muted">
            Original versions (advanced)
          </div>
          <div className="grid grid-cols-2 gap-2">
            {(["ours", "theirs"] as const).map((side) => (
              <div key={side} className="min-w-0">
                <div className="mb-0.5 text-[10.5px] text-fg-muted">
                  {side === "ours" ? "Current branch" : "Incoming work"}
                </div>
                <pre className="max-h-44 overflow-auto rounded border border-border bg-base p-2 text-[10.5px] leading-snug text-fg-muted">
                  {rawSides ? rawSides[side] : "Loading…"}
                </pre>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="flex items-center gap-2 border-t border-border pt-3 pb-0.5">
        {isMerge && content !== undefined && (
          <button
            disabled={accept.busy || !root}
            onClick={() => root && void accept.run(root)}
            className="flex items-center gap-1 rounded bg-accent px-2.5 py-1 text-[11.5px] font-medium text-white hover:brightness-110 disabled:opacity-60"
          >
            {accept.busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
            Accept resolution
          </button>
        )}
        <button
          onClick={() => setAskOpen((v) => !v)}
          className="flex items-center gap-1 rounded border border-border bg-panel px-2 py-1 text-[11.5px] text-fg hover:bg-hover"
        >
          <MessageCircleQuestion size={12} />
          Ask Zense
        </button>
        <ReviewRequest record={record} />
        <button
          onClick={() => setRawOpen((v) => !v)}
          title="Show the two original versions side by side"
          className="ml-auto flex items-center gap-1 rounded border border-border bg-panel px-2 py-1 text-[11.5px] text-fg-muted hover:bg-hover hover:text-fg"
        >
          <Code2 size={12} />
          {rawOpen ? "Hide originals" : "Show originals"}
        </button>
      </div>
      {accept.error && <Failure text={accept.error} />}
    </div>
  );
}
