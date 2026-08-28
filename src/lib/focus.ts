/**
 * Focus timer — domain model + persistence paths.
 *
 * State lives per-project inside `.zense/`, shared with pi-zense:
 *
 *   .zense/focus.json                snapshot (source of truth on load),
 *                                    schema-versioned, written atomically
 *                                    (tmp + rename via `write_file_atomic`)
 *   .zense/focus.log/YYYY-MM.jsonl   append-only journal, rotated monthly
 *                                    (audit trail + history)
 *
 * Invariants enforced by `applyEvent` — every writer (UI store and journal
 * replay alike) goes through it:
 *
 *   - at most ONE task has an open segment (active timer) at any time
 *   - starting/resuming a task auto-pauses any other running task
 *     ("auto-switch")
 *
 * Journal lines that fail to parse are skipped, never fatal to the file.
 * A corrupt/missing snapshot is rebuilt by replaying the journals.
 */

export const FOCUS_SCHEMA_VERSION = 1;

export const FOCUS_SNAPSHOT_PATH = ".zense/focus.json";
export const FOCUS_JOURNAL_DIR = ".zense/focus.log";

/** App-level idle threshold: no keyboard/mouse activity pauses the timer. */
export const IDLE_THRESHOLD_MS = 5 * 60_000;
/** Done tasks older than this are archived out of the snapshot (still in the journal). */
export const ARCHIVE_AFTER_MS = 90 * 24 * 60 * 60 * 1000;

export type TaskStatus = "active" | "paused" | "done";
export type PauseReason = "manual" | "auto-switch" | "idle";

export interface Segment {
  start: number;
  /** null while the timer is running (single open segment per task). */
  end: number | null;
}

export interface FocusTask {
  id: string;
  title: string;
  status: TaskStatus;
  segments: Segment[];
  createdAt: number;
  completedAt?: number;
}

export interface FocusSnapshot {
  v: number;
  tasks: FocusTask[];
}

export type FocusEvent =
  | { v: number; ts: number; type: "task.create"; taskId: string; title: string }
  | { v: number; ts: number; type: "timer.start"; taskId: string }
  | { v: number; ts: number; type: "timer.pause"; taskId: string; reason: PauseReason }
  | { v: number; ts: number; type: "timer.resume"; taskId: string }
  | { v: number; ts: number; type: "task.done"; taskId: string };

// ── Paths ────────────────────────────────────────────────────────────────

export function journalPathFor(ts: number = Date.now()): string {
  const d = new Date(ts);
  const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  return `${FOCUS_JOURNAL_DIR}/${month}.jsonl`;
}

// ── Journal (append-only, one event per line) ────────────────────────────

export function encodeEvent(event: FocusEvent): string {
  return JSON.stringify(event);
}

/** Parse a journal file. Corrupt/unknown lines are skipped (jsonl tolerates
 *  partial corruption by design). */
export function parseJournal(text: string): FocusEvent[] {
  const events: FocusEvent[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as Partial<FocusEvent>;
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        typeof parsed.type === "string" &&
        typeof parsed.taskId === "string" &&
        typeof parsed.ts === "number"
      ) {
        events.push(parsed as FocusEvent);
      }
    } catch {
      // skip corrupt line
    }
  }
  return events;
}

// ── Snapshot ─────────────────────────────────────────────────────────────

export function emptySnapshot(): FocusSnapshot {
  return { v: FOCUS_SCHEMA_VERSION, tasks: [] };
}

/** Parse a snapshot, or null if it is corrupt/for a different schema version
 *  (caller then rebuilds from journals). */
