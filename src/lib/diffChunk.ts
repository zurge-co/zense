/**
 * Staged-diff chunking for Auto Review: splits a unified diff into
 * LLM-sized chunks — first by file, then by hunk when a single file's diff
 * would blow the per-request budget. Pure functions so tests can exercise
 * them without a workspace, git, or LLM.
 */

export interface FileSection {
  /** New-side path (b/<path>) — the file as it will exist after commit. */
  path: string;
  /** Everything before the first @@ hunk (diff --git, index, ---/+++). */
  header: string;
  /** Hunks with their @@ line, in file order. */
  hunks: string[];
  /** The full untouched section text. */
  text: string;
}

export interface DiffChunk {
  path: string;
  /** 1-based index of this chunk within its file. */
  part: number;
  /** Total chunks this file was split into. */
  parts: number;
  /** Header + hunk group, ready to embed in a prompt. */
  patch: string;
}

/** Default per-chunk budget; generous but safely inside small-context models. */
export const DEFAULT_CHUNK_BUDGET = 12_000;

/** b/<path> from the +++ line; `/dev/null` (deletion) falls back to the
 *  a/<path> side of the diff --git header. */
function sectionPath(section: string): string {
  const plus = section.match(/^\+\+\+ b\/(.+)$/m)?.[1];
  if (plus) return plus;
  const git = section.match(/^diff --git a\/(.+?) b\//m)?.[1];
  return git ?? "unknown";
}

/** Split a unified diff into per-file sections (renames count as one). */
export function splitDiffByFile(patch: string): FileSection[] {
  if (!patch.trim()) return [];
  const rawSections = patch.split(/(?=^diff --git )/m).filter((s) => s.trim());
  return rawSections.map((text) => {
    const trimmed = text.trimEnd();
    const hunkStart = trimmed.search(/^@@ /m);
    return {
      path: sectionPath(trimmed),
      header: hunkStart === -1 ? trimmed : trimmed.slice(0, hunkStart).trimEnd(),
      hunks:
        hunkStart === -1
          ? []
          : trimmed
              .slice(hunkStart)
              .split(/(?=^@@ )/m)
              .filter((h) => h.trim()),
      text: trimmed,
    };
  });
}

/**
 * Group a file's hunks into prompt-sized chunks. The header rides with
 * every group so each chunk is self-describing. A hunk larger than the
 * budget becomes its own chunk unsplit — cutting mid-hunk would produce a
 * patch the model can't read, so the overflow is intentional.
 */
export function chunkDiff(
  patch: string,
  budget: number = DEFAULT_CHUNK_BUDGET,
): DiffChunk[] {
  const chunks: DiffChunk[] = [];
  for (const file of splitDiffByFile(patch)) {
    if (file.text.length <= budget) {
      chunks.push({ path: file.path, part: 1, parts: 1, patch: file.text });
      continue;
    }
    const groups: string[] = [];
    let current = file.header;
    for (const hunk of file.hunks.length ? file.hunks : [file.text]) {
      const candidate = `${current}\n${hunk}`;
      if (current !== file.header && candidate.length > budget) {
        groups.push(current);
        current = file.header;
      }
      current = `${current}\n${hunk}`;
    }
    groups.push(current);
    groups.forEach((group, i) => {
      chunks.push({ path: file.path, part: i + 1, parts: groups.length, patch: group });
    });
  }
  return chunks;
}
