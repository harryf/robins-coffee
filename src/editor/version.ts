// Which editor is running and whether a newer one is on the site. Pure, so it is tested.
// The build writes edit/version.json next to the editor; the running editor asks for it
// on start, when it comes back to the front and every 15 minutes.
export type VersionInfo = { version: string; min_supported: string; build: string };
/** current: nothing to do. newer: an update is offered. required: this editor may no longer send. */
export type UpdateState = "current" | "newer" | "required";

/** "0.8.0" against "0.10.1": negative when a is older, 0 when equal, positive when newer. */
export function compareVersions(a: string, b: string): number {
  const [x, y] = [a, b].map((v) => v.split(".").map((n) => Number.parseInt(n, 10) || 0));
  for (let i = 0; i < Math.max(x!.length, y!.length); i++) if ((x![i] ?? 0) !== (y![i] ?? 0)) return (x![i] ?? 0) - (y![i] ?? 0);
  return 0;
}

/** `latest` is null when the site could not be asked (offline): then nothing is claimed. */
export function updateState(mine: { version: string; build: string }, latest: VersionInfo | null): UpdateState {
  if (!latest) return "current";
  if (compareVersions(mine.version, latest.min_supported) < 0) return "required";
  return latest.build !== mine.build || compareVersions(mine.version, latest.version) < 0 ? "newer" : "current";
}
