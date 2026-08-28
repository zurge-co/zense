import { useEffect, useState } from "react";
import { Eye, TriangleAlert } from "lucide-react";
import { readFileBinary, readFileContent } from "../../lib/workspaceFs";
import { previewKind, type PreviewKind } from "../../lib/preview";
import { renderMarkdownDocument } from "../../lib/markdown";

const KIND_LABEL: Record<PreviewKind, string> = {
  svg: "SVG",
  markdown: "Markdown",
  html: "HTML",
};

/**
 * Read-only rendered preview for svg / md / html files (opened via the file
 * tree's right-click "Open Preview"; left-click still opens the source in
 * Monaco). HTML and Markdown render inside <iframe sandbox=""> — scripts and
 * same-origin access stay disabled, since workspace files are untrusted
 * input. SVG goes through a <img> object URL, which cannot run scripts.
 */
export function PreviewView({ root, path }: { root: string; path: string }) {
  const kind = previewKind(path);
  const [svgUrl, setSvgUrl] = useState<string | null>(null);
  const [srcDoc, setSrcDoc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setSvgUrl(null);
    setSrcDoc(null);
    setError(null);
    void (async () => {
      try {
        if (kind === "svg") {
          const b64 = await readFileBinary(root, path);
          const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
          objectUrl = URL.createObjectURL(new Blob([bytes], { type: "image/svg+xml" }));
          if (cancelled) {
            URL.revokeObjectURL(objectUrl);
            return;
          }
          setSvgUrl(objectUrl);
        } else if (kind === "markdown") {
          const text = await readFileContent(root, path);
          if (!cancelled) setSrcDoc(renderMarkdownDocument(text));
        } else if (kind === "html") {
          const text = await readFileContent(root, path);
          if (!cancelled) setSrcDoc(text);
        } else {
          setError("This file type has no preview.");
        }
      } catch (err) {
        if (!cancelled) setError(String(err));
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [root, path, kind]);

  const name = path.split("/").pop() ?? path;

  let body: React.ReactNode;
  if (error) {
    body = (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-fg-muted">
        <TriangleAlert size={24} strokeWidth={1.5} className="text-yellow" />
        <p className="font-mono text-[12px]">{path}</p>
        <p className="max-w-96 text-center text-[11.5px]">{error}</p>
      </div>
    );
  } else if (kind === "svg") {
    body = svgUrl ? (
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4">
        <img src={svgUrl} alt={name} className="max-h-full max-w-full object-contain" />
      </div>
    ) : (
      <Loading path={path} />
    );
  } else {
    body = srcDoc !== null ? (
      // Empty sandbox: scripts and same-origin access stay disabled, so
      // previewed markup cannot execute or reach the app's origin.
      <iframe title={`Preview of ${name}`} sandbox="" srcDoc={srcDoc} className="min-h-0 flex-1 border-0 bg-white" />
    ) : (
      <Loading path={path} />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {body}
      <div className="flex h-7 shrink-0 items-center gap-2 border-t border-border bg-panel px-3 text-[11px] text-fg-muted">
        <Eye size={12} />
        <span className="truncate font-mono">{name}</span>
        {kind && (
          <span className="shrink-0 rounded bg-accent/15 px-1 text-[9.5px] font-medium text-accent">
            {KIND_LABEL[kind]} PREVIEW
          </span>
        )}
      </div>
    </div>
  );
}

function Loading({ path }: { path: string }) {
  return (
    <div className="flex flex-1 items-center justify-center text-[12px] text-fg-muted">
      Loading {path}…
    </div>
  );
}
