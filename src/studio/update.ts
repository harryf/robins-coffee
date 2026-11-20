// The Studio keeps itself up to date: its code lives in the same repository as the site,
// so "a newer version" is simply a newer main. At start (src/studio/launch.ts), before
// the screen opens, this looks at the folder's own origin and moves the folder forward
// when that is safe. It never switches branches, never discards a local change and never
// takes code from anywhere but the remote the folder was cloned from.
import { existsSync } from "node:fs";
import { join } from "node:path";

export type UpdateReport = {
  /** current: nothing newer. updated: moved forward. skipped: left alone, see reason. failed: tried and could not. */
  result: "current" | "updated" | "skipped" | "failed";
  /** A key the screen translates: offline, branch, diverged, overlap, fetch, merge, install, app. */
  reason?: string;
  from?: string;
  to?: string;
  /** The app's own window program was rebuilt: it is used from the next start. */
  appRebuilt?: boolean;
  at: string;
};

/** What the update needs from the outside world; tests hand in a real git on a temp folder and fake installers. */
export type UpdateDeps = {
  git: (args: string[], remote?: boolean) => Promise<string>;
  /** Paths that differ from HEAD in the working copy, untracked files included. */
  uncommitted: () => Promise<string[]>;
  install: () => Promise<void>;
  rebuildApp: () => Promise<void>;
  hasApp: () => boolean;
  /** What the start before this one reported: a step that failed then is tried again now. */
  previous?: UpdateReport | null;
  now?: () => Date;
};

const MAIN_REF = "refs/remotes/origin/main";
const SHELL = (p: string) => p.startsWith("app/") || p === "scripts/build-app.ts";
const PACKAGES = (p: string) => p === "package.json" || p === "bun.lock" || p === "bun.lockb";

export async function selfUpdate(deps: UpdateDeps): Promise<UpdateReport> {
  const at = (deps.now?.() ?? new Date()).toISOString();
  const { git } = deps;
  if ((await git(["rev-parse", "--abbrev-ref", "HEAD"])).trim() !== "main") return { result: "skipped", reason: "branch", at };
  try {
    // Always the folder's own origin, as git has it: never an address from a content file.
    await git(["fetch", "--quiet", "origin", `+refs/heads/main:${MAIN_REF}`], true);
  } catch {
    return { result: "skipped", reason: "fetch", at };
  }
  const from = (await git(["rev-parse", "HEAD"])).trim();
  const to = (await git(["rev-parse", MAIN_REF])).trim();
  if (from === to) {
    // The code is new already, but packages or the window program did not follow last time: finish the job.
    const owed = deps.previous?.result === "failed" && (deps.previous.reason === "install" || deps.previous.reason === "app") ? deps.previous : null;
    if (!owed) return { result: "current", from, to, at };
    if (owed.reason === "install") {
      try { await deps.install(); } catch { return { ...owed, at }; }
    }
    if (deps.hasApp()) {
      try { await deps.rebuildApp(); } catch { return { ...owed, reason: "app", at }; }
      return { result: "updated", from: owed.from, to, appRebuilt: true, at };
    }
    return { result: "updated", from: owed.from, to, at };
  }
  const ancestor = await git(["merge-base", "--is-ancestor", from, to]).then(() => true, () => false);
  if (!ancestor) return { result: "skipped", reason: "diverged", from, to, at };
  const incoming = (await git(["diff", "--name-only", "--no-renames", "-z", from, to])).split("\0").filter(Boolean);
  // A file changed here and changed there: the person's work wins, the update waits.
  const mine = new Set(await deps.uncommitted());
  if (incoming.some((p) => mine.has(p))) return { result: "skipped", reason: "overlap", from, to, at };
  try {
    await git(["merge", "--quiet", "--ff-only", MAIN_REF]);
  } catch {
    return { result: "failed", reason: "merge", from, to, at };
  }
  if (incoming.some(PACKAGES)) {
    try { await deps.install(); } catch { return { result: "failed", reason: "install", from, to, at }; }
  }
  if (incoming.some(SHELL) && deps.hasApp()) {
    try { await deps.rebuildApp(); } catch { return { result: "failed", reason: "app", from, to, at }; }
    return { result: "updated", from, to, appRebuilt: true, at };
  }
  return { result: "updated", from, to, at };
}

export const reportPath = (root: string) => join(root, ".cache", "studio", "update.json");

export async function readReport(root: string): Promise<UpdateReport | null> {
  try {
    const data = JSON.parse(await Bun.file(reportPath(root)).text());
    return ["current", "updated", "skipped", "failed"].includes(data?.result) ? (data as UpdateReport) : null;
  } catch {
    return null;
  }
}

/** The Studio's version: the number from version.json and the commit the folder is on. */
export async function studioVersion(root: string): Promise<{ number: string; commit: string }> {
  const number = await Bun.file(join(root, "src", "studio", "version.json")).json().then((v: any) => String(v.version ?? "?"), () => "?");
  const proc = Bun.spawn(["git", "rev-parse", "--short=7", "HEAD"], { cwd: root, stdin: "ignore", stdout: "pipe", stderr: "ignore" });
  const commit = existsSync(join(root, ".git")) ? (await new Response(proc.stdout).text()).trim() : "";
  await proc.exited;
  return { number, commit };
}
