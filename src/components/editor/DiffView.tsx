import { useEffect, useRef, useState } from "react";
import { DiffEditor } from "@monaco-editor/react";
import type * as monaco from "monaco-editor";
import {
  ChevronUp,
  ChevronDown,
  Columns2,
  Rows2,
  Sparkles,
  RotateCcw,
  Loader2,
} from "lucide-react";
import { useUIStore, tabKey, type EditorTab } from "../../store/uiStore";
import { useGitStore } from "../../store/gitStore";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { gitDiffFile, gitDiffCommitFile, gitDiscardFile, gitDiscardLines } from "../../lib/git";
import { explainDiffChange, summarizeFileChange } from "../../lib/aiReview";
import { findChangeAtLine, extractChunk } from "../../lib/diffChunk";
import { detectLanguage } from "../../lib/lang";
import { defineTheme } from "./monacoSetup";
import { PathBreadcrumb } from "./PathBreadcrumb";
import { ConfirmDialog } from "../ConfirmDialog";

export function DiffView({ tab }: { tab: EditorTab }) {
  const editorFontSize = useWorkspaceStore((s) => s.editorFontSize);
  const { diffMode, toggleDiffMode, workspacePath } = useUIStore();
  const { status, diffSummary } = useGitStore();
  const path = tab.path;

  /** commitDiff tabs diff two commits; diff tabs diff the working tree. */
  const commitMode = tab.kind === "commitDiff";
  const fromSha = tab.fromSha ?? null;
  const toSha = tab.toSha ?? null;

  const entry = status.files.find((f) => f.path === path);
  const staged = entry?.unstaged ? false : true;
  const language = detectLanguage(path);

  const [changeIdx, setChangeIdx] = useState(0);
  const [confirmReset, setConfirmReset] = useState(false);
  /** Bumped after a reset so the diff reloads from disk. */
  const [reloadNonce, setReloadNonce] = useState(0);
  const [content, setContent] = useState<{
    original: string;
    modified: string;
    isBinary: boolean;
    isNonUtf8: boolean;
  } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [aiSummaryLoading, setAiSummaryLoading] = useState(false);

  /* The DiffEditor instance is shared across tabs / content loads, so the
     Monaco context actions must resolve their inputs via refs — a mount
     closure would go stale the first time a different file's diff loads. */
  const contentRef = useRef(content);
  useEffect(() => {
    contentRef.current = content;
  }, [content]);
  const metaRef = useRef({ path, staged, commitMode, root: workspacePath });
  useEffect(() => {
    metaRef.current = { path, staged, commitMode, root: workspacePath };
  });

  useEffect(() => {
    let cancelled = false;
    setContent(null);
    setLoadError(null);
    if (!workspacePath) {
      setContent({
        original: "// old version\n",
        modified: "// mock content\n",
        isBinary: false,
        isNonUtf8: false,
      });
      return;
    }
    const load = commitMode
      ? gitDiffCommitFile(workspacePath, path, fromSha, toSha!)
      : gitDiffFile(workspacePath, path, staged);
    load
      .then((d) => {
        if (cancelled) return;
        const nonUtf8 =
          !d.isBinary &&
          (d.original.includes("�") || d.modified.includes("�"));
        setContent({
          original: d.original,
          modified: d.modified,
          isBinary: d.isBinary,
          isNonUtf8: nonUtf8,
        });
      })
      .catch((err) => {
        if (!cancelled) setLoadError(String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [workspacePath, path, staged, commitMode, fromSha, toSha, reloadNonce]);

  const statsEntry = commitMode
    ? undefined
    : [...diffSummary.staged, ...diffSummary.unstaged].find(
        (e) => e.path === path
      );

  const short = (s?: string | null) => (s ? s.slice(0, 7) : "");

  const diffRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  const [changes, setChanges] = useState<readonly monaco.editor.ILineChange[]>(
    []
  );

  const jump = (dir: 1 | -1) => {
    if (changes.length === 0) return;
    const next = (changeIdx + dir + changes.length) % changes.length;
    setChangeIdx(next);
    const change = changes[next];
    const line = change.modifiedStartLineNumber || change.originalStartLineNumber;
    diffRef.current?.getModifiedEditor().revealLineInCenter(line);
  };

  const revertCurrentChange = async () => {
    const change = changes[changeIdx];
    if (!content || !change || !workspacePath) return;
    // Monaco encodes an empty range (pure insert/delete) with end = 0;
    // normalize to 1-based inclusive bounds with end = start - 1 for empty.
    const toRange = (start: number, end: number): { start: number; end: number } =>
      end === 0 || end < start ? { start: start + 1, end: start } : { start, end };
    const work = toRange(change.modifiedStartLineNumber, change.modifiedEndLineNumber);
    const orig = toRange(change.originalStartLineNumber, change.originalEndLineNumber);
    try {
      await gitDiscardLines(workspacePath, path, {
        startLine: work.start,
        endLine: work.end,
        originalStartLine: orig.start,
        originalEndLine: orig.end,
        workContent: content.modified,
        baseContent: content.original,
      });
      await useGitStore.getState().refresh(workspacePath);
      setReloadNonce((n) => n + 1);
    } catch (err) {
      setLoadError(String(err));
    }
  };

  const placeholderClass =
    "flex h-full items-center justify-center text-fg-muted text-[12.5px]";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* File path breadcrumb — files opened from Review land here as diff
          tabs, and must show their path like editor file tabs do */}
      <PathBreadcrumb path={path} />
      {/* Diff toolbar */}
      <div className="flex h-8 shrink-0 items-center gap-3 border-b border-border bg-panel px-3 text-[11.5px]">
        <span className="flex items-center gap-1.5 text-fg-muted">
          {commitMode ? (
            <>
              <span className="font-mono text-fg">{fromSha ? short(fromSha) : `${short(toSha)}^`}</span>
              <span className="text-fg-muted">⟷</span>
              <span className="font-mono text-fg">{short(toSha)}</span>
            </>
          ) : (
            <>
              <span className="text-fg-muted">HEAD</span>
              <span className="text-fg-muted">⟷</span>
              <span className="text-fg">Working Tree</span>
            </>
          )}
        </span>

        {statsEntry && (
          <span className="font-mono">
            <span className="text-green">+{statsEntry.additions}</span>{" "}
            <span className="text-danger">−{statsEntry.deletions}</span>
          </span>
        )}

        <div className="flex items-center gap-0.5 text-fg-muted">
          <button
            title="Previous change"
            onClick={() => jump(-1)}
            className="rounded p-1 hover:bg-hover hover:text-fg disabled:opacity-30"
            disabled={changes.length === 0}
          >
            <ChevronUp size={13} />
          </button>
          <span className="min-w-10 text-center font-mono text-[10.5px]">
            {changes.length === 0 ? "0/0" : `${changeIdx + 1}/${changes.length}`}
          </span>
          <button
            title="Next change"
            onClick={() => jump(1)}
            className="rounded p-1 hover:bg-hover hover:text-fg disabled:opacity-30"
            disabled={changes.length === 0}
          >
            <ChevronDown size={13} />
          </button>
        </div>

        {!commitMode && !staged && (
          <button
            title="Revert this change — restore these lines from the staged/HEAD version"
            onClick={() => void revertCurrentChange()}
            disabled={changes.length === 0}
            className="flex items-center gap-1.5 rounded px-2 py-1 text-fg-muted hover:bg-hover hover:text-fg disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <RotateCcw size={13} />
            Revert change
          </button>
        )}

        <div className="flex-1" />

        <button
          onClick={toggleDiffMode}
          title={diffMode === "split" ? "Switch to inline view" : "Switch to side-by-side view"}
          className="flex items-center gap-1.5 rounded px-2 py-1 text-fg-muted hover:bg-hover"
        >
          {diffMode === "split" ? <Columns2 size={13} /> : <Rows2 size={13} />}
          {diffMode === "split" ? "Side-by-side" : "Inline"}
        </button>

        {!commitMode && (
          <>
            <button
              title="Reset file — discard all changes and restore it to HEAD"
              onClick={() => setConfirmReset(true)}
              className="flex items-center gap-1.5 rounded px-2 py-1 text-fg-muted hover:bg-hover hover:text-fg"
            >
              <RotateCcw size={13} />
              Reset File
            </button>
            <button
              title="Summarize this diff with AI"
              disabled={aiSummaryLoading}
              onClick={async () => {
                if (!workspacePath || aiSummaryLoading) return;
                setAiSummaryLoading(true);
                try {
                  await summarizeFileChange(workspacePath, path, staged);
                } catch (err) {
                  setLoadError(String(err));
                } finally {
                  setAiSummaryLoading(false);
                }
              }}
              className="flex items-center gap-1.5 rounded border border-accent/30 bg-accent/10 px-2 py-1 text-accent hover:bg-accent/20 disabled:opacity-50"
            >
              {aiSummaryLoading ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Sparkles size={12} />
              )}
              AI Summary
            </button>
          </>
        )}
      </div>

      {/* Diff editor */}
      <div className="min-h-0 flex-1">
        {loadError ? (
          <div className={placeholderClass}>
            Failed to load diff: {loadError}
          </div>
        ) : content === null ? (
          <div className={placeholderClass}>Loading diff…</div>
        ) : content.isBinary ? (
          <div className={placeholderClass}>
            Binary file — no text diff available
          </div>
        ) : content.isNonUtf8 ? (
          <div className={placeholderClass}>This file is not UTF-8 text</div>
        ) : (
          <DiffEditor
            language={language}
            original={content.original}
            modified={content.modified}
            theme="zense-dark"
            beforeMount={defineTheme}
            onMount={(editor) => {
              diffRef.current = editor;
              setChangeIdx(0);
              const update = () => setChanges(editor.getLineChanges() ?? []);
              editor.onDidUpdateDiff(update);
              update();
              const modifiedEditor = editor.getModifiedEditor();
              // Right-click a changed chunk → AI explains what it does, why,
              // what it relates to, how to verify, and its risks.
              modifiedEditor.addAction({
                id: "zense.explainChange",
                label: "Explain this change with AI",
                contextMenuGroupId: "zense",
                contextMenuOrder: 0,
                run: (ed) => {
                  const pos = ed.getPosition();
                  const c = contentRef.current;
                  const meta = metaRef.current;
                  if (!pos || !c || !meta.root) return;
                  const change = findChangeAtLine(
                    diffRef.current?.getLineChanges() ?? [],
                    pos.lineNumber,
                  );
                  if (!change) return;
                  const chunk = extractChunk(change, c.original, c.modified);
                  void explainDiffChange({
                    root: meta.root,
                    path: meta.path,
                    startLine: chunk.startLine,
                    endLine: chunk.endLine,
                    removed: chunk.removed,
                    added: chunk.added,
                  });
                },
              });
              modifiedEditor.addAction({
                id: "zense.summarizeDiff",
                label: "Summarize this file's diff with AI",
                contextMenuGroupId: "zense",
                contextMenuOrder: 1,
                run: () => {
                  const meta = metaRef.current;
                  // Commit-to-commit diffs have no working-tree patch to send.
                  if (!meta.root || meta.commitMode) return;
                  void summarizeFileChange(meta.root, meta.path, meta.staged);
                },
              });
            }}
            options={{
              readOnly: true,
              renderSideBySide: diffMode === "split",
              fontSize: editorFontSize,
              fontFamily: "ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, monospace",
              minimap: { enabled: false },
              lineNumbersMinChars: 3,
              scrollBeyondLastLine: false,
              padding: { top: 8 },
              contextmenu: true,
              folding: false,
              glyphMargin: false,
              lineDecorationsWidth: 8,
              scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
              renderOverviewRuler: true,
            }}
          />
        )}
      </div>

      {confirmReset && (
        <ConfirmDialog
          title="Reset File"
          message={`Discard all changes to "${path}" and restore it to the last commit (HEAD)? This cannot be undone.`}
          confirmLabel="Reset File"
          danger
          onConfirm={async () => {
            setConfirmReset(false);
            if (!workspacePath) return;
            try {
              await gitDiscardFile(workspacePath, path);
              await useGitStore.getState().refresh(workspacePath);
              // The file is gone (untracked/new, now deleted) — the diff
              // tab has nothing left to show; close it.
              const stillThere = useGitStore
                .getState()
                .status.files.some((f) => f.path === path);
              if (!stillThere) {
                useUIStore.getState().closeTab(tabKey(tab));
              } else {
                setReloadNonce((n) => n + 1);
              }
            } catch (err) {
              setLoadError(String(err));
            }
          }}
          onCancel={() => setConfirmReset(false)}
        />
      )}
    </div>
  );
}
