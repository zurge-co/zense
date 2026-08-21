/** Time formatting helpers for git timestamps (unix seconds). */

/** "just now" / "5m ago" / "2h ago" / "3d ago" / "Mar 5" / "Mar 5, 2024" */
export function formatRelativeTime(unixSeconds: number): string {
  const diffMs = Date.now() - unixSeconds * 1000;
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatAbsoluteTime(unixSeconds);
}

/** "Mar 5" (same year) or "Mar 5, 2024". */
export function formatAbsoluteTime(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/** "Mar 5, 14:32" — for tooltips / detail views. */
export function formatFullTime(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  return `${formatAbsoluteTime(unixSeconds)}, ${d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}
