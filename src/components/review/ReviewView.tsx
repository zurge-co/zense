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
          <EditorArea />
        </div>
        <div className="flex h-64 shrink-0 flex-col border-t border-border bg-panel">
          <AiReviewPanel />
        </div>
      </div>
    </div>
  );
}
