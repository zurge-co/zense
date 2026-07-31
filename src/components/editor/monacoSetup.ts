import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
// NOTE: monaco-editor's package "exports" maps "./*" -> "./esm/vs/*.js",
// so deep worker paths must be imported without the "esm/vs" prefix.
import editorWorker from "monaco-editor/editor/editor.worker?worker";
import tsWorker from "monaco-editor/language/typescript/ts.worker?worker";

// Bundle Monaco locally (no CDN) so it works offline inside Tauri.
self.MonacoEnvironment = {
  getWorker(_: unknown, label: string) {
    if (label === "typescript" || label === "javascript") return new tsWorker();
    return new editorWorker();
  },
};
loader.config({ monaco });

export const defineTheme = (m: typeof monaco) => {
  m.editor.defineTheme("zense-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "keyword", foreground: "bc8cff" },
      { token: "string", foreground: "9ece6a" },
      { token: "number", foreground: "d29922" },
      { token: "comment", foreground: "5d6b82" },
      { token: "type", foreground: "79b8ff" },
      { token: "identifier", foreground: "d7e0ee" },
    ],
    colors: {
      "editor.background": "#0d1117",
      "editor.foreground": "#d7e0ee",
      "editor.lineHighlightBackground": "#161c27",
      "editorLineNumber.foreground": "#3d4a61",
      "editorLineNumber.activeForeground": "#93a1b8",
      "editorIndentGuide.background1": "#1c2432",
      "editor.selectionBackground": "#232d3f",
      "editorCursor.foreground": "#4f8cff",
      "editorWidget.background": "#11161f",
      "editorWidget.border": "#212a3a",
      "diffEditor.insertedTextBackground": "#3fb95022",
      "diffEditor.removedTextBackground": "#f8514922",
      "diffEditor.insertedLineBackground": "#3fb95014",
      "diffEditor.removedLineBackground": "#f8514914",
      "diffEditorGutter.insertedLineBackground": "#3fb95033",
      "diffEditorGutter.removedLineBackground": "#f8514933",
      "diffEditorOverview.insertedForeground": "#3fb95099",
      "diffEditorOverview.removedForeground": "#f8514999",
    },
  });
};
