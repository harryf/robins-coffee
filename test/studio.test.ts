import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync, cpSync, statSync } from "node:fs";
import { networkInterfaces, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { GitHubError, type Pull } from "../src/editor/github";
import { inEditScope } from "../src/editor/scope";
import { checkState, studioGitHub } from "../src/studio/checks";
import { branchName, describeChanges, type FileChange } from "../src/studio/describe";
import { authEnv, parseNameStatus, studioGit } from "../src/studio/git";
import { previewFile, refuseApi, safeEditPath, TOKEN_HEADER } from "../src/studio/guard";
import { parseHistory } from "../src/studio/history";
import { keychain, validKey, type Keychain, type KeyName } from "../src/studio/keychain";
import { publish, type CheckState, type PublishGit, type PublishGitHub, type Step } from "../src/studio/publish";
import { RELOAD_SCRIPT, startStudio, type StudioState } from "../src/studio/server";
import { STRINGS } from "../src/studio/strings";

const ROOT = join(import.meta.dir, "..");
const en = STRINGS.en;
const de = STRINGS.de;
// Put together at run time, so a search of the folder for it finds only a real leak, never this file.
const DUMMY_TOKEN = ["dummy", "token", "for", "tests", "0123456789"].join("_");

// ---------- helpers: real git in throwaway folders ----------

const temps: string[] = [];
const temp = () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "robins-studio-test-")));
  temps.push(dir);
  return dir;
};
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

