/** Doc-preview classification for the right-click "Open Preview" action in the
 *  file tree. Left-click keeps opening these as text in Monaco; this only
 *  decides which extensions get the extra menu item. Raster images are NOT
 *  here — those open directly in the ImageViewer. */

export type PreviewKind = "svg" | "markdown" | "html";

const KIND_BY_EXT: Record<string, PreviewKind> = {
  html: "html",
  htm: "html",
  md: "markdown",
  markdown: "markdown",
  svg: "svg",
};

function extensionOf(path: string): string {
  const name = path.split("/").pop() ?? path;
  const dot = name.lastIndexOf(".");
  // dot at index 0 means a dotfile with no extension (".env").
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/** Preview kind for a path, or null when it is not doc-previewable. */
export function previewKind(path: string): PreviewKind | null {
  return KIND_BY_EXT[extensionOf(path)] ?? null;
}

export function isPreviewablePath(path: string): boolean {
  return previewKind(path) !== null;
}
