import { GitCompareArrows } from "lucide-react";
import { ReviewPanel } from "../sidebar/ReviewPanel";
import { EditorArea } from "../editor/EditorArea";
import { AiReviewPanel } from "../aiReview/AiReviewPanel";

/**
 * Full-page Review (spec v3): left column with the changes list + commit
 * box + Auto Review button, center diff/editor area, and the Auto Review
 * findings panel docked at the bottom. Replaces the old sidebar
 * ReviewPanel + right-dock AiReviewPanel layout.
 */
export function ReviewView() {
  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <aside className="flex w-72 shrink-0 flex-col overflow-y-auto border-r border-border bg-panel">
        <ReviewPanel />
      </aside>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="min-h-0 flex-1">
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
        <div className="flex h-64 shrink-0 flex-col border-t border-border bg-panel">
          <AiReviewPanel />
        </div>
      </div>
    </div>
  );
}
