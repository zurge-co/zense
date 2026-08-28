import { Check, Pause, Play } from "lucide-react";
import { formatDuration, totalMs, type FocusTask } from "../../lib/focus";
import { useFocusStore } from "../../store/focusStore";

const statusDot: Record<FocusTask["status"], string> = {
  active: "bg-accent animate-pulse",
  paused: "bg-fg-muted",
  done: "bg-transparent",
};

export function TaskItem({ task, now }: { task: FocusTask; now: number }) {
  const { startTask, pauseTask, resumeTask, doneTask } = useFocusStore();
  const done = task.status === "done";

  return (
    <div className="flex items-center gap-2 rounded border border-border bg-base px-2 py-1.5">
      {done ? (
        <Check size={12} className="shrink-0 text-accent" />
      ) : (
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusDot[task.status]}`} />
      )}
      <div className="min-w-0 flex-1">
        <div className={`truncate text-[12.5px] ${done ? "text-fg-muted line-through" : "text-fg"}`}>
          {task.title}
        </div>
        <div className="text-[10.5px] text-fg-muted tabular-nums">
          {formatDuration(totalMs(task, now))}
          {done && task.completedAt ? " · done" : task.status === "paused" ? " · paused" : ""}
        </div>
      </div>
      {!done && (
        <div className="flex shrink-0 items-center gap-1">
          {task.status === "active" ? (
            <button
              title="Pause"
              onClick={() => void pauseTask(task.id)}
              className="rounded p-1 text-fg-muted hover:bg-hover hover:text-fg"
            >
              <Pause size={13} />
            </button>
          ) : (
            <button
              title={task.segments.length > 0 ? "Resume" : "Start"}
              onClick={() =>
                void (task.segments.length > 0 ? resumeTask(task.id) : startTask(task.id))
              }
              className="rounded p-1 text-fg-muted hover:bg-hover hover:text-fg"
            >
              <Play size={13} />
            </button>
          )}
          <button
            title="Mark done"
            onClick={() => void doneTask(task.id)}
            className="rounded p-1 text-fg-muted hover:bg-hover hover:text-fg"
          >
            <Check size={13} />
          </button>
        </div>
      )}
    </div>
  );
}
