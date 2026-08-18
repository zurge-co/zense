import Editor from "@monaco-editor/react";
import { defineTheme } from "./monacoSetup";
import { setActiveEditor } from "../../lib/editorRef";

export function CodeEditor({
  language,
  value,
  readOnly = false,
  onChange,
}: {
  language: string;
  value: string;
  readOnly?: boolean;
  onChange?: (value: string) => void;
}) {
  return (
    <Editor
      language={language}
      value={value}
      theme="zense-dark"
      beforeMount={defineTheme}
      onMount={(editor) => {
        setActiveEditor(editor);
      }}
      onChange={(value) => {
        if (onChange && value !== undefined) onChange(value);
      }}
      options={{
        readOnly,
        fontSize: 12.5,
        fontFamily: "ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, monospace",
        minimap: { enabled: false },
        lineNumbersMinChars: 3,
        scrollBeyondLastLine: false,
        renderLineHighlight: "all",
        padding: { top: 8 },
        smoothScrolling: true,
        cursorBlinking: "solid",
        contextmenu: true,
        folding: false,
        glyphMargin: false,
        lineDecorationsWidth: 8,
        overviewRulerLanes: 0,
        hideCursorInOverviewRuler: true,
        scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
      }}
    />
  );
}
