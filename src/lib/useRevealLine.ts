import { useEffect } from "react";
import type * as monaco from "monaco-editor";
import { useUIStore } from "../store/uiStore";

/** Give up waiting for the target editor/model after this long (ms),
 *  counted from request creation — never from effect time (see hook docs). */
export const REVEAL_LINE_DEADLINE_MS = 3000;

export type RevealAction = (
  editor: monaco.editor.IStandaloneCodeEditor,
  line: number,
) => void;

/**
 * Consume a pending go-to-line request aimed at `path` (set by
 * openFile/openDiff with a line — AI Review finding refs).
 *
 * This hook only owns the machinery — matching the request, polling for a
 * ready model, expiry, consumption; the actual jump is the caller's
 * `reveal` callback, because each Monaco host reveals slightly differently
 * (code editor vs. the diff's MODIFIED side).
 *
 * `getEditorIfReady` must return the Monaco editor ONLY once its model
 * already shows the content the line refers to: freshly opened files load
 * async and a premature reveal would clamp against the still-stale model
 * (or scroll a short file to its end instead of the target). Polls briefly
 * like SearchPanel's openMatch. Requests that never become revealable
 * expire at the deadline so a path reopened later is not ambushed by a
 * stale jump.
 */
export function useRevealLineRequest(
  path: string | undefined,
  getEditorIfReady: () => monaco.editor.IStandaloneCodeEditor | null,
  reveal: RevealAction,
) {
  const request = useUIStore((s) => s.revealLineRequest);
  useEffect(() => {
    if (!request || request.path !== path) return;
    const { line, nonce } = request;
    // The deadline is stamped on CREATION, not effect time: a component
    // that (re)mounts much later must not ambush the user with a stale
    // jump — it simply discards the expired request.
    const deadline = request.at + REVEAL_LINE_DEADLINE_MS;
    if (Date.now() > deadline) {
      useUIStore.getState().consumeRevealLine(nonce);
      return;
    }
    let cancelled = false;
    const tryReveal = () => {
      if (cancelled) return;
      const editor = getEditorIfReady();
      const ready =
        editor !== null && (editor.getModel()?.getLineCount() ?? 0) >= line;
      if (!ready) {
        if (Date.now() < deadline) setTimeout(tryReveal, 60);
        else useUIStore.getState().consumeRevealLine(nonce);
        return;
      }
      reveal(editor, line);
      useUIStore.getState().consumeRevealLine(nonce);
    };
    const t = setTimeout(tryReveal, 60);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [request, path, getEditorIfReady, reveal]);
}
