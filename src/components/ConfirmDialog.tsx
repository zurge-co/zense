import { useEffect } from "react";

export interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** Optional third action between cancel and confirm (e.g. "Discard"). */
  secondaryLabel?: string;
  onSecondary?: () => void;
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
  onConfirm,
  onCancel,
  secondaryLabel,
  onSecondary,
}: ConfirmDialogProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onCancel}
    >
      <div
        className="w-[400px] overflow-hidden rounded-lg border border-border bg-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-border px-4 py-3 text-[13px] font-medium text-fg">
          {title}
        </div>
        <div className="px-4 py-4 text-[12.5px] leading-relaxed text-fg-muted">
          {message}
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <button
            onClick={onCancel}
            className="rounded border border-border bg-base px-3 py-1.5 text-[12px] text-fg-muted hover:bg-hover hover:text-fg"
          >
            {cancelLabel}
          </button>
          {secondaryLabel && onSecondary && (
            <button
              onClick={onSecondary}
              className="rounded border border-danger/50 bg-danger/10 px-3 py-1.5 text-[12px] text-danger hover:bg-danger/20"
            >
              {secondaryLabel}
            </button>
          )}
          <button
            onClick={onConfirm}
            className={`rounded px-3 py-1.5 text-[12px] text-white ${
              danger ? "bg-danger hover:brightness-110" : "bg-accent hover:brightness-110"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