export function parseSnapshot(text: string): FocusSnapshot | null {
  try {
    const parsed = JSON.parse(text) as FocusSnapshot;
    if (typeof parsed !== "object" || parsed === null) return null;
    if (parsed.v !== FOCUS_SCHEMA_VERSION || !Array.isArray(parsed.tasks)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function serializeSnapshot(snapshot: FocusSnapshot): string {
  return JSON.stringify(snapshot, null, 2) + "\n";
}

// ── Reducer (single source of the invariants) ────────────────────────────

function closeOpenSegment(task: FocusTask, ts: number): FocusTask {
  const last = task.segments[task.segments.length - 1];
  if (!last || last.end !== null) return task;
  const closed: Segment = { start: last.start, end: Math.max(ts, last.start) };
  return { ...task, segments: [...task.segments.slice(0, -1), closed] };
}

/** Pause every task with an open segment except `exceptId`. */
function pauseOthers(tasks: FocusTask[], exceptId: string, ts: number): FocusTask[] {
  return tasks.map((t) => {
    if (t.id === exceptId) return t;
    const closed = closeOpenSegment(t, ts);
    return closed !== t ? { ...closed, status: "paused" as TaskStatus } : t;
  });
}

function withTask(tasks: FocusTask[], id: string, fn: (t: FocusTask) => FocusTask): FocusTask[] {
  return tasks.map((t) => (t.id === id ? fn(t) : t));
}

/**
 * Apply one event to a snapshot (pure). Enforces the "≤ 1 active timer"
 * invariant: `timer.start` / `timer.resume` auto-close any other open
 * segment at the event timestamp.
 */
export function applyEvent(snapshot: FocusSnapshot, event: FocusEvent): FocusSnapshot {
  let tasks = snapshot.tasks;
  switch (event.type) {
    case "task.create":
      if (tasks.some((t) => t.id === event.taskId)) return snapshot;
      tasks = [
        ...tasks,
        {
          id: event.taskId,
          title: event.title,
          status: "paused",
          segments: [],
          createdAt: event.ts,
        },
      ];
      break;
    case "timer.start":
    case "timer.resume": {
      tasks = pauseOthers(tasks, event.taskId, event.ts);
      tasks = withTask(tasks, event.taskId, (t) => {
        if (t.status === "done") return t; // a finished task is never revived
        const last = t.segments[t.segments.length - 1];
        if (last && last.end === null) return { ...t, status: "active" }; // already running
        return {
          ...t,
          status: "active",
          segments: [...t.segments, { start: event.ts, end: null }],
        };
      });
      break;
    }
    case "timer.pause":
      tasks = withTask(tasks, event.taskId, (t) => {
        const closed = closeOpenSegment(t, event.ts);
        return closed !== t ? { ...closed, status: "paused" } : { ...t, status: "paused" };
      });
      break;
    case "task.done":
      tasks = withTask(tasks, event.taskId, (t) => {
        const closed = closeOpenSegment(t, event.ts);
        return { ...closed, status: "done", completedAt: event.ts };
      });
      break;
  }
  return { ...snapshot, tasks };
}

/** Rebuild a snapshot from journal events (corrupt-snapshot recovery). */
export function rebuildFromEvents(events: FocusEvent[]): FocusSnapshot {
  const sorted = [...events].sort((a, b) => a.ts - b.ts);
  return sorted.reduce(applyEvent, emptySnapshot());
}

/** Drop done tasks older than ARCHIVE_AFTER_MS from the snapshot (their
 *  records stay in the monthly journals for history/reporting). */
export function archiveOldTasks(snapshot: FocusSnapshot, now: number = Date.now()): FocusSnapshot {
  return {
    ...snapshot,
    tasks: snapshot.tasks.filter(
      (t) => t.status !== "done" || t.completedAt === undefined || now - t.completedAt <= ARCHIVE_AFTER_MS,
    ),
  };
}

// ── Derived values ───────────────────────────────────────────────────────

/** Total tracked time. An open segment counts up to `now`. */
export function totalMs(task: FocusTask, now: number = Date.now()): number {
  return task.segments.reduce(
    (sum, s) => sum + Math.max(0, (s.end ?? now) - s.start),
    0,
  );
}

export function activeTaskOf(snapshot: FocusSnapshot): FocusTask | null {
  return snapshot.tasks.find((t) => t.status === "active") ?? null;
}

/** "5s" · "1m 05s" · "1h 02m" */
export function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

export function newTaskId(now: number = Date.now()): string {
  return `t_${now.toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}
