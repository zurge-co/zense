import { useEffect, useState } from "react";
import { ImageIcon, TriangleAlert } from "lucide-react";
import { readFileBinary } from "../../lib/workspaceFs";
import { imageMimeType } from "../../lib/image";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

/** Read-only preview for image files (PNG/JPG/GIF/WebP/…) that the text-only
 *  read_file command cannot open. Fetches base64 from Rust, builds an object
 *  URL, and revokes it on unmount. */
export function ImageViewer({ root, path }: { root: string; path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [size, setSize] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setUrl(null);
    setError(null);
    setSize(null);
    void (async () => {
      try {
        const b64 = await readFileBinary(root, path);
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        objectUrl = URL.createObjectURL(new Blob([bytes], { type: imageMimeType(path) }));
        if (cancelled) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        setUrl(objectUrl);
        setSize(bytes.length);
      } catch (err) {
        if (!cancelled) setError(String(err));
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [root, path]);

  const name = path.split("/").pop() ?? path;

  if (error) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-fg-muted">
        <TriangleAlert size={24} strokeWidth={1.5} className="text-yellow" />
        <p className="font-mono text-[12px]">{path}</p>
        <p className="max-w-96 text-center text-[11.5px]">{error}</p>
      </div>
    );
  }

  if (!url) {
    return (
      <div className="flex flex-1 items-center justify-center text-[12px] text-fg-muted">
        Loading {path}…
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4">
        <img
          src={url}
          alt={name}
          className="max-h-full max-w-full object-contain"
        />
      </div>
      <div className="flex h-7 shrink-0 items-center gap-2 border-t border-border bg-panel px-3 text-[11px] text-fg-muted">
        <ImageIcon size={12} />
        <span className="truncate font-mono">{name}</span>
        {size !== null && <span className="shrink-0">{formatBytes(size)}</span>}
      </div>
    </div>
  );
}
