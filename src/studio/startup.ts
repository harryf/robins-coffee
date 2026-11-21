// What the Studio says about its own start and its own version. Pure and browser-safe:
// the launcher, the server, the screen and the app's build script all use it.
//
// The launcher (src/studio/launch.ts) tells the Mac app what it is doing with one plain
// line per step on standard output: STEP_PREFIX and then a step name. The app
// (app/Studio.swift) knows the same prefix, takes only a name made of a to z, and the
// start page shows its own words for a name it knows. Nothing else of the line reaches a
// screen.

export const STEP_PREFIX = "studio-step: ";
export const STEPS = ["checking", "installing", "rebuilding", "starting"] as const;
export type StartStep = (typeof STEPS)[number];

export const stepLine = (step: StartStep) => `${STEP_PREFIX}${step}`;

/** The step a line of the launcher's output names, or null for any other line. */
export function parseStepLine(line: string): StartStep | null {
  if (!line.startsWith(STEP_PREFIX)) return null;
  const name = line.slice(STEP_PREFIX.length).trim();
  return (STEPS as readonly string[]).includes(name) ? (name as StartStep) : null;
}

/** The number in a version.json text, or null when the text is not one. */
export function versionOf(text: string | null | undefined): string | null {
  try {
    const v = JSON.parse(text ?? "")?.version;
    return typeof v === "string" && /^\d+\.\d+\.\d+$/.test(v) ? v : null;
  } catch {
    return null;
  }
}

/** When this Mac first ran a version: written by the launcher in .cache/studio/installed.json. */
export type InstallRecord = { version: string; commit: string; at: string };

/**
 * The record after this start. A version seen before keeps its first date. A new one is
 * dated by the update that brought it, when this start had one, else by now.
 */
export function nextInstallRecord(previous: InstallRecord | null, current: { number: string; commit: string }, update: { result: string; at: string } | null, now: Date): InstallRecord {
  if (previous && previous.version === current.number) return previous;
  const at = update?.result === "updated" ? update.at : now.toISOString();
  return { version: current.number, commit: current.commit, at };
}

/** GitHub's anchor for a heading "## 0.11.0": lower case, dots and other marks dropped. */
export const changelogAnchor = (version: string) => version.toLowerCase().replace(/[^a-z0-9 _-]/g, "").replace(/ /g, "-");

/** The changelog as it is at the exact commit this folder runs, opened at its version's heading. */
export function changelogUrl(repo: string, commit: string, version: string): string | null {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo) || !/^[0-9a-f]{40}$/.test(commit)) return null;
  const anchor = /^\d+\.\d+\.\d+$/.test(version) ? `#${changelogAnchor(version)}` : "";
  return `https://github.com/${repo}/blob/${commit}/src/studio/CHANGELOG.md${anchor}`;
}

/** What the first screen says after an update, until it is closed. */
export type UpdateNotice = { to: string; fromVersion?: string; toVersion?: string; appRebuilt?: boolean };

/**
 * The note "the Studio was updated" is shown for an update this start made, and only
 * until it is closed: `seen` is the commit of the last update whose note was closed.
 */
export function updateNotice(update: { result: string; to?: string; fromVersion?: string; toVersion?: string; appRebuilt?: boolean } | null | undefined, seen: string | null): UpdateNotice | null {
  if (update?.result !== "updated" || !update.to || update.to === seen) return null;
  return { to: update.to, fromVersion: update.fromVersion, toVersion: update.toVersion, appRebuilt: update.appRebuilt };
}
