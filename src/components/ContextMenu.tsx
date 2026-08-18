import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";

export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: LucideIcon;
  onClick: () => void;
  disabled?: boolean;
}

interface ContextMenuProps {
  items: ContextMenuItem[];
  position: { x: number; y: number };
  onClose: () => void;
}

export function ContextMenu({ items, position, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [adjusted, setAdjusted] = useState(position);

  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pad = 4;
    let x = position.x;
    let y = position.y;
    if (x + rect.width + pad > window.innerWidth) x = Math.max(pad, window.innerWidth - rect.width - pad);
    if (y + rect.height + pad > window.innerHeight) y = Math.max(pad, window.innerHeight - rect.height - pad);
    setAdjusted({ x, y });
  }, [position.x, position.y]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }}>
      <div
        ref={menuRef}
        style={{ left: adjusted.x, top: adjusted.y }}
        className="absolute min-w-[180px] overflow-hidden rounded-md border border-border bg-panel py-1 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {items.map((item, i) => (
          <MenuRow key={item.id} item={item} index={i} onClose={onClose} />
        ))}
      </div>
    </div>
  );
}

function MenuRow({ item, index, onClose }: { item: ContextMenuItem; index: number; onClose: () => void }) {
  const Icon = item.icon;
  return (
    <button
      disabled={item.disabled}
      onClick={() => {
        if (item.disabled) return;
        item.onClick();
        onClose();
      }}
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] ${
        index > 0 ? "border-t border-border" : ""
      } ${item.disabled ? "cursor-default text-fg-muted/50" : "text-fg hover:bg-hover"}`}
    >
      {Icon && <Icon size={13} className="text-fg-muted" />}
      <span>{item.label}</span>
    </button>
  );
}
