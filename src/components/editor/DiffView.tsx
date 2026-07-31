import { useRef, useState } from "react";
import { DiffEditor } from "@monaco-editor/react";
import type * as monaco from "monaco-editor";
import {
  ChevronUp,
  ChevronDown,
  Columns2,
  Rows2,
  Sparkles,
} from "lucide-react";
import { useUIStore } from "../../store/uiStore";
import { mockFiles, extraWorkingFiles, headFiles, diffStats } from "../../lib/mockData";
import { defineTheme } from "./monacoSetup";

export function DiffView({ path }: { path: string }) {
  const { diffMode, toggleDiffMode } = useUIStore();

  const working = mockFiles[path] ?? extraWorkingFiles[path];
  const language = working?.language ?? "plaintext";
  const modified = working?.content ?? "";
  const original = headFiles[path] ?? "";
  const stats = diffStats[path] ?? { adds: 0, dels: 0 };

  const diffRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  const [changes, setChanges] = useState<readonly monaco.editor.ILineChange[]>([]);
  const [changeIdx, setChangeIdx] = useState(0);

  const jump = (dir: 1 | -1) => {
    if (changes.length === 0) return;
    const next = (changeIdx + dir + changes.length) % changes.length;
    setChangeIdx(next);
    const change = changes[next];
    const line = change.modifiedStartLineNumber || change.originalStartLineNumber;
    diffRef.current?.getModifiedEditor().revealLineInCenter(line);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Diff toolbar */}
      <div className="flex h-8 shrink-0 items-center gap-3 border-b border-line bg-panel px-3 text-[11.5px]">
        <span className="flex items-center gap-1.5 text-fg-2">
          <span className="text-fg-3">HEAD</span>
          <span className="text-fg-3">⟷</span>
          <span className="text-fg">Working Tree</span>
        </span>

        <span className="font-mono">
          <span className="text-green">+{stats.adds}</span>{" "}
          <span className="text-red">−{stats.dels}</span>
        </span>

        <div className="flex items-center gap-0.5 text-fg-3">
          <button
            title="Previous change"
            onClick={() => jump(-1)}
            className="rounded p-1 hover:bg-hover hover:text-fg-2 disabled:opacity-30"
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
            className="rounded p-1 hover:bg-hover hover:text-fg-2 disabled:opacity-30"
            disabled={changes.length === 0}
          >
            <ChevronDown size={13} />
          </button>
        </div>

        <div className="flex-1" />

        <button
          onClick={toggleDiffMode}
          title={diffMode === "split" ? "Switch to inline view" : "Switch to side-by-side view"}
          className="flex items-center gap-1.5 rounded px-2 py-1 text-fg-2 hover:bg-hover"
        >
          {diffMode === "split" ? <Columns2 size={13} /> : <Rows2 size={13} />}
          {diffMode === "split" ? "Side-by-side" : "Inline"}
        </button>

        <button
          title="Summarize this diff with AI"
          className="flex items-center gap-1.5 rounded border border-accent/30 bg-accent/10 px-2 py-1 text-accent-2 hover:bg-accent/20"
        >
          <Sparkles size={12} />
          AI Summary
        </button>
      </div>

      {/* Diff editor */}
      <div className="min-h-0 flex-1">
        <DiffEditor
          language={language}
          original={original}
          modified={modified}
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
      </div>
    </div>
  );
}
