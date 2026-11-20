// Git for the Studio: the working copy's difference to origin/main, the history, and
// the handful of commands Publish needs. Every command is an argument array handed to
// Bun.spawn; there is no shell string anywhere.
//
// The GitHub token never appears in a command line or an address. Commands that talk
// to GitHub get it as an Authorization header through git's environment based
// configuration (GIT_CONFIG_COUNT / KEY / VALUE), scoped to github.com.
import { inEditScope } from "../editor/scope";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { FileChange, Status } from "./describe";
import { HISTORY_FORMAT, HISTORY_LIMIT, parseHistory, type HistoryEntry } from "./history";
import type { PublishGit } from "./publish";

/** The content paths: the same reach as inEditScope, as git pathspecs. */
export const SCOPE_PATHSPEC = ["site/content", "site/moments", "site/events", "site/data", ":(exclude)site/data/tokens.json"];
const MAIN_REF = "refs/remotes/origin/main";

export class GitError extends Error {}

/** What a command that talks to GitHub gets in its environment, and nothing else carries the token. */
export function authEnv(token: string | null): Record<string, string> {
  const env: Record<string, string> = { GIT_TERMINAL_PROMPT: "0" };
  if (!token) return env;
  return {
    ...env,
    GIT_CONFIG_COUNT: "2",
    GIT_CONFIG_KEY_0: "http.https://github.com/.extraHeader",
    GIT_CONFIG_VALUE_0: `Authorization: Basic ${btoa(`x-access-token:${token}`)}`,
    // No helper is asked, so a stored login can neither win over the key nor be overwritten.
    GIT_CONFIG_KEY_1: "credential.helper",
    GIT_CONFIG_VALUE_1: "",
  };
}

const statusOf = (letter: string): Status => (letter.startsWith("A") ? "added" : letter.startsWith("D") ? "removed" : "modified");

/** `git diff --name-status -z`: status, NUL, path, NUL, and so on. */
export function parseNameStatus(out: string): FileChange[] {
  const parts = out.split("\0").filter((s) => s !== "");
  const changes: FileChange[] = [];
  for (let i = 0; i + 1 < parts.length; i += 2) changes.push({ path: parts[i + 1]!, status: statusOf(parts[i]!) });
  return changes;
}

export type GitOptions = {
  /** Where main is fetched from and edit/ branches are pushed to: an https address without any login in it. */
  remote: string;
  /** The GitHub key for commands that reach the remote; asked for each time, never kept here. */
  token?: () => Promise<string | null>;
  /** The git program; a test puts a recording wrapper here. */
  bin?: string;
};

export function studioGit(root: string, options: GitOptions) {
  const bin = options.bin ?? "git";
  const run = async (args: string[], extraEnv: Record<string, string> = {}): Promise<string> => {
    const proc = Bun.spawn([bin, ...args], { cwd: root, env: { ...process.env, ...extraEnv }, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    if (code !== 0) throw new GitError(`git ${args[0]}: ${(err.trim() || out.trim() || `exit ${code}`).split("\n").slice(-3).join(" ")}`);
    return out;
  };
  const ok = (args: string[]) => run(args).then(() => true, () => false);
  const remote = async (args: string[]) => run(args, authEnv((await options.token?.()) ?? null));
  /** The commit the working copy and origin/main share: what "live" was when this work started. */
  const base = async () => (await run(["merge-base", MAIN_REF, "HEAD"])).trim();
  const against = async (ref: string): Promise<FileChange[]> => {
    const tracked = parseNameStatus(await run(["diff", "--name-status", "--no-renames", "-z", ref, "--"]));
    const fresh = (await run(["ls-files", "--others", "--exclude-standard", "-z"])).split("\0").filter(Boolean);
    return [...tracked, ...fresh.filter((p) => !tracked.some((c) => c.path === p)).map((path) => ({ path, status: "added" as const }))].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  };

  const git: PublishGit = {
    branch: async () => (await run(["rev-parse", "--abbrev-ref", "HEAD"])).trim(),
    changes: async () => against(await base()),
    uncommitted: () => against("HEAD"),
    async branchExists(name) {
      if (await ok(["show-ref", "--verify", "--quiet", `refs/heads/${name}`])) return true;
      return (await remote(["ls-remote", "--heads", options.remote, `refs/heads/${name}`])).trim() !== "";
    },
    createBranch: async (name) => void (await run(["switch", "-c", name])),
    async stage(paths) {
      if (paths.length) await run(["add", "--", ...paths]);
    },
    async commit(message, author) {
      const named = await ok(["config", "user.name"]);
      const who: Record<string, string> = named ? {} : { GIT_AUTHOR_NAME: author.name, GIT_AUTHOR_EMAIL: author.email, GIT_COMMITTER_NAME: author.name, GIT_COMMITTER_EMAIL: author.email };
      // Only what this publish staged goes out: something staged earlier by hand, outside the
      // content folders, would otherwise ride along into a public branch.
      const staged = (await run(["diff", "--cached", "--name-only", "--no-renames", "-z"])).split("\0").filter(Boolean);
      const foreign = staged.filter((p) => !inEditScope(p));
      if (foreign.length) throw new GitError(`staged outside the content folders: ${foreign.slice(0, 5).join(", ")}`);
      await run(["commit", "--quiet", "-m", message], who);
    },
    head: async () => (await run(["rev-parse", "HEAD"])).trim(),
    async push(branch) {
      // The second lock on the same door as publish.ts: only an edit/ branch leaves this Mac.
      if (!/^edit\/[^/].*/.test(branch)) throw new GitError(`refusing to push the branch ${branch}`);
      await remote(["push", "--quiet", options.remote, `refs/heads/${branch}:refs/heads/${branch}`]);
    },
    fetchMain: async () => void (await remote(["fetch", "--quiet", options.remote, `+refs/heads/main:${MAIN_REF}`])),
    switchTo: async (branch) => void (await run(["switch", "--quiet", branch])),
    fastForwardMain: async () => void (await run(["merge", "--quiet", "--ff-only", MAIN_REF])),
    deleteBranch: async (name) => void (await run(["branch", "--quiet", "-D", name])),
  };

  return {
    ...git,
    /** A file as origin/main had it when this work started, or null when it was not there. */
    async liveText(path: string): Promise<string | null> {
      return run(["show", `${await base()}:${path}`]).catch(() => null);
    },
    /** One file back to what is live: restored from git, or removed when it is new. */
    async discard(path: string): Promise<void> {
      const from = await base();
      if (await ok(["cat-file", "-e", `${from}:${path}`])) await run(["restore", `--source=${from}`, "--staged", "--worktree", "--", path]);
      else {
        await run(["rm", "--quiet", "--cached", "--ignore-unmatch", "--", path]);
        if (existsSync(join(root, path))) await rm(join(root, path));
      }
    },
    /** The last 50 commits on origin/main that touched content, newest first. */
    async history(): Promise<HistoryEntry[]> {
      return parseHistory(await run(["log", `-${HISTORY_LIMIT}`, `--format=${HISTORY_FORMAT}`, MAIN_REF, "--", ...SCOPE_PATHSPEC]));
    },
  };
}

export type StudioGit = ReturnType<typeof studioGit>;
