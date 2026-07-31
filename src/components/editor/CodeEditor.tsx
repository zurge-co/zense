import Editor from "@monaco-editor/react";
import { defineTheme } from "./monacoSetup";
import { setActiveEditor } from "../../lib/editorRef";
import { useUIStore } from "../../store/uiStore";

export function CodeEditor({ language, value }: { language: string; value: string }) {
  return (
    <Editor
      language={language}
      value={value}
      theme="zense-dark"
      beforeMount={defineTheme}
      onMount={(editor, monacoInstance) => {
        setActiveEditor(editor);
        editor.addAction({
          id: "zense.addSelectionToAgent",
          label: "Add Selection to Agent",
          keybindings: [monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyL],
          contextMenuGroupId: "zense",
          contextMenuOrder: 1,
          run: () => useUIStore.getState().addSelectionChip(),
        });
      }}
      options={{
        readOnly: true,
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
