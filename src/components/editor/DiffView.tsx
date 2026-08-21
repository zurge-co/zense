import { useEffect, useRef, useState } from "react";
import { DiffEditor } from "@monaco-editor/react";
import type * as monaco from "monaco-editor";
import {
  ChevronUp,
  ChevronDown,
  Columns2,
  Rows2,
  Sparkles,
} from "lucide-react";
import { useUIStore, type EditorTab } from "../../store/uiStore";
import { useGitStore } from "../../store/gitStore";
import { gitDiffFile, gitDiffCommitFile } from "../../lib/git";
import { detectLanguage } from "../../lib/lang";
import { defineTheme } from "./monacoSetup";

export function DiffView({ tab }: { tab: EditorTab }) {
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

  const [content, setContent] = useState<{
    original: string;
    modified: string;
    isBinary: boolean;
    isNonUtf8: boolean;
  } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

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
  }, [workspacePath, path, staged, commitMode, fromSha, toSha]);

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
  const [changeIdx, setChangeIdx] = useState(0);

  const jump = (dir: 1 | -1) => {
    if (changes.length === 0) return;
    const next = (changeIdx + dir + changes.length) % changes.length;
    setChangeIdx(next);
    const change = changes[next];
    const line = change.modifiedStartLineNumber || change.originalStartLineNumber;
    diffRef.current?.getModifiedEditor().revealLineInCenter(line);
  };

  const placeholderClass =
    "flex h-full items-center justify-center text-fg-muted text-[12.5px]";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
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
          <button
            title="Summarize this diff with AI"
            className="flex items-center gap-1.5 rounded border border-accent/30 bg-accent/10 px-2 py-1 text-accent hover:bg-accent/20"
          >
            <Sparkles size={12} />
            AI Summary
          </button>
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
            }}
            options={{
              readOnly: true,
              renderSideBySide: diffMode === "split",
              fontSize: 12.5,
              fontFamily: "ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, monospace",
              minimap: { enabled: false },
              lineNumbersMinChars: 3,
              scrollBeyondLastLine: false,
              padding: { top: 8 },
              contextmenu: false,
              folding: false,
              glyphMargin: false,
              lineDecorationsWidth: 8,
              scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
              renderOverviewRuler: true,
            }}
          />
        )}
      </div>
    </div>
  );
}
