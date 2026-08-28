/** Image-file detection for the editor preview. SVG is intentionally absent:
 *  it is UTF-8 text and keeps opening in Monaco like before. */

const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  ico: "image/x-icon",
  avif: "image/avif",
  tif: "image/tiff",
  tiff: "image/tiff",
};

function extensionOf(path: string): string {
  const name = path.split("/").pop() ?? path;
  const dot = name.lastIndexOf(".");
  // dot at index 0 means a dotfile with no extension (".env").
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function isImagePath(path: string): boolean {
  return extensionOf(path) in IMAGE_MIME;
}

export function imageMimeType(path: string): string {
  return IMAGE_MIME[extensionOf(path)] ?? "application/octet-stream";
}
