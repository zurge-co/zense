import type * as monaco from "monaco-editor";
import { KeyCode, KeyMod } from "monaco-editor";
import { readClipboardText, writeClipboardText } from "../../lib/clipboard";

type IStandaloneCodeEditor = monaco.editor.IStandaloneCodeEditor;

/**
 * On macOS, Monaco binds copy/cut/paste to Cmd by default. The Tauri
 * WKWebView also blocks `navigator.clipboard` read/write, so we must route
 * clipboard through the Tauri plugin. This file:
 *
 *  1. Registers custom clipboard commands that use the Tauri clipboard API
 *     and binds them to BOTH Ctrl and Cmd on macOS (Ctrl-only on other OS).
 *  2. Adds Ctrl-based keybindings that mirror VSCode defaults so Ctrl works
 *     as a modifier on macOS alongside Cmd.
 */
export function setupKeybindings(
  editor: IStandaloneCodeEditor,
  _monacoNS: typeof monaco,
): void {
  const KM = KeyMod;
  const KC = KeyCode;

  // ── 1. Custom clipboard commands (Tauri-aware) ────────────────────────

  // Copy: selection or whole line(s) when nothing is selected (like VSCode).
  editor.addAction({
    id: "zense.clipboardCopy",
    label: "Copy",
    keybindings: [KM.CtrlCmd | KC.KeyC],
    run: async (ed) => {
      const model = ed.getModel();
      if (!model) return;
      const selections = ed.getSelections();
      if (!selections || selections.length === 0) return;
      const hasEmpty = selections.some((s) => s.isEmpty());
      if (hasEmpty) {
        const lines = selections.map((s) => model.getValueInRange({
          startLineNumber: s.startLineNumber,
          startColumn: 1,
          endLineNumber: s.startLineNumber + 1,
          endColumn: 1,
        }));
        await writeClipboardText(lines.join(""));
      } else {
        await writeClipboardText(
          selections.map((s) => model.getValueInRange(s)).join("\n"),
        );
      }
    },
  });

  // Cut: copy then delete selection (or whole line when empty).
  editor.addAction({
    id: "zense.clipboardCut",
    label: "Cut",
    keybindings: [KM.CtrlCmd | KC.KeyX],
    run: async (ed) => {
      const model = ed.getModel();
      if (!model) return;
      const selections = ed.getSelections();
      if (!selections || selections.length === 0) return;
      const hasEmpty = selections.some((s) => s.isEmpty());
      if (hasEmpty) {
        const lines = selections.map((s) => model.getValueInRange({
          startLineNumber: s.startLineNumber,
          startColumn: 1,
          endLineNumber: s.startLineNumber + 1,
          endColumn: 1,
        }));
        await writeClipboardText(lines.join(""));
        ed.executeEdits("zense.cut", selections.map((s) => ({
          range: {
            startLineNumber: s.startLineNumber,
            startColumn: 1,
            endLineNumber: s.startLineNumber + 1,
            endColumn: 1,
          },
          text: null,
        })));
      } else {
        await writeClipboardText(
          selections.map((s) => model.getValueInRange(s)).join("\n"),
        );
        ed.executeEdits("zense.cut", selections.map((s) => ({
          range: s,
          text: null,
        })));
      }
    },
  });

  // Paste: insert clipboard text; distribute multi-line content across cursors.
  editor.addAction({
    id: "zense.clipboardPaste",
    label: "Paste",
    keybindings: [KM.CtrlCmd | KC.KeyV],
    run: async (ed) => {
      const model = ed.getModel();
      if (!model) return;
      const selections = ed.getSelections();
      if (!selections || selections.length === 0) return;

      const text = await readClipboardText();
      if (!text) return;

      const lines = text.split("\n");

      // If there are multiple cursors and the clipboard has matching line
      // count, paste one line per cursor (VSCode multi-cursor paste).
      if (selections.length > 1 && lines.length === selections.length) {
        ed.executeEdits("zense.paste", selections.map((s, i) => ({
          range: s,
          text: lines[i],
        })));
      } else {
        ed.executeEdits("zense.paste", selections.map((s) => ({
          range: s,
          text,
        })));
      }
    },
  });

  // ── 2. Ctrl-based keybindings (macOS — use WinCtrl for physical Ctrl) ──

  // Helper: bind a monaco command to Ctrl+key on macOS.
  const ctrl = (kc: KeyCode) => KM.WinCtrl | kc;
  const ctrlShift = (kc: KeyCode) => KM.WinCtrl | KM.Shift | kc;
  const ctrlAlt = (kc: KeyCode) => KM.WinCtrl | KM.Alt | kc;

  // ── Selection & Multi-cursor ──────────────────────────────────────────
  editor.addCommand(ctrl(KC.KeyA), () =>
    editor.trigger("zense", "editor.action.selectAll", null));
  editor.addCommand(ctrl(KC.KeyD), () =>
    editor.trigger("zense", "editor.action.addSelectionToNextFindMatch", null));
  editor.addCommand(ctrlShift(KC.KeyL), () =>
    editor.trigger("zense", "editor.action.selectHighlights", null));
  editor.addCommand(ctrl(KC.KeyL), () =>
    editor.trigger("zense", "editor.action.selectLine", null));
  editor.addCommand(ctrl(KC.KeyU), () =>
    editor.trigger("zense", "editor.action.undoSelection", null));
  editor.addCommand(ctrlAlt(KC.UpArrow), () =>
    editor.trigger("zense", "editor.action.insertCursorAbove", null));
  editor.addCommand(ctrlAlt(KC.DownArrow), () =>
    editor.trigger("zense", "editor.action.insertCursorBelow", null));

  // ── Editing ───────────────────────────────────────────────────────────
  editor.addCommand(ctrl(KC.KeyZ), () =>
    editor.trigger("zense", "undo", null));
  editor.addCommand(ctrlShift(KC.KeyZ), () =>
    editor.trigger("zense", "redo", null));
  editor.addCommand(ctrl(KC.KeyY), () =>
    editor.trigger("zense", "redo", null));
  editor.addCommand(ctrlShift(KC.KeyK), () =>
    editor.trigger("zense", "editor.action.deleteLines", null));
  editor.addCommand(ctrl(KC.Enter), () =>
    editor.trigger("zense", "editor.action.insertLineAfter", null));
  editor.addCommand(ctrlShift(KC.Enter), () =>
    editor.trigger("zense", "editor.action.insertLineBefore", null));
  editor.addCommand(ctrl(KC.BracketRight), () =>
    editor.trigger("zense", "editor.action.indentLines", null));
  editor.addCommand(ctrl(KC.BracketLeft), () =>
    editor.trigger("zense", "editor.action.outdentLines", null));
  editor.addCommand(ctrl(KC.Slash), () =>
    editor.trigger("zense", "editor.action.commentLine", null));
  editor.addCommand(KM.Shift | KM.Alt | KC.KeyA, () =>
    editor.trigger("zense", "editor.action.blockComment", null));
  editor.addCommand(ctrl(KC.Backspace), () =>
    editor.trigger("zense", "editor.action.deleteWordLeft", null));
  editor.addCommand(ctrl(KC.Delete), () =>
    editor.trigger("zense", "editor.action.deleteWordRight", null));
  editor.addCommand(KM.Shift | KM.Alt | KC.KeyF, () =>
    editor.trigger("zense", "editor.action.formatDocument", null));

  // ── Search & Navigation ───────────────────────────────────────────────
  editor.addCommand(ctrl(KC.KeyF), () =>
    editor.trigger("zense", "actions.find", null));
  editor.addCommand(ctrl(KC.KeyH), () =>
    editor.trigger("zense", "editor.action.startFindReplaceAction", null));
  editor.addCommand(ctrl(KC.KeyG), () =>
    editor.trigger("zense", "editor.action.gotoLine", null));
  editor.addCommand(ctrlShift(KC.Backslash), () =>
    editor.trigger("zense", "editor.action.jumpToBracket", null));
  editor.addCommand(ctrlShift(KC.KeyO), () =>
    editor.trigger("zense", "editor.action.quickOutline", null));
  editor.addCommand(ctrl(KC.Home), () => {
    const model = editor.getModel();
    if (model) editor.setPosition({ lineNumber: 1, column: 1 });
  });
  editor.addCommand(ctrl(KC.End), () => {
    const model = editor.getModel();
    if (model) editor.setPosition({ lineNumber: model.getLineCount(), column: 1 });
  });

  // ── Line Operations ───────────────────────────────────────────────────
  editor.addCommand(KM.Alt | KC.UpArrow, () =>
    editor.trigger("zense", "editor.action.moveLinesUpAction", null));
  editor.addCommand(KM.Alt | KC.DownArrow, () =>
    editor.trigger("zense", "editor.action.moveLinesDownAction", null));
  editor.addCommand(KM.Shift | KM.Alt | KC.UpArrow, () =>
    editor.trigger("zense", "editor.action.copyLinesUpAction", null));
  editor.addCommand(KM.Shift | KM.Alt | KC.DownArrow, () =>
    editor.trigger("zense", "editor.action.copyLinesDownAction", null));

  // ── Folding (Ctrl+Shift+[ / ] and Ctrl+K chords) ──────────────────────
  editor.addCommand(ctrlShift(KC.BracketLeft), () =>
    editor.trigger("zense", "editor.fold", null));
  editor.addCommand(ctrlShift(KC.BracketRight), () =>
    editor.trigger("zense", "editor.unfold", null));

  // ── Chord shortcuts: Ctrl+K ... (and ⌘K ... on macOS) ─────────────────
  // Monaco's KeyMod.chord lets us register two-step sequences. We register
  // both Ctrl+K and Cmd+K as the first step so they work on every OS.
  const chord = (first: number, second: number) => KeyMod.chord(first, second);

  // Comment line  — Ctrl+K Ctrl+C / ⌘K ⌘C
  editor.addCommand(
    chord(KM.CtrlCmd | KC.KeyK, KM.CtrlCmd | KC.KeyC),
    () => editor.trigger("zense", "editor.action.addCommentLine", null),
  );
  // Uncomment line — Ctrl+K Ctrl+U / ⌘K ⌘U
  editor.addCommand(
    chord(KM.CtrlCmd | KC.KeyK, KM.CtrlCmd | KC.KeyU),
    () => editor.trigger("zense", "editor.action.removeCommentLine", null),
  );
  // Format selection — Ctrl+K Ctrl+F / ⌘K ⌘F
  editor.addCommand(
    chord(KM.CtrlCmd | KC.KeyK, KM.CtrlCmd | KC.KeyF),
    () => editor.trigger("zense", "editor.action.formatSelection", null),
  );
  // Fold all — Ctrl+K Ctrl+0 / ⌘K ⌘0
  editor.addCommand(
    chord(KM.CtrlCmd | KC.KeyK, KM.CtrlCmd | KC.Digit0),
    () => editor.trigger("zense", "editor.foldAll", null),
  );
  // Unfold all — Ctrl+K Ctrl+J / ⌘K ⌘J
  editor.addCommand(
    chord(KM.CtrlCmd | KC.KeyK, KM.CtrlCmd | KC.KeyJ),
    () => editor.trigger("zense", "editor.unfoldAll", null),
  );
}
