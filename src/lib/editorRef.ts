import type * as monaco from "monaco-editor";

/**
 * Holds the currently mounted Monaco editor instance so global shortcuts
 * and store actions can read its selection. Single-editor assumption is
 * fine for now; revisit when split editors land.
 */
let activeEditor: monaco.editor.IStandaloneCodeEditor | null = null;

export function setActiveEditor(editor: monaco.editor.IStandaloneCodeEditor | null) {
  activeEditor = editor;
}

export function getActiveEditor() {
  return activeEditor;
}
