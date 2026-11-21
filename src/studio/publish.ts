// Publish: the working copy's content changes become a branch, a commit, a pull
// request and, for the owner, a merge. Everything that touches git or GitHub comes in
// as an interface, so the order of the steps and every refusal is tested with fakes.
//
// Rules this file holds:
// - nothing is staged, committed or pushed unless every changed path is inside inEditScope;
// - only a branch named edit/... is ever pushed, never main, never gh-pages;
// - files are staged by name;
// - a failure never throws work away: before the commit the edits stay in the working
//   copy, after it they stay committed on the local edit/ branch, and the next Publish
//   carries on from there (same branch, same pull request).
import { inEditScope } from "../editor/scope";
import { GitHubError, type Pull } from "../editor/github";
import { branchName, describeChanges, publishNotes, type FileChange } from "./describe";

export interface PublishGit {
  /** The branch the working copy is on. */
  branch(): Promise<string>;
  /** Every difference between the working copy and origin/main: committed, staged, unstaged and new files. */
  changes(): Promise<FileChange[]>;
  /** The part of it that is not committed yet. */
  uncommitted(): Promise<FileChange[]>;
  /** True when the name is taken, on this Mac or on GitHub. */
  branchExists(name: string): Promise<boolean>;
  /** A new branch from the current state; the edits come along. */
  createBranch(name: string): Promise<void>;
  stage(paths: string[]): Promise<void>;
  /** `author` is used only when git has no name configured. */
  commit(message: string, author: { name: string; email: string }): Promise<void>;
  head(): Promise<string>;
  push(branch: string): Promise<void>;
  fetchMain(): Promise<void>;
  switchTo(branch: string): Promise<void>;
  /** Move the local main up to origin/main; refuses when main has commits of its own. */
  fastForwardMain(): Promise<void>;
  deleteBranch(name: string): Promise<void>;
}

export type CheckState = "waiting" | "passed" | "failed";
export interface PublishGitHub {
  access(): Promise<{ login: string; canWrite: boolean; owner: boolean }>;
  editorPulls(): Promise<Pull[]>;
  openPull(branch: string, base: string, title: string, body: string): Promise<Pull>;
  /** Where the required `build` check of a commit stands. */
  check(sha: string): Promise<CheckState>;
  /** Squash and merge exactly that commit, then remove the branch on GitHub. */
  publish(n: number, branch: string, sha: string): Promise<void>;
}

export type Step = "access" | "branch" | "commit" | "push" | "pull" | "checks" | "merge" | "sync";
export type FailReason = "nothing" | "out_of_scope" | "wrong_branch" | "no_key" | "no_write" | "git" | "github" | "check_failed" | "check_timeout" | "busy" | "build" | "key_rights";
export type PullRef = { number: number; url: string };
export type PublishResult =
  | { ok: true; state: "live" | "waiting"; description: string; pull: PullRef; syncProblem?: string }
  | { ok: false; reason: FailReason; detail?: string; pull?: PullRef };

export type PublishDeps = {
  git: PublishGit;
  github: PublishGitHub;
  report: (step: Step) => void;
  /** One plain line per thing that changed, for the commit and the pull request; without it the paths are listed. */
  details?: () => Promise<string[]>;
  now?: Date;
  sleep?: (ms: number) => Promise<void>;
  /** How often and how long to ask for the check: every 10 s for 15 minutes unless told otherwise. */
  pollMs?: number;
  patienceMs?: number;
};

const MAIN = "main";
const isEditBranch = (name: string) => /^edit\/[^/].*/.test(name);
const plain = (error: unknown) => (error instanceof Error ? error.message : String(error)).trim();

export async function publish(deps: PublishDeps): Promise<PublishResult> {
  const { git, github, report } = deps;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  let pull: PullRef | undefined;
  const fail = (reason: FailReason, detail?: string): PublishResult => ({ ok: false, reason, ...(detail ? { detail } : {}), ...(pull ? { pull } : {}) });
  try {
    const start = await git.branch();
    const resume = isEditBranch(start);
    if (start !== MAIN && !resume) return fail("wrong_branch", start);

    const changes = await git.changes();
    if (!changes.length) return fail("nothing");
    const outside = changes.filter((c) => !inEditScope(c.path));
    if (outside.length) return fail("out_of_scope", outside.map((c) => c.path).join(", "));
    const description = describeChanges(changes);

    // Asked before the commit: afterwards the working copy no longer differs from it.
    const notes = publishNotes(changes, await deps.details?.().catch(() => []));

    report("access");
    const who = await github.access();
    if (!who.canWrite) return fail("no_write", who.login);

    let branch = start;
    if (!resume) {
      report("branch");
      branch = branchName(deps.now ?? new Date(), description);
      if (await git.branchExists(branch)) branch = branchName(deps.now ?? new Date(), description, (deps.now ?? new Date()).toISOString().slice(11, 19).replace(/:/g, ""));
      await git.createBranch(branch);
    }

    const pending = await git.uncommitted();
    if (pending.length) {
      report("commit");
      try {
        // By name, and once more through the scope rule: `pending` is a part of `changes`,
        // but nothing outside the scope may reach the index even if that ever stops being true.
        const names = pending.map((c) => c.path);
        if (names.some((p) => !inEditScope(p))) throw new Error("a file outside the content folders changed while publishing");
        await git.stage(names);
        await git.commit(resume ? describeChanges(pending) : `${description}\n\n${notes}`, { name: who.login, email: `${who.login}@users.noreply.github.com` });
      } catch (error) {
        // Nothing is committed: go back to where we started, the edits stay in the folder.
        if (!resume) await git.switchTo(start).then(() => git.deleteBranch(branch)).catch(() => undefined);
        throw error;
      }
    }

    if (!isEditBranch(branch)) throw new Error(`refusing to push the branch ${branch}`);
    report("push");
    await git.push(branch);
    const sha = await git.head();

    report("pull");
    const body = `Published from the Studio by @${who.login}.\n\n${notes}\n`;
    const found = (await github.editorPulls()).find((p) => p.head.ref === branch) ?? (await github.openPull(branch, MAIN, description, body));
    pull = { number: found.number, url: found.html_url };
    if (!who.owner) return { ok: true, state: "waiting", description, pull };

    report("checks");
    const patience = deps.patienceMs ?? 15 * 60_000;
    const pollMs = deps.pollMs ?? 10_000;
    let state: CheckState = "waiting";
    for (let waited = 0; ; waited += pollMs) {
      state = await github.check(sha);
      if (state !== "waiting" || waited >= patience) break;
      await sleep(pollMs);
    }
    if (state === "failed") return fail("check_failed");
    if (state === "waiting") return fail("check_timeout");

    report("merge");
    await github.publish(pull.number, branch, sha);

    // It is live from here on. What follows only tidies this Mac, so a problem is a note, not a failure.
    report("sync");
    try {
      await git.fetchMain();
      await git.switchTo(MAIN);
      await git.fastForwardMain();
      await git.deleteBranch(branch);
    } catch (error) {
      return { ok: true, state: "live", description, pull, syncProblem: plain(error) };
    }
    return { ok: true, state: "live", description, pull };
  } catch (error) {
    // 403 is GitHub knowing the key and refusing the step: a permission is missing on it.
    if (error instanceof GitHubError && error.status === 403) return fail("key_rights", plain(error));
    return fail(error instanceof GitHubError ? "github" : "git", plain(error));
  }
}
