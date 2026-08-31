import { useEffect, useRef } from "react";
import Editor from "@monaco-editor/react";
import { defineTheme } from "./monacoSetup";
import { setupKeybindings } from "./monacoKeybindings";
import { writeClipboardText } from "../../lib/clipboard";
import { setActiveEditor } from "../../lib/editorRef";
import { formatReference, selectionLines } from "../../lib/reference";
import { useUIStore } from "../../store/uiStore";
import { useWorkspaceStore } from "../../store/workspaceStore";

/** Editor indent width (mirrored in the StatusBar). */
export const TAB_SIZE = 2;

export function CodeEditor({
  language,
  value,
  readOnly = false,
  onChange,
  path,
}: {
  language: string;
  value: string;
  readOnly?: boolean;
  onChange?: (value: string) => void;
  /** Workspace-relative path of the open file (undefined for untitled buffers). */
  path?: string;
}) {
  // The editor instance is shared across tab switches, so the Copy Reference
  // action must resolve the current path at run time — never from the mount
  // closure, which would go stale the first time a different file opens.
  const pathRef = useRef(path);
  useEffect(() => {
    pathRef.current = path;
  }, [path]);
  // Live from Settings > Appearance (workspaceStore is persisted) so the
  // editor re-renders with the new size the moment the user changes it.
  const fontSize = useWorkspaceStore((s) => s.editorFontSize);
  return (
    <Editor
      language={language}
      value={value}
      theme="zense-dark"
      beforeMount={defineTheme}
      onMount={(editor, monaco) => {
        setActiveEditor(editor);
        setupKeybindings(editor, monaco);
        // Context menu: "Copy Reference" copies `path:line` (or
        // `path:start-end` for multi-line selections) for AI chat pasting.
        editor.addAction({
          id: "zense.copyReference",
          label: "Copy Reference",
          contextMenuGroupId: "zense",
          contextMenuOrder: 0,
          run: (ed) => {
            const p = pathRef.current;
            const sel = ed.getSelection();
            if (!p || !sel) return;
            const { start, end } = selectionLines(sel);
            void writeClipboardText(formatReference(p, start, end));
          },
        });
        // Live cursor position for the StatusBar.
        const seed = editor.getPosition();
        if (seed) {
          useUIStore.getState().setCursorPos({ line: seed.lineNumber, col: seed.column });
        }
        const sub = editor.onDidChangeCursorPosition((e) => {
          useUIStore.getState().setCursorPos({ line: e.position.lineNumber, col: e.position.column });
        });
        editor.onDidDispose(() => sub.dispose());
      }}
      onChange={(value) => {
        if (onChange && value !== undefined) onChange(value);
      }}
      options={{
        readOnly,
        fontSize,
        fontFamily: "ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, monospace",
        minimap: { enabled: false },
        lineNumbersMinChars: 3,
        scrollBeyondLastLine: false,
        renderLineHighlight: "all",
        padding: { top: 8 },
        smoothScrolling: true,
        cursorBlinking: "blink",
        cursorSmoothCaretAnimation: "on",
        contextmenu: true,
        folding: true,
        glyphMargin: false,
        lineDecorationsWidth: 8,
        overviewRulerLanes: 0,
        hideCursorInOverviewRuler: true,
        scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
        automaticLayout: true,
        formatOnPaste: true,
        formatOnType: true,
        tabSize: TAB_SIZE,
        bracketPairColorization: { enabled: true },
        guides: { bracketPairs: true, indentation: true },
      }}
    />
  );
}