function sh(cwd: string, ...args: string[]): string {
  const run = Bun.spawnSync(["git", "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (run.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${run.stderr.toString()}`);
  return run.stdout.toString();
}

/** A working copy on main with a bare "GitHub" next to it. `fill` puts the first files in. */
function repoWithRemote(fill: (root: string) => void): { root: string; bare: string } {
  const dir = temp();
  const root = join(dir, "work");
  const bare = join(dir, "remote.git");
  mkdirSync(root);
  sh(root, "init", "--quiet", "-b", "main");
  writeFileSync(join(root, ".git", "info", "exclude"), "node_modules\n.cache\n");
  sh(root, "config", "user.name", "Test");
  sh(root, "config", "user.email", "test@example.invalid");
  sh(root, "config", "commit.gpgsign", "false");
  fill(root);
  sh(root, "add", "-A");
  sh(root, "commit", "--quiet", "-m", "First version");
  sh(dir, "clone", "--quiet", "--bare", root, bare);
  sh(root, "remote", "add", "origin", bare);
  sh(root, "fetch", "--quiet", "origin");
  return { root, bare };
}

const HOURS_YML = 'regular:\n  - days: [mo, tu, we, th, fr, sa, su]\n    open: "16:00"\n    close: "00:00"\nexceptions: []\n';
const tinyRepo = () => repoWithRemote((root) => {
  mkdirSync(join(root, "site", "data"), { recursive: true });
  mkdirSync(join(root, "site", "events"), { recursive: true });
  writeFileSync(join(root, "site", "data", "hours.yml"), HOURS_YML);
  writeFileSync(join(root, "site", "data", "tokens.json"), "{}\n");
  writeFileSync(join(root, "site", "events", "README.md"), "Events\n");
  writeFileSync(join(root, "README.md"), "Read me\n");
});

/** GitHub played by the bare repository: "merging" moves its main to the pushed commit. */
function fakeGitHub(bare: string | null, over: Partial<PublishGitHub> & { owner?: boolean; canWrite?: boolean; checks?: CheckState[] } = {}) {
  const calls: string[] = [];
  const pulls: Pull[] = [];
  const checks = [...(over.checks ?? ["passed"])];
  const github: PublishGitHub = {
    async access() {
      calls.push("access");
      return { login: "harryf", canWrite: over.canWrite ?? true, owner: over.owner ?? true };
    },
    async editorPulls() {
      calls.push("editorPulls");
      return pulls;
    },
    async openPull(branch, base, title) {
      calls.push(`openPull ${branch} -> ${base}: ${title}`);
      const pull = { number: 21 + pulls.length, title, html_url: `https://github.example/pull/${21 + pulls.length}`, state: "open", merged: false, head: { ref: branch, sha: "", repo: { full_name: "x/y" } }, user: { login: "harryf" } };
      pulls.push(pull);
      return pull;
    },
    async check(sha) {
      calls.push(`check ${sha.slice(0, 4)}`);
      return checks.length > 1 ? checks.shift()! : checks[0]!;
    },
    async publish(n, branch, sha) {
      calls.push(`merge #${n} ${branch}`);
      if (bare) {
        sh(bare, "update-ref", "refs/heads/main", sha);
        sh(bare, "update-ref", "-d", `refs/heads/${branch}`);
      }
    },
    ...Object.fromEntries(Object.entries(over).filter(([, v]) => typeof v === "function")),
  };
  return { github, calls, pulls };
}

/** Git as a list of what was asked of it. */
function fakeGit(start: { branch?: string; changes?: FileChange[]; uncommitted?: FileChange[]; taken?: string[]; failAt?: string } = {}) {
  const calls: string[] = [];
  let branch = start.branch ?? "main";
  let committed = false;
  const changes = start.changes ?? [{ path: "site/data/hours.yml", status: "modified" as const }];
  const step = (name: string) => {
    calls.push(name);
    if (start.failAt && name.startsWith(start.failAt)) throw new Error(`${start.failAt} went wrong`);
  };
  const git: PublishGit = {
    branch: async () => branch,
    changes: async () => changes,
    uncommitted: async () => (committed ? [] : start.uncommitted ?? changes),
    branchExists: async (name) => (start.taken ?? []).includes(name),
    createBranch: async (name) => { step(`createBranch ${name}`); branch = name; },
    stage: async (paths) => step(`stage ${paths.join(" ")}`),
    commit: async (message) => { step(`commit ${message}`); committed = true; },
    head: async () => "abcd1234",
    push: async (name) => step(`push ${name}`),
    fetchMain: async () => step("fetchMain"),
    switchTo: async (name) => { step(`switchTo ${name}`); branch = name; },
    fastForwardMain: async () => step("fastForwardMain"),
    deleteBranch: async (name) => step(`deleteBranch ${name}`),
  };
  return { git, calls, where: () => branch };
}

const NOW = new Date("2026-11-20T21:14:05Z");
const quick = { now: NOW, sleep: async () => {}, pollMs: 1, patienceMs: 5 };

// ---------- strings ----------

describe("studio: both languages", () => {
  test("English and German have the same keys, and a function stays a function", () => {
    expect(Object.keys(de).sort()).toEqual(Object.keys(en).sort());
    for (const key of Object.keys(en) as (keyof typeof en)[]) expect(typeof de[key]).toBe(typeof en[key]);
  });

  test("Swiss spelling and house rules: no sharp s, no long dash, in either language", () => {
    const said = (t: typeof en) => Object.entries(t).map(([k, v]) => (typeof v !== "function" ? v : k === "d_join" ? t.d_join(["x", "y"]) : (v as (...a: any[]) => string)(2, "x"))).join("\n");
    expect(said(de)).not.toContain("ß");
    for (const text of [said(en), said(de)]) expect(text).not.toContain(String.fromCharCode(0x2014));
  });

  test("every source file of the Studio is free of the long dash, and no word is typed into the screen's code", async () => {
    const sources = ["src/studio/**/*", "app/*", "scripts/build-app.ts", "test/studio.test.ts"].flatMap((glob) => [...new Bun.Glob(glob).scanSync({ cwd: ROOT })]);
    expect(sources.length).toBeGreaterThan(15);
    for (const p of sources) expect([p, (await Bun.file(join(ROOT, p)).text()).includes(String.fromCharCode(0x2014))]).toEqual([p, false]);
    // A string literal with a space in it, handed to the element builder, would be a word typed into the screen.
    for (const p of ["src/studio/ui/main.ts", "src/studio/ui/sections.ts"]) {
      const code = (await Bun.file(join(ROOT, p)).text()).replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
      const typed = [...code.matchAll(/h\("[a-z0-9]+",\s*\{[^{}]*\},\s*"([^"]*[A-Za-z]{3,}[^"]*)"/g)].map((m) => m[1]);
      expect([p, typed]).toEqual([p, []]);
    }
  });
});

// ---------- the describer ----------

describe("studio: what a publish is called", () => {
  const c = (path: string, status: FileChange["status"] = "modified", items?: FileChange["items"]): FileChange => ({ path, status, ...(items ? { items } : {}) });

  test("one kind of change is one plain phrase", () => {
    expect(describeChanges([c("site/data/hours.yml")])).toBe("Opening hours updated");
    expect(describeChanges([c("site/data/menu.yml")])).toBe("Menu updated");
    expect(describeChanges([c("site/data/menu.yml", "added")])).toBe("Menu updated");
    expect(describeChanges([c("site/data/site.yml")])).toBe("Venue details updated");
    expect(describeChanges([c("site/data/i18n.yml")])).toBe("Labels updated");
    expect(describeChanges([c("site/content/en/index.md"), c("site/content/de/index.md")])).toBe("Page texts updated");
    expect(describeChanges([c("site/data/home.yml")])).toBe("Home page updated");
    expect(describeChanges([c("site/data/event-overrides.yml")])).toBe("Event details updated");
  });

  test("changes are combined in a fixed order, with counts", () => {
    const changes = [
      c("site/moments/2026-11-20-negroni.jpg", "added"), c("site/moments/2026-11-20-negroni.md", "added"),
      c("site/events/2026-12-02-beer-pong.md", "added"), c("site/events/2026-12-05-chess.md", "added"),
      c("site/data/hours.yml"),
    ];
    expect(describeChanges(changes)).toBe("Opening hours updated, 2 events added, 1 photo added");
    expect(describeChanges(changes, de)).toBe("Öffnungszeiten geändert, 2 Events hinzugefügt, 1 Foto hinzugefügt");
  });

  test("a photo is its picture and its text, counted once; a changed caption is an update", () => {
    expect(describeChanges([c("site/moments/a.jpg", "added"), c("site/moments/a.md", "added"), c("site/moments/b.jpg", "added"), c("site/moments/b.md", "added")])).toBe("2 photos added");
    expect(describeChanges([c("site/moments/a.md")])).toBe("1 photo updated");
    expect(describeChanges([c("site/moments/a.md", "removed"), c("site/moments/a.jpg", "removed")])).toBe("1 photo removed");
  });

  test("events added, changed and removed are told apart", () => {
    expect(describeChanges([c("site/events/a.md", "added"), c("site/events/b.md"), c("site/events/c.md", "removed")])).toBe("1 event added, 1 event updated, 1 event removed");
  });

  test("the albums file says what came and went when the server could count it", () => {
    expect(describeChanges([c("site/data/albums.yml", "modified", { added: 1, removed: 0 })])).toBe("Album added");
    expect(describeChanges([c("site/data/albums.yml", "modified", { added: 2, removed: 0 })])).toBe("2 albums added");
    expect(describeChanges([c("site/data/albums.yml", "modified", { added: 0, removed: 1 })])).toBe("Album removed");
    expect(describeChanges([c("site/data/albums.yml", "modified", { added: 0, removed: 0 })])).toBe("Albums updated");
    expect(describeChanges([c("site/data/albums.yml")])).toBe("Albums updated");
    expect(describeChanges([c("site/data/albums.yml", "modified", { added: 1, removed: 0 })], de)).toBe("Album hinzugefügt");
  });

  test("anything else still gets a line", () => {
    expect(describeChanges([c("site/events/README.md")])).toBe("1 other file changed");
    expect(describeChanges([c("site/data/hours.yml"), c("site/data/new.yml", "added"), c("site/data/other.yml")])).toBe("Opening hours updated, 2 other files changed");
    expect(describeChanges([])).toBe("");
  });

  test("the branch is edit/<date>-<slug> of the English line", () => {
    expect(branchName(NOW, "Opening hours updated, 2 events added")).toBe("edit/2026-11-20-opening-hours-updated-2-events-added");
    expect(branchName(NOW, "Menu updated", "211405")).toBe("edit/2026-11-20-menu-updated-211405");
    expect(branchName(NOW, "")).toBe("edit/2026-11-20-change");
  });
});

// ---------- history ----------

describe("studio: history", () => {
  const log = ["aaa1\x1f2026-11-20T21:00:00+01:00\x1fHarry Fuecks\x1fOpening hours updated (#21)\x1e", "bbb2\x1f2026-11-16T13:47:54+01:00\x1fElias\x1fTicker: live music, chess (and more)\x1e", ""].join("\n");

  test("git's log becomes rows, newest first as git gives them", () => {
    expect(parseHistory(log)).toEqual([
      { sha: "aaa1", date: "2026-11-20T21:00:00+01:00", who: "Harry Fuecks", what: "Opening hours updated", pull: 21 },
      { sha: "bbb2", date: "2026-11-16T13:47:54+01:00", who: "Elias", what: "Ticker: live music, chess (and more)", pull: null },
    ]);
    expect(parseHistory("")).toEqual([]);
  });

  test("at most 50 rows", () => {
    expect(parseHistory(Array.from({ length: 60 }, (_, i) => `s${i}\x1f2026-01-01T00:00:00Z\x1fA\x1fChange ${i}\x1e`).join("\n")).length).toBe(50);
  });

  test("the real command lists only commits on origin/main that touched content", async () => {
    const { root } = tinyRepo();
    writeFileSync(join(root, "README.md"), "Read me again\n");
    sh(root, "commit", "--quiet", "-am", "Code only");
    writeFileSync(join(root, "site", "data", "hours.yml"), HOURS_YML.replace("16:00", "17:00"));
    sh(root, "commit", "--quiet", "-am", "Opening hours updated (#3)");
    sh(root, "push", "--quiet", "origin", "main");
    writeFileSync(join(root, "site", "data", "hours.yml"), HOURS_YML.replace("16:00", "18:00"));
    sh(root, "commit", "--quiet", "-am", "Not on origin yet");
    const entries = await studioGit(root, { remote: "origin" }).history();
    expect(entries.map((e) => e.what)).toEqual(["Opening hours updated", "First version"]);
    expect(entries[0]).toMatchObject({ who: "Test", pull: 3 });
  });
});

// ---------- publish: the steps, with fakes ----------

describe("studio: publish steps", () => {
  test("nothing changed: refused before anything is asked of GitHub", async () => {
    const { git, calls } = fakeGit({ changes: [] });
    const gh = fakeGitHub(null);
    expect(await publish({ git, github: gh.github, report: () => {}, ...quick })).toEqual({ ok: false, reason: "nothing" });
    expect(calls).toEqual([]);
    expect(gh.calls).toEqual([]);
  });

  test("a changed file outside the edit scope: refused, nothing staged, committed or pushed", async () => {
    for (const path of ["src/render.ts", "site/data/tokens.json", "site/templates/layouts/base.liquid", ".github/workflows/deploy.yml", "package.json"]) {
      const { git, calls } = fakeGit({ changes: [{ path: "site/data/hours.yml", status: "modified" }, { path, status: "modified" }] });
      const gh = fakeGitHub(null);
      expect(await publish({ git, github: gh.github, report: () => {}, ...quick })).toEqual({ ok: false, reason: "out_of_scope", detail: path });
      expect(calls).toEqual([]);
      expect(gh.calls).toEqual([]);
    }
  });

  test("a branch that is neither main nor an edit branch: refused", async () => {
    const { git, calls } = fakeGit({ branch: "studio-core" });
    expect(await publish({ git, github: fakeGitHub(null).github, report: () => {}, ...quick })).toEqual({ ok: false, reason: "wrong_branch", detail: "studio-core" });
    expect(calls).toEqual([]);
  });

  test("a key that may not write: refused before a branch exists", async () => {
    const { git, calls } = fakeGit();
    expect(await publish({ git, github: fakeGitHub(null, { canWrite: false }).github, report: () => {}, ...quick })).toEqual({ ok: false, reason: "no_write", detail: "harryf" });
    expect(calls).toEqual([]);
  });

  test("the owner: branch, files staged by name, commit, push, pull request, check, merge, back on main", async () => {
    const changes: FileChange[] = [{ path: "site/data/hours.yml", status: "modified" }, { path: "site/events/2026-12-02-beer-pong.md", status: "added" }];
    const { git, calls, where } = fakeGit({ changes });
    const gh = fakeGitHub(null, { checks: ["waiting", "waiting", "passed"] });
    const steps: Step[] = [];
    const result = await publish({ git, github: gh.github, report: (s) => steps.push(s), ...quick, patienceMs: 1000 });
    const branch = "edit/2026-11-20-opening-hours-updated-1-event-added";
    expect(result).toEqual({ ok: true, state: "live", description: "Opening hours updated, 1 event added", pull: { number: 21, url: "https://github.example/pull/21" } });
    expect(calls).toEqual([
      `createBranch ${branch}`,
      "stage site/data/hours.yml site/events/2026-12-02-beer-pong.md",
      "commit Opening hours updated, 1 event added",
      `push ${branch}`,
      "fetchMain", "switchTo main", "fastForwardMain", `deleteBranch ${branch}`,
    ]);
    expect(gh.calls).toEqual(["access", "editorPulls", `openPull ${branch} -> main: Opening hours updated, 1 event added`, "check abcd", "check abcd", "check abcd", `merge #21 ${branch}`]);
    expect(steps).toEqual(["access", "branch", "commit", "push", "pull", "checks", "merge", "sync"]);
    expect(where()).toBe("main");
  });

  test("someone who is not the owner: it stops at the pull request and says where it is", async () => {
    const { git, calls } = fakeGit();
    const gh = fakeGitHub(null, { owner: false });
    const steps: Step[] = [];
    const result = await publish({ git, github: gh.github, report: (s) => steps.push(s), ...quick });
    expect(result).toEqual({ ok: true, state: "waiting", description: "Opening hours updated", pull: { number: 21, url: "https://github.example/pull/21" } });
    expect(steps).toEqual(["access", "branch", "commit", "push", "pull"]);
    expect(gh.calls.some((c) => c.startsWith("check") || c.startsWith("merge"))).toBe(false);
    expect(calls.some((c) => c.startsWith("switchTo") || c.startsWith("fastForward"))).toBe(false);
  });

  test("ANTI: only an edit/ branch is ever pushed, and only files inside the edit scope are staged", async () => {
    const runs = [
      fakeGit(),
      fakeGit({ changes: [{ path: "site/moments/a.jpg", status: "added" }, { path: "site/moments/a.md", status: "added" }, { path: "site/data/albums.yml", status: "modified" }] }),
      fakeGit({ branch: "edit/2026-11-19-menu-updated", uncommitted: [] }),
      fakeGit({ taken: ["edit/2026-11-20-opening-hours-updated"] }),
    ];
    for (const { git, calls } of runs) {
      await publish({ git, github: fakeGitHub(null).github, report: () => {}, ...quick });
      const pushed = calls.filter((c) => c.startsWith("push ")).map((c) => c.slice(5));
      expect(pushed.length).toBe(1);
      for (const branch of pushed) expect(branch).toMatch(/^edit\/\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/);
      expect(pushed).not.toContain("main");
      expect(pushed).not.toContain("gh-pages");
      for (const staged of calls.filter((c) => c.startsWith("stage ")).flatMap((c) => c.slice(6).split(" "))) expect([staged, inEditScope(staged)]).toEqual([staged, true]);
    }
    // A name that is taken gets the time added; it is still an edit/ branch.
    expect(runs[3]!.calls[0]).toBe("createBranch edit/2026-11-20-opening-hours-updated-211405");
  });

  test("ANTI: a file outside the scope that turns up between the first look and the commit is not staged", async () => {
    const { git, calls, where } = fakeGit({ uncommitted: [{ path: "site/data/hours.yml", status: "modified" }, { path: "src/build.ts", status: "modified" }] });
    const result = await publish({ git, github: fakeGitHub(null).github, report: () => {}, ...quick });
    expect(result).toMatchObject({ ok: false, reason: "git" });
    expect(calls.some((c) => c.startsWith("stage") || c.startsWith("commit") || c.startsWith("push"))).toBe(false);
    expect(where()).toBe("main");
  });

  test("the build check fails: no merge, the pull request is named, the work stays on its branch", async () => {
    const { git, calls, where } = fakeGit();
    const gh = fakeGitHub(null, { checks: ["waiting", "failed"] });
    const result = await publish({ git, github: gh.github, report: () => {}, ...quick, patienceMs: 1000 });
    expect(result).toEqual({ ok: false, reason: "check_failed", pull: { number: 21, url: "https://github.example/pull/21" } });
    expect(gh.calls.some((c) => c.startsWith("merge"))).toBe(false);
    expect(calls.some((c) => c.startsWith("switchTo") || c.startsWith("deleteBranch"))).toBe(false);
    expect(where()).toBe("edit/2026-11-20-opening-hours-updated");
  });

  test("the build check never answers: it gives up after the patience and merges nothing", async () => {
    const gh = fakeGitHub(null, { checks: ["waiting"] });
    const result = await publish({ git: fakeGit().git, github: gh.github, report: () => {}, ...quick });
    expect(result).toMatchObject({ ok: false, reason: "check_timeout", pull: { number: 21 } });
    expect(gh.calls.some((c) => c.startsWith("merge"))).toBe(false);
  });

  test("a failure before the commit puts the working copy back on main with its edits", async () => {
    const { git, calls, where } = fakeGit({ failAt: "commit" });
    const result = await publish({ git, github: fakeGitHub(null).github, report: () => {}, ...quick });
    expect(result).toEqual({ ok: false, reason: "git", detail: "commit went wrong" });
    expect(calls.slice(-2)).toEqual(["switchTo main", "deleteBranch edit/2026-11-20-opening-hours-updated"]);
    expect(calls.some((c) => c.startsWith("push"))).toBe(false);
    expect(where()).toBe("main");
  });

  test("a failed push keeps the commit on its branch; GitHub saying no is told in GitHub's words", async () => {
    const pushFails = fakeGit({ failAt: "push" });
    expect(await publish({ git: pushFails.git, github: fakeGitHub(null).github, report: () => {}, ...quick })).toEqual({ ok: false, reason: "git", detail: "push went wrong" });
    expect(pushFails.calls.some((c) => c.startsWith("deleteBranch") || c.startsWith("switchTo"))).toBe(false);

    const refused = fakeGitHub(null, { publish: async () => { throw new GitHubError(405, "GitHub said no (405): At least 1 approving review is required"); } });
    const { git, where } = fakeGit();
    expect(await publish({ git, github: refused.github, report: () => {}, ...quick })).toEqual({ ok: false, reason: "github", detail: "GitHub said no (405): At least 1 approving review is required", pull: { number: 21, url: "https://github.example/pull/21" } });
    expect(where()).toBe("edit/2026-11-20-opening-hours-updated");
  });

  test("publishing again after a failure carries on: same branch, same pull request, no second one", async () => {
    const branch = "edit/2026-11-20-opening-hours-updated";
    const { git, calls } = fakeGit({ branch, uncommitted: [{ path: "site/data/hours.yml", status: "modified" }] });
    const gh = fakeGitHub(null);
    gh.pulls.push({ number: 7, title: "Opening hours updated", html_url: "https://github.example/pull/7", state: "open", merged: false, head: { ref: branch, sha: "", repo: { full_name: "x/y" } }, user: { login: "harryf" } });
    const result = await publish({ git, github: gh.github, report: () => {}, ...quick });
    expect(result).toMatchObject({ ok: true, state: "live", pull: { number: 7 } });
    expect(calls.some((c) => c.startsWith("createBranch"))).toBe(false);
    expect(gh.calls.some((c) => c.startsWith("openPull"))).toBe(false);
    expect(calls).toContain(`push ${branch}`);
  });

  test("published but this Mac could not be brought back to main: said as a note, not as a failure", async () => {
    const { git } = fakeGit({ failAt: "fastForwardMain" });
    expect(await publish({ git, github: fakeGitHub(null).github, report: () => {}, ...quick })).toMatchObject({ ok: true, state: "live", syncProblem: "fastForwardMain went wrong" });
  });
});

describe("studio: the build check on GitHub", () => {
  test("no run yet or a run in progress waits; the newest run decides", () => {
    expect(checkState([])).toBe("waiting");
    expect(checkState([{ status: "in_progress", conclusion: null }])).toBe("waiting");
    expect(checkState([{ status: "completed", conclusion: "success" }])).toBe("passed");
    expect(checkState([{ status: "completed", conclusion: "failure" }])).toBe("failed");
    expect(checkState([{ status: "completed", conclusion: "failure", started_at: "2026-11-20T10:00:00Z" }, { status: "completed", conclusion: "success", started_at: "2026-11-20T11:00:00Z" }])).toBe("passed");
  });

  test("the call asks api.github.com for the `build` check with the key in the header, never in the address", async () => {
    const seen: { url: string; auth: string | null }[] = [];
    const doFetch = (async (url: string, init?: RequestInit) => {
      seen.push({ url: String(url), auth: new Headers(init?.headers).get("authorization") });
      return Response.json({ check_runs: [{ status: "completed", conclusion: "success" }] });
    }) as unknown as typeof fetch;
    expect(await studioGitHub("harryf/robins-coffee", DUMMY_TOKEN, doFetch).check("abc123")).toBe("passed");
    expect(seen).toEqual([{ url: "https://api.github.com/repos/harryf/robins-coffee/commits/abc123/check-runs?check_name=build&per_page=20", auth: `Bearer ${DUMMY_TOKEN}` }]);
  });
});

// ---------- real git ----------

describe("studio: git on a real folder", () => {
  test("name-status output is read, with spaces in names", () => {
    expect(parseNameStatus("M\0site/data/hours.yml\0A\0site/moments/a b.jpg\0D\0site/events/x.md\0")).toEqual([
      { path: "site/data/hours.yml", status: "modified" }, { path: "site/moments/a b.jpg", status: "added" }, { path: "site/events/x.md", status: "removed" },
    ]);
  });

  test("unpublished changes are the difference to origin/main: edited, new and removed files", async () => {
    const { root } = tinyRepo();
    const git = studioGit(root, { remote: "origin" });
    expect(await git.changes()).toEqual([]);
    writeFileSync(join(root, "site", "data", "hours.yml"), HOURS_YML.replace("16:00", "17:00"));
    writeFileSync(join(root, "site", "events", "2026-12-02-beer-pong.md"), "---\ntitle: Beer pong\n---\n");
    rmSync(join(root, "site", "events", "README.md"));
    expect(await git.changes()).toEqual([
      { path: "site/data/hours.yml", status: "modified" },
      { path: "site/events/2026-12-02-beer-pong.md", status: "added" },
      { path: "site/events/README.md", status: "removed" },
    ]);
  });

  test("discard puts one file back to what is live and leaves the others", async () => {
    const { root } = tinyRepo();
    const git = studioGit(root, { remote: "origin" });
    writeFileSync(join(root, "site", "data", "hours.yml"), "broken");
    writeFileSync(join(root, "site", "events", "new.md"), "new");
    rmSync(join(root, "site", "events", "README.md"));
    await git.discard("site/data/hours.yml");
    expect(readFileSync(join(root, "site", "data", "hours.yml"), "utf8")).toBe(HOURS_YML);
    expect((await git.changes()).map((c) => c.path)).toEqual(["site/events/README.md", "site/events/new.md"]);
    await git.discard("site/events/new.md");
    await git.discard("site/events/README.md");
    expect(existsSync(join(root, "site", "events", "new.md"))).toBe(false);
    expect(await git.changes()).toEqual([]);
  });

  test("a whole publish for the owner: the branch reaches the remote, main never moves by a push, and the folder ends on an up to date main", async () => {
    const { root, bare } = tinyRepo();
    const git = studioGit(root, { remote: bare });
    const mainBefore = sh(bare, "rev-parse", "refs/heads/main").trim();
    writeFileSync(join(root, "site", "data", "hours.yml"), HOURS_YML.replace("16:00", "17:00"));
    writeFileSync(join(root, "site", "events", "2026-12-02-beer-pong.md"), "---\ntitle: Beer pong\n---\n");
    let seenOnRemote = "";
    const gh = fakeGitHub(bare, { check: async () => {
      // When the check is asked for, the push has happened: the edit branch is there and main is untouched.
      seenOnRemote = sh(bare, "for-each-ref", "--format=%(refname)").trim();
      expect(sh(bare, "rev-parse", "refs/heads/main").trim()).toBe(mainBefore);
      return "passed";
    } });
    const result = await publish({ git, github: gh.github, report: () => {}, ...quick });
    expect(result).toMatchObject({ ok: true, state: "live", description: "Opening hours updated, 1 event added" });
    expect(seenOnRemote.split("\n")).toEqual(["refs/heads/edit/2026-11-20-opening-hours-updated-1-event-added", "refs/heads/main"]);
    expect(await git.branch()).toBe("main");
    expect(await git.changes()).toEqual([]);
    expect(sh(root, "status", "--porcelain")).toBe("");
    expect(sh(root, "log", "-1", "--format=%s").trim()).toBe("Opening hours updated, 1 event added");
    expect(sh(root, "show", "--name-only", "--format=", "HEAD").trim().split("\n")).toEqual(["site/data/hours.yml", "site/events/2026-12-02-beer-pong.md"]);
    expect(sh(root, "branch", "--format=%(refname:short)").trim()).toBe("main");
    expect(readFileSync(join(root, "site", "data", "hours.yml"), "utf8")).toContain("17:00");
  });

  test("a publish that fails at the check leaves the edits committed on the edit branch, and the next one finishes the job", async () => {
    const { root, bare } = tinyRepo();
    const git = studioGit(root, { remote: bare });
    writeFileSync(join(root, "site", "data", "hours.yml"), HOURS_YML.replace("16:00", "17:00"));
    const gh = fakeGitHub(bare, { checks: ["failed"] });
    expect(await publish({ git, github: gh.github, report: () => {}, ...quick })).toMatchObject({ ok: false, reason: "check_failed" });
    expect(await git.branch()).toBe("edit/2026-11-20-opening-hours-updated");
    expect(readFileSync(join(root, "site", "data", "hours.yml"), "utf8")).toContain("17:00");
    expect((await git.changes()).map((c) => c.path)).toEqual(["site/data/hours.yml"]);

    writeFileSync(join(root, "site", "data", "hours.yml"), HOURS_YML.replace("16:00", "18:00"));
    const second = fakeGitHub(bare);
    second.pulls.push(...gh.pulls);
    expect(await publish({ git, github: second.github, report: () => {}, ...quick })).toMatchObject({ ok: true, state: "live", pull: { number: 21 } });
    expect(second.calls.some((c) => c.startsWith("openPull"))).toBe(false);
    expect(await git.branch()).toBe("main");
    expect(readFileSync(join(root, "site", "data", "hours.yml"), "utf8")).toContain("18:00");
    expect(await git.changes()).toEqual([]);
  });

  test("the real push refuses main and gh-pages by itself", async () => {
    const { root, bare } = tinyRepo();
    const git = studioGit(root, { remote: bare });
    for (const name of ["main", "gh-pages", "edit", "feature/x"]) expect(git.push(name)).rejects.toThrow("refusing to push");
  });

  test("the key reaches git through its environment only: never in a command line, never in an address", async () => {
    const { root, bare } = tinyRepo();
    const dir = temp();
    const log = join(dir, "git.log");
    const shim = join(dir, "git-shim");
    writeFileSync(shim, `#!/bin/sh\n{ printf 'ARGV'; for a in "$@"; do printf ' %s' "$a"; done; printf '\\n'; env | grep '^GIT_CONFIG' || true; printf 'END\\n'; } >> "${log}"\nexec git "$@"\n`);
    chmodSync(shim, 0o755);
    const git = studioGit(root, { remote: bare, bin: shim, token: async () => DUMMY_TOKEN });
    writeFileSync(join(root, "site", "data", "hours.yml"), HOURS_YML.replace("16:00", "17:00"));
    expect(await publish({ git, github: fakeGitHub(bare).github, report: () => {}, ...quick })).toMatchObject({ ok: true });

    const encoded = btoa(`x-access-token:${DUMMY_TOKEN}`);
    const records = readFileSync(log, "utf8").split("END\n").filter(Boolean).map((r) => ({ argv: r.split("\n")[0]!, env: r.split("\n").slice(1).join("\n") }));
    expect(records.length).toBeGreaterThan(8);
    for (const r of records) {
      expect(r.argv).not.toContain(DUMMY_TOKEN);
      expect(r.argv).not.toContain(encoded);
      expect(r.argv).not.toContain("@");
    }
    const talksToRemote = (argv: string) => /^ARGV (push|fetch|ls-remote) /.test(argv);
    const remote = records.filter((r) => talksToRemote(r.argv));
    expect(remote.map((r) => r.argv.split(" ")[1])).toEqual(["ls-remote", "push", "fetch"]);
    for (const r of remote) expect(r.env).toContain(`GIT_CONFIG_VALUE_0=Authorization: Basic ${encoded}`);
    for (const r of records.filter((x) => !talksToRemote(x.argv))) expect(r.env).toBe("");
    expect(remote.find((r) => r.argv.startsWith("ARGV push"))!.argv).toBe(`ARGV push --quiet ${bare} refs/heads/edit/2026-11-20-opening-hours-updated:refs/heads/edit/2026-11-20-opening-hours-updated`);
    // And the header is only ever offered to github.com.
    expect(authEnv(DUMMY_TOKEN).GIT_CONFIG_KEY_0).toBe("http.https://github.com/.extraHeader");
    expect(authEnv(null)).toEqual({ GIT_TERMINAL_PROMPT: "0" });
  });
});

// ---------- who may call, what may be written ----------

describe("studio: the guard", () => {
  const self = { port: 4750, token: "t".repeat(72) };
  const req = (headers: Record<string, string>, method = "PUT") => new Request("http://127.0.0.1:4750/_studio/api/file", { method, headers });

  test("the server's own Host, the server's own Origin if any, and this run's token", () => {
    expect(refuseApi(req({ host: "127.0.0.1:4750", origin: "http://127.0.0.1:4750", [TOKEN_HEADER]: self.token }), self)).toBe(null);
    expect(refuseApi(req({ host: "127.0.0.1:4750", [TOKEN_HEADER]: self.token }), self)).toBe(null);
    expect(refuseApi(req({ host: "127.0.0.1:4750", origin: "https://evil.example", [TOKEN_HEADER]: self.token }), self)).toBe("origin");
    expect(refuseApi(req({ host: "127.0.0.1:4750", origin: "http://localhost:4750", [TOKEN_HEADER]: self.token }), self)).toBe("origin");
    expect(refuseApi(req({ host: "127.0.0.1:4750", origin: "null", [TOKEN_HEADER]: self.token }), self)).toBe("origin");
    expect(refuseApi(req({ host: "evil.example:4750", [TOKEN_HEADER]: self.token }), self)).toBe("host");
    expect(refuseApi(req({ host: "localhost:4750", [TOKEN_HEADER]: self.token }), self)).toBe("host");
    expect(refuseApi(req({ host: "127.0.0.1:4750", origin: "http://127.0.0.1:4750" }), self)).toBe("token");
    expect(refuseApi(req({ host: "127.0.0.1:4750", [TOKEN_HEADER]: "x".repeat(72) }), self)).toBe("token");
    expect(refuseApi(req({ host: "127.0.0.1:4750", [TOKEN_HEADER]: self.token }, "GET"), self)).toBe(null);
  });

  test("a write path must be inside the edit scope and written plainly", () => {
    for (const ok of ["site/data/hours.yml", "site/moments/2026-11-20-negroni.jpg", "site/events/2026-12-02-beer-pong.md", "site/content/en/index.md", "site/data/menu.yml"]) expect(safeEditPath(ok)).toBe(ok);
    for (const bad of ["site/data/tokens.json", "package.json", "src/build.ts", "site/templates/layouts/base.liquid", ".git/config", "site/data/../../package.json", "site/content/../../.env", "site/moments/../templates/x.liquid", "/etc/hosts", "site/data//hours.yml", "site/data/./hours.yml", "site\\data\\hours.yml", "site/data/hours.yml\0.jpg", "", null, 7, "site/data/sub/hours.yml"]) expect([bad, safeEditPath(bad)]).toEqual([bad, null]);
  });

  test("a preview address never leaves the preview folder", () => {
    expect(previewFile("/")).toBe("index.html");
    expect(previewFile("/de/")).toBe("de/index.html");
    expect(previewFile("/assets/site.css")).toBe("assets/site.css");
    for (const bad of ["/../package.json", "/%2e%2e/%2e%2e/etc/hosts", "/a/..%2f..%2fb", "/%00", "/%zz"]) expect([bad, previewFile(bad)]).toEqual([bad, null]);
  });
});

// ---------- keychain ----------

describe("studio: keys", () => {
  test("a key is one line without spaces", () => {
    expect(validKey("example-key-with_40.printable-characters")).toBe(true);
    for (const bad of ["", "short", "two words here", "line\nbreak12345", "tab\there12345"]) expect(validKey(bad)).toBe(false);
  });

  test.skipIf(process.platform !== "darwin")("the macOS Keychain keeps a dummy key under a test service, says only that it is there, and forgets it again", async () => {
    const keys = keychain("robins-studio-test-dummy");
    const dummy = "dummy-not-a-real-key-0123456789";
    await keys.remove("github");
    try {
      expect(await keys.has("github")).toBe(false);
      expect(await keys.read("github")).toBe(null);
      await keys.save("github", dummy);
      expect(await keys.has("github")).toBe(true);
      expect(await keys.read("github")).toBe(dummy);
      expect(await keys.has("eventfrog")).toBe(false);
      await keys.save("github", dummy + "-2");
      expect(await keys.read("github")).toBe(dummy + "-2");
    } finally {
      await keys.remove("github");
    }
    expect(await keys.has("github")).toBe(false);
  });
});

// ---------- the server, for real, on a copy of this site ----------

describe("studio: the server", () => {
  const FEED = join(ROOT, "test", "fixtures", "iyf-events.json");
  const stored = new Map<string, string>();
  const keys: Keychain = {
    has: async (name) => stored.has(name),
    read: async (name) => stored.get(name) ?? null,
    save: async (name, value) => void stored.set(name, value),
    remove: async (name) => void stored.delete(name),
  };
  const opened: string[] = [];
  let studio: Awaited<ReturnType<typeof startStudio>>;
  let root = "";
  let bare = "";
  let at = "";
  let gh = fakeGitHub(null);

  const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
    fetch(`${at}/_studio/api/${path}`, { method, headers: { [TOKEN_HEADER]: studio.token, ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const state = async () => (await (await call("GET", "state")).json()) as StudioState;
  const hoursFile = () => readFileSync(join(root, "site", "data", "hours.yml"), "utf8");
  /** Opens the event stream and resolves when the named event arrives. */
  function nextEvent(name: string, ms = 30_000): Promise<boolean> {
    const stop = new AbortController();
    return (async () => {
      const res = await fetch(`${at}/_studio/events`, { signal: stop.signal });
      const reader = res.body!.getReader();
      const timer = setTimeout(() => stop.abort(), ms);
      let text = "";
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) return false;
          text += new TextDecoder().decode(value);
          if (text.includes(`event: ${name}\n`)) return true;
        }
      } catch {
        return false;
      } finally {
        clearTimeout(timer);
        stop.abort();
      }
    })();
  }

  beforeAll(async () => {
    // A copy of the site as it is in this folder, as its own repository with its own "GitHub".
    ({ root, bare } = repoWithRemote((to) => {
      const list = Bun.spawnSync(["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: ROOT }).stdout.toString().split("\0").filter(Boolean);
      for (const p of list) {
        // A nested working folder of git shows up here as a directory, not a file: it is not part of the site.
        if (!existsSync(join(ROOT, p)) || statSync(join(ROOT, p)).isDirectory()) continue;
        mkdirSync(dirname(join(to, p)), { recursive: true });
        cpSync(join(ROOT, p), join(to, p));
      }
      symlinkSync(join(ROOT, "node_modules"), join(to, "node_modules"));
      mkdirSync(join(ROOT, ".cache", "photos"), { recursive: true });
      mkdirSync(join(to, ".cache"));
      symlinkSync(join(ROOT, ".cache", "photos"), join(to, ".cache", "photos"));
    }));
    gh = fakeGitHub(bare);
    studio = await startStudio({ root, port: 0, events: FEED, remote: bare, keys, github: () => gh.github, open: (url) => void opened.push(url) });
    at = `http://127.0.0.1:${studio.port}`;
    await studio.firstBuild;
    await studio.settled();
  }, 120_000);

  afterAll(async () => {
    await studio?.stop();
  });

  test("one server: the editing screen under /_studio/ and the preview at /", async () => {
    const screen = await fetch(`${at}/_studio/`);
    expect(screen.status).toBe(200);
    const html = await screen.text();
    expect(html).toContain(`<meta name="studio-token" content="${studio.token}">`);
    const home = await fetch(`${at}/`);
    expect(home.status).toBe(200);
    expect(await home.text()).toContain("ROBIN");
    expect((await fetch(`${at}/de/`)).status).toBe(200);
    expect((await fetch(`${at}/assets/site.css`)).headers.get("content-type")).toContain("text/css");
    const missing = await fetch(`${at}/no-such-page/`);
    expect(missing.status).toBe(404);
    expect((await fetch(`${at}/_studio/app.js`)).status).toBe(200);
  });

  test("the editing screen is its own app: no site header, footer or stylesheet, and its colours come from tokens.json", async () => {
    const html = await (await fetch(`${at}/_studio/`)).text();
    expect(html).not.toContain("site.css");
    expect(html).not.toMatch(/<header|<footer|site-header|site-footer/);
    const css = await (await fetch(`${at}/_studio/app.css`)).text();
    const tokens = JSON.parse(readFileSync(join(root, "site", "data", "tokens.json"), "utf8"));
    expect(css).toContain(`--c-bg: ${tokens.color.night.bg};`);
    expect(css).toContain(`@media (max-width: ${tokens.breakpoint.xl})`);
    expect(css).not.toMatch(/breakpoint\(/);
    // The Studio's own stylesheet types no colour and no font size.
    const own = readFileSync(join(ROOT, "src", "studio", "ui", "studio.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(own.match(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/gi)).toBe(null);
    expect([...own.matchAll(/font-size:\s*([^;]+)/g)].map((m) => m[1]!).filter((v) => !/^(var\(--size-[a-z]+\)|100%)$/.test(v))).toEqual([]);
    expect((await fetch(`${at}/_studio/fonts/dm-sans.woff2`)).status).toBe(200);
  });

  test("the reload script is added to served pages only, never to a built file, and carries no token", async () => {
    const served = await (await fetch(`${at}/`)).text();
    expect(served).toContain(RELOAD_SCRIPT);
    expect(served).not.toContain(studio.token);
    expect((await (await fetch(`${at}/no-such-page/`)).text())).toContain(RELOAD_SCRIPT);
    for (const p of new Bun.Glob("**/*.html").scanSync({ cwd: join(root, ".cache", "studio", "preview") })) expect([p, readFileSync(join(root, ".cache", "studio", "preview", p), "utf8").includes("/_studio/events")]).toEqual([p, false]);
    expect(await (await fetch(`${at}/assets/js/site.js`)).text()).not.toContain("/_studio/");
  });

  test("ANTI: it listens on 127.0.0.1 only", async () => {
    const outside = Object.values(networkInterfaces()).flat().find((n) => n && n.family === "IPv4" && !n.internal)?.address;
    if (!outside) return;
    const reached = await fetch(`http://${outside}:${studio.port}/`, { signal: AbortSignal.timeout(1500) }).then(() => true, () => false);
    expect(reached).toBe(false);
  });

  test("ANTI: a write with a foreign Origin, a foreign Host, the preview's name or no token gets 403 and changes nothing", async () => {
    const before = hoursFile();
    const body = { path: "site/data/hours.yml", text: "hacked: true\n" };
    const tries: [string, Record<string, string>][] = [
      ["foreign origin", { Origin: "https://evil.example" }],
      ["the preview's origin", { Origin: `http://localhost:${studio.port}` }],
      ["opaque origin", { Origin: "null" }],
      ["no token", { [TOKEN_HEADER]: "" }],
      ["wrong token", { [TOKEN_HEADER]: "0".repeat(studio.token.length) }],
      ["foreign host", { Host: "evil.example" }],
      ["the preview's host", { Host: `localhost:${studio.port}` }],
    ];
    for (const [name, headers] of tries) {
      for (const [method, path, payload] of [["PUT", "file", body], ["PUT", "hours", { week: {} }], ["POST", "discard", { path: body.path }], ["POST", "publish", undefined], ["PUT", "keys/github", { value: DUMMY_TOKEN }], ["POST", "open", { path: "/" }], ["GET", "state", undefined]] as const) {
        const res = await call(method, path, payload, headers);
        expect([name, method, path, res.status]).toEqual([name, method, path, 403]);
      }
    }
    expect(hoursFile()).toBe(before);
    expect(stored.size).toBe(0);
    expect(opened).toEqual([]);
    // The screen itself is not handed out under the preview's name either, so a preview page cannot read the token.
    expect((await fetch(`${at}/_studio/`, { headers: { Host: `localhost:${studio.port}` } })).status).toBe(403);
    expect((await fetch(`${at}/`, { headers: { Host: `localhost:${studio.port}` } })).status).toBe(200);
    expect((await fetch(`${at}/`, { headers: { Host: "evil.example" } })).status).toBe(403);
  });

  test("ANTI: a write outside the edit scope or with a climbing path is refused", async () => {
    for (const path of ["package.json", "src/build.ts", "site/data/tokens.json", "site/templates/layouts/base.liquid", "site/data/../../package.json", "site/content/../../outside.txt", "/tmp/outside.txt", ".git/hooks/pre-commit"]) {
      const res = await call("PUT", "file", { path, text: "nope\n" });
      expect([path, res.status]).toEqual([path, 403]);
      expect([path, (await call("GET", `file?path=${encodeURIComponent(path)}`)).status]).toEqual([path, 403]);
      expect([path, (await call("POST", "discard", { path })).status]).toEqual([path, 403]);
    }
    expect(sh(root, "status", "--porcelain")).toBe("");
    expect(existsSync(join(dirname(root), "outside.txt"))).toBe(false);
  });

  test("a saved change to the hours rewrites hours.yml by the editor's rules, rebuilds the preview and tells open tabs to reload", async () => {
    const hours = await (await call("GET", "hours")).json();
    expect(hours.editable).toBe(true);
    expect(await (await fetch(`${at}/`)).text()).not.toContain("11:35");
    const reload = nextEvent("reload");
    await Bun.sleep(100);
    const res = await call("PUT", "hours", { week: { ...hours.week, su: { closed: false, open: "11:35", close: "22:00" } } });
    expect(res.status).toBe(200);
    expect(hoursFile()).toContain('open: "11:35"');
    expect(hoursFile().startsWith("# Opening hours.")).toBe(true);
    expect(await reload).toBe(true);
    await studio.settled();
    expect(await (await fetch(`${at}/`)).text()).toContain("11:35");
    const now = await state();
    expect(now.build.status).toBe("ok");
    expect(now.changes).toEqual([{ path: "site/data/hours.yml", status: "modified", publishable: true }]);
  }, 60_000);

  test("hours the editor's rules refuse are not written, and the reason comes in the screen's language", async () => {
    const before = hoursFile();
    const hours = await (await call("GET", "hours")).json();
    const bad = { ...hours.week, tu: { closed: false, open: "16:00", close: "16:00" } };
    const res = await call("PUT", "hours", { week: bad, lang: "de" });
    expect(res.status).toBe(422);
    expect((await res.json()).problems).toEqual(["tu: Öffnungs- und Schliesszeit sind gleich"]);
    expect((await (await call("PUT", "hours", { week: bad })).json()).problems).toEqual(["tu: opening and closing time are the same"]);
    expect((await call("PUT", "hours", { week: { mo: {} } })).status).toBe(400);
    expect(hoursFile()).toBe(before);
  });

  test.skipIf(process.platform !== "darwin")("a change made by hand on disk rebuilds and reloads too", async () => {
    const reload = nextEvent("reload");
    await Bun.sleep(100);
    writeFileSync(join(root, "site", "data", "hours.yml"), hoursFile().replace("11:35", "11:40"));
    expect(await reload).toBe(true);
    await studio.settled();
    expect(await (await fetch(`${at}/`)).text()).toContain("11:40");
  }, 60_000);

  test("a build that fails is reported and the last good preview stays; discarding the file mends it", async () => {
    const good = await (await fetch(`${at}/`)).text();
    const failed = nextEvent("state");
    expect((await call("PUT", "file", { path: "site/data/home.yml", text: "sections: [no-such-section\n" })).status).toBe(200);
    await failed;
    await studio.settled();
    const broken = await state();
    expect(broken.build.status).toBe("failed");
    // What went wrong and where, without the stack of the program that noticed.
    expect(broken.build.log).toContain("YAMLParseError");
    expect(broken.build.log).toContain("sections: [no-such-section");
    expect(broken.build.log).not.toMatch(/node_modules|^\s*at /m);
    const still = await fetch(`${at}/`);
    expect(still.status).toBe(200);
    expect(await still.text()).toBe(good);
    // And what does not build is not published.
    stored.set("github", DUMMY_TOKEN);
    expect((await call("POST", "publish")).status).toBe(409);
    expect((await state()).publish.result).toEqual({ ok: false, reason: "build" });
    stored.clear();
    expect(gh.calls).toEqual([]);

    expect((await call("POST", "discard", { path: "site/data/home.yml" })).status).toBe(200);
    await studio.settled();
    const mended = await state();
    expect(mended.build.status).toBe("ok");
    expect(mended.changes.map((c) => c.path)).toEqual(["site/data/hours.yml"]);
  }, 60_000);

  test("a changed file outside the content folders is listed as not publishable", async () => {
    writeFileSync(join(root, "README.md"), readFileSync(join(root, "README.md"), "utf8") + "\nlocal note\n");
    const now = await state();
    expect(now.changes.find((c) => c.path === "README.md")).toEqual({ path: "README.md", status: "modified", publishable: false });
    await call("POST", "publish");
    expect(await studio.published()).toEqual({ ok: false, reason: "no_key" });
    stored.set("github", DUMMY_TOKEN);
    await call("POST", "publish");
    expect(await studio.published()).toEqual({ ok: false, reason: "out_of_scope", detail: "README.md" });
    stored.clear();
    sh(root, "checkout", "--", "README.md");
    expect(gh.calls).toEqual([]);
  });

  test("keys: the screen learns only saved or not saved, and no answer ever holds the value", async () => {
    expect((await state()).keys).toEqual({ github: false, eventfrog: false });
    const saved = await call("PUT", "keys/github", { value: `  ${DUMMY_TOKEN}\n` });
    expect(saved.status).toBe(200);
    const answer = await saved.text();
    expect(JSON.parse(answer)).toEqual({ ok: true, saved: true });
    expect(stored.get("github")).toBe(DUMMY_TOKEN);
    const all = JSON.stringify(await state());
    expect(JSON.parse(all).keys).toEqual({ github: true, eventfrog: false });
    for (const text of [answer, all, await (await fetch(`${at}/_studio/`)).text(), await (await call("GET", "history")).text()]) expect(text).not.toContain(DUMMY_TOKEN);
    expect((await call("GET", "keys/github")).status).toBe(404);
    expect((await call("GET", "keys")).status).toBe(404);
    expect((await call("PUT", "keys/github", { value: "two words" })).status).toBe(422);
    expect((await call("PUT", "keys/other", { value: DUMMY_TOKEN })).status).toBe(404);
    expect((await (await call("PUT", "keys/eventfrog", { value: "dummy-eventfrog-key-123" })).json()).saved).toBe(true);
    expect((await (await call("DELETE", "keys/eventfrog")).json()).saved).toBe(false);
    // Nothing of it in the working copy either.
    expect(Bun.spawnSync(["grep", "-rIl", "--exclude-dir=node_modules", "--exclude-dir=.git", DUMMY_TOKEN, root]).stdout.toString()).toBe("");
  });

  test("the preview button opens the preview's own address and nothing else", async () => {
    expect((await call("POST", "open", { path: "/" })).status).toBe(200);
    expect((await call("POST", "open", { path: "/de/" })).status).toBe(200);
    expect(opened).toEqual([`http://localhost:${studio.port}/`, `http://localhost:${studio.port}/de/`]);
    for (const path of ["//evil.example/", "https://evil.example/", "\\\\evil"]) expect((await call("POST", "open", { path })).status).toBe(400);
    expect(opened.length).toBe(2);
  });

  test("history comes from git, newest first", async () => {
    const { entries } = await (await call("GET", "history")).json();
    expect(entries).toEqual([{ sha: sh(root, "rev-parse", "origin/main").trim(), date: expect.any(String), who: "Test", what: "First version", pull: null }]);
  });

  test("Publish from the screen: the change goes out on an edit/ branch, is merged, and the folder is back on main with nothing left to publish", async () => {
    expect((await state()).changes.map((c) => c.path)).toEqual(["site/data/hours.yml"]);
    const res = await call("POST", "publish");
    expect(res.status).toBe(202);
    const result = await studio.published();
    expect(result).toMatchObject({ ok: true, state: "live", description: "Opening hours updated", pull: { number: 21 } });
    const after = await state();
    expect(after.publish.steps).toEqual(["access", "branch", "commit", "push", "pull", "checks", "merge", "sync"]);
    expect(after.branch).toBe("main");
    expect(after.changes).toEqual([]);
    expect(gh.calls.at(-1)).toMatch(/^merge #21 edit\/\d{4}-\d{2}-\d{2}-opening-hours-updated$/);
    expect(sh(bare, "log", "-1", "--format=%s", "main").trim()).toBe("Opening hours updated");
    // 11:40 where the hand edit test ran before this one (macOS), 11:35 where it is skipped.
    expect(hoursFile()).toMatch(/11:(35|40)/);
    const { entries } = await (await call("GET", "history")).json();
    expect(entries.map((e: { what: string }) => e.what)).toEqual(["Opening hours updated", "First version"]);
    expect(JSON.stringify(after)).not.toContain(DUMMY_TOKEN);
  }, 60_000);
});

describe("studio: the command", () => {
  test("a taken port is said plainly and the command ends", async () => {
    const holder = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("taken") });
    try {
      const run = Bun.spawnSync([process.execPath, join("src", "studio", "server.ts"), "--port", String(holder.port), "--offline"], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
      expect(run.exitCode).toBe(1);
      expect(run.stderr.toString()).toContain(`Port ${holder.port} on 127.0.0.1 is taken`);
    } finally {
      await holder.stop(true);
    }
  }, 30_000);

  test("it stops when its standard input closes, which is how the app lets go of it", async () => {
    const port = 20000 + Math.floor(Math.random() * 20000);
    const proc = Bun.spawn([process.execPath, join("src", "studio", "server.ts"), "--port", String(port), "--lifeline", "--offline", "--events", join("test", "fixtures", "iyf-events.json")], { cwd: ROOT, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    let up = false;
    for (let i = 0; i < 100 && !up; i++) {
      await Bun.sleep(100);
      up = await fetch(`http://127.0.0.1:${port}/_studio/`).then((r) => r.status === 200, () => false);
    }
    expect(up).toBe(true);
    proc.stdin.end();
    expect(await Promise.race([proc.exited, Bun.sleep(10_000).then(() => "still running")])).toBe(0);
    expect(await fetch(`http://127.0.0.1:${port}/_studio/`).then(() => true, () => false)).toBe(false);
  }, 40_000);
});
