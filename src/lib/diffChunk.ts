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

/**
 * New-side line numbers actually changed by each file (the `+` rows of every
 * hunk; context rows don't count). Findings are snapped onto these so a
 * model-reported line that points at untouched code lands on the nearest
 * line that really changed.
 */
export function changedNewLines(patch: string): Map<string, Set<number>> {
  const result = new Map<string, Set<number>>();
  for (const file of splitDiffByFile(patch)) {
    const lines = new Set<number>();
    for (const hunk of file.hunks) {
      const start = hunk.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (!start) continue;
      let newLine = Number(start[1]);
      for (const row of hunk.split("\n").slice(1)) {
        if (row.startsWith("+")) {
          lines.add(newLine);
          newLine++;
        } else if (row.startsWith(" ")) {
          newLine++;
        }
        // "-" rows and "\\ No newline" markers consume no new-side line.
      }
    }
    result.set(file.path, lines);
  }
  return result;
}

/**
 * Snap a model-reported line onto the nearest new-side line that actually
 * changed — LLMs routinely report line numbers a few rows off. Unknown or
 * empty change sets return the line untouched; ties resolve to the earlier
 * line.
 */
export function snapLine(changed: Set<number> | undefined, line: number): number {
  if (!changed || changed.size === 0) return line;
  let best = line;
  let bestDist = Infinity;
  for (const candidate of changed) {
    const dist = Math.abs(candidate - line);
    if (dist < bestDist || (dist === bestDist && candidate < best)) {
      best = candidate;
      bestDist = dist;
    }
  }
  return best;
}
