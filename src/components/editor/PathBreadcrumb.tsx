import { ChevronRight } from "lucide-react";

/**
 * File-path breadcrumb shown above file tabs (EditorArea) and diff tabs
 * (DiffView — files opened from the Review panel). Renders the workspace-
 * relative path as `segment / segment / file` with chevron separators.
 */
export function PathBreadcrumb({ path }: { path: string }) {
  return (
    <div className="flex h-7 shrink-0 items-center gap-1 border-b border-border px-3 text-[11.5px] text-fg-muted">
      {path.split("/").map((seg, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && <ChevronRight size={11} />}
          <span>{seg}</span>
        </span>
      ))}
    </div>
  );
}
