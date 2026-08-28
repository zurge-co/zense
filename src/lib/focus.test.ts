// @ts-nocheck
/**
 * Focus timer domain tests — reducer invariants, journal/snapshot parsing,
 * duration math, archiving. Pure logic only (no Tauri).
 */
import { describe, test, expect } from "bun:test";
import {
  ARCHIVE_AFTER_MS,
  activeTaskOf,
  archiveOldTasks,
  applyEvent,
  emptySnapshot,
  FOCUS_SCHEMA_VERSION,
  formatDuration,
  journalPathFor,
  parseJournal,
  parseSnapshot,
  rebuildFromEvents,
  serializeSnapshot,
  totalMs,
  type FocusEvent,
} from "./focus";

const v = FOCUS_SCHEMA_VERSION;
const create = (ts: number, taskId: string, title: string): FocusEvent => ({
  v, ts, type: "task.create", taskId, title,
});
const start = (ts: number, taskId: string): FocusEvent => ({ v, ts, type: "timer.start", taskId });
const resume = (ts: number, taskId: string): FocusEvent => ({ v, ts, type: "timer.resume", taskId });
const pause = (ts: number, taskId: string): FocusEvent => ({
  v, ts, type: "timer.pause", taskId, reason: "manual",
});
const done = (ts: number, taskId: string): FocusEvent => ({ v, ts, type: "task.done", taskId });

const t = (min: number) => 1_760_000_000_000 + min * 60_000;

function applyAll(events: FocusEvent[]) {
  return events.reduce(applyEvent, emptySnapshot());
}

describe("journal path", () => {
  test("rotates monthly as .zense/focus.log/YYYY-MM.jsonl", () => {
    const p = journalPathFor(Date.UTC(2026, 7, 28, 12)); // Aug 2026 (UTC)
    expect(p).toMatch(/^\.zense\/focus\.log\/\d{4}-\d{2}\.jsonl$/);
  });
});

describe("formatDuration", () => {
  test("seconds / minutes / hours", () => {
    expect(formatDuration(5_000)).toBe("5s");
    expect(formatDuration(65_000)).toBe("1m 05s");
    expect(formatDuration(3_720_000)).toBe("1h 02m");
    expect(formatDuration(-100)).toBe("0s");
  });
});

describe("applyEvent", () => {
  test("create + start yields one active task with an open segment", () => {
    const snap = applyAll([create(t(0), "a", "งาน A"), start(t(1), "a")]);
    const a = snap.tasks[0];
    expect(a.status).toBe("active");
    expect(a.segments).toEqual([{ start: t(1), end: null }]);
    expect(activeTaskOf(snap)?.id).toBe("a");
  });

  test("starting another task auto-pauses the running one (≤1 active timer)", () => {
    const snap = applyAll([
      create(t(0), "a", "A"), start(t(1), "a"),
      create(t(0), "b", "B"), start(t(10), "b"),
    ]);
    const a = snap.tasks.find((x) => x.id === "a")!;
    const b = snap.tasks.find((x) => x.id === "b")!;
    expect(a.status).toBe("paused");
    expect(a.segments[0].end).toBe(t(10)); // closed exactly at the switch
    expect(b.status).toBe("active");
    expect(snap.tasks.filter((x) => x.segments.at(-1)?.end === null && x.status === "active")).toHaveLength(1);
  });

  test("resume after pause opens a new segment and keeps history", () => {
    const snap = applyAll([
      create(t(0), "a", "A"), start(t(1), "a"), pause(t(5), "a"), resume(t(8), "a"),
    ]);
    const a = snap.tasks[0];
    expect(a.segments).toEqual([
      { start: t(1), end: t(5) },
      { start: t(8), end: null },
    ]);
  });

  test("idle pause is retroactive: segment ends at lastActivity, not detection time", () => {
    const lastActivity = t(20);
    const snap = applyAll([
      create(t(0), "a", "A"), start(t(15), "a"),
      { v, ts: lastActivity, type: "timer.pause", taskId: "a", reason: "idle" },
    ]);
    const a = snap.tasks[0];
    expect(a.segments[0].end).toBe(lastActivity);
    expect(totalMs(a, t(99))).toBe(5 * 60_000); // 15→20 only; idle time not billed
  });

  test("done closes the segment and freezes the total", () => {
    const snap = applyAll([create(t(0), "a", "A"), start(t(0), "a"), done(t(30), "a")]);
    const a = snap.tasks[0];
    expect(a.status).toBe("done");
    expect(a.completedAt).toBe(t(30));
    expect(totalMs(a, t(10_000))).toBe(30 * 60_000);
  });

  test("done task is never revived by start/resume", () => {
    const snap = applyAll([create(t(0), "a", "A"), start(t(0), "a"), done(t(5), "a"), start(t(6), "a")]);
    expect(snap.tasks[0].status).toBe("done");
  });

  test("totalMs counts the open segment up to now (restart continuity)", () => {
    const snap = applyAll([create(t(0), "a", "A"), start(t(1), "a"), pause(t(4), "a"), start(t(8), "a")]);
    expect(totalMs(snap.tasks[0], t(12))).toBe(3 * 60_000 + 4 * 60_000); // 1→4 + 8→12
  });
});

describe("journal parsing", () => {
  test("skips corrupt lines but keeps valid events", () => {
    const text = [
      JSON.stringify(create(t(0), "a", "A")),
      "{not json",
      JSON.stringify({ type: 123 }), // wrong shape
      "",
      JSON.stringify(start(t(1), "a")),
    ].join("\n");
    const events = parseJournal(text);
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("task.create");
    expect(events[1].type).toBe("timer.start");
  });

  test("rebuildFromEvents replays out-of-order events by timestamp", () => {
    const events = [start(t(1), "a"), done(t(9), "a"), create(t(0), "a", "A")];
    const snap = rebuildFromEvents(events);
    expect(snap.tasks[0].status).toBe("done");
    expect(totalMs(snap.tasks[0], t(100))).toBe(8 * 60_000);
  });
});

describe("archiving", () => {
  test("drops done tasks older than 90 days, keeps recent + running", () => {
    const now = t(0);
    const snap = {
      v,
      tasks: [
        { id: "old", title: "O", status: "done" as const, segments: [], createdAt: now, completedAt: now - ARCHIVE_AFTER_MS - 1 },
        { id: "new", title: "N", status: "done" as const, segments: [], createdAt: now, completedAt: now - 1000 },
        { id: "run", title: "R", status: "active" as const, segments: [{ start: now, end: null }], createdAt: now },
      ],
    };
    const kept = archiveOldTasks(snap, now).tasks.map((x) => x.id);
    expect(kept).toEqual(["new", "run"]);
  });
});

describe("snapshot", () => {
  test("serialize/parse round-trip", () => {
    const snap = applyAll([create(t(0), "a", "A"), start(t(1), "a")]);
    const parsed = parseSnapshot(serializeSnapshot(snap));
    expect(parsed?.tasks).toHaveLength(1);
    expect(parsed?.tasks[0].segments[0].end).toBeNull();
  });

  test("rejects corrupt json and wrong schema version", () => {
    expect(parseSnapshot("{oops")).toBeNull();
    expect(parseSnapshot(JSON.stringify({ v: 99, tasks: [] }))).toBeNull();
    expect(parseSnapshot(JSON.stringify({ v }))).toBeNull();
  });
});
