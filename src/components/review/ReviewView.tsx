import { useCallback, useState } from "react";
import { GitCompareArrows } from "lucide-react";
import { ReviewPanel } from "../sidebar/ReviewPanel";
import { EditorArea } from "../editor/EditorArea";
import { AiReviewPanel } from "../aiReview/AiReviewPanel";

/** Auto Review findings panel dock height (px) — user-resizable via the
 *  top-edge drag handle; persisted in localStorage so the next session
 *  reopens at the same height. */
const AI_PANEL_DEFAULT_H = 256;
const AI_PANEL_MIN_H = 120;
/** Never cover more than this share of the window (keeps the diff visible). */
const AI_PANEL_MAX_RATIO = 0.8;
const AI_PANEL_HEIGHT_KEY = "zense.aiPanelHeight";

function readPanelHeight(): number {
  try {
    const raw = localStorage.getItem(AI_PANEL_HEIGHT_KEY);
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) && n >= AI_PANEL_MIN_H ? n : AI_PANEL_DEFAULT_H;
  } catch {
    return AI_PANEL_DEFAULT_H;
  }
}

function savePanelHeight(h: number) {
  try {
    localStorage.setItem(AI_PANEL_HEIGHT_KEY, String(Math.round(h)));
  } catch {
    /* storage unavailable — keep the in-memory height */
  }
}

/**
 * Full-page Review (spec v3): left column with the changes list + commit
 * box + Auto Review button, center diff/editor area, and the Auto Review
 * findings panel docked at the bottom — its height adjusts by dragging the
 * top-edge handle (double-click resets to the default).
 */
export function ReviewView() {
  const [panelHeight, setPanelHeight] = useState(readPanelHeight);

  /** Set the panel height and persist it (drag + reset share this). */
  const updateHeight = useCallback((h: number) => {
    setPanelHeight(h);
    savePanelHeight(h);
  }, []);

  const startResize = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const startY = e.clientY;
      const startH = panelHeight;
      const onMove = (ev: PointerEvent) => {
        const max = window.innerHeight * AI_PANEL_MAX_RATIO;
        const next = Math.min(Math.max(startH + (startY - ev.clientY), AI_PANEL_MIN_H), max);
        updateHeight(next);
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [panelHeight, updateHeight],
  );

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <aside className="flex w-72 shrink-0 flex-col overflow-y-auto border-r border-border bg-panel">
        <ReviewPanel />
      </aside>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* flex-col so EditorArea (a flex-1 child) stretches to the full
            pane height — with a plain block wrapper it collapsed to content
            height and the empty placeholder sat clipped at the top. */}
        <div className="flex min-h-0 flex-1 flex-col">
          {/* The center pane IS a diff viewer here — its empty state must
              say so, not "open a file to start exploring". */}
          <EditorArea
            emptyPlaceholder={
              <div className="flex flex-1 flex-col items-center justify-center gap-2 text-fg-muted">
                <GitCompareArrows size={28} strokeWidth={1.2} />
                <p className="text-sm">Select a changed file to view its diff</p>
                <p className="text-[11.5px]">pick a file from the changes list on the left</p>
              </div>
            }
          />
        </div>
        {/* Drag handle — pull up/down to resize the findings panel,
            double-click to reset to the default height. */}
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize the Auto Review panel"
          title="Drag to resize · double-click to reset"
          onPointerDown={startResize}
          onDoubleClick={() => updateHeight(AI_PANEL_DEFAULT_H)}
          className="group relative h-1.5 shrink-0 cursor-row-resize border-t border-border bg-panel hover:bg-hover active:bg-active"
        >
          <div className="absolute inset-x-0 top-1/2 mx-auto h-0.5 w-10 -translate-y-1/2 rounded-full bg-border transition-colors group-hover:bg-accent/50 group-active:bg-accent" />
        </div>
        <div
          className="flex min-h-0 shrink-0 flex-col bg-panel"
          style={{ height: panelHeight }}
        >
          <AiReviewPanel />
        </div>
      </div>
    </div>
  );
}
