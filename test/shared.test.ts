// The helpers the Studio shares with the build and CI: the hours form, slugs, the edit
// scope, the GitHub calls of Publish. Also the note left at /edit/ for phones that had
// the retired phone editor installed.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { renderSite, hoursRows, type Files, type Photo } from "../src/render";
import { DAYS, weekFromYaml, weekToYaml, validateWeek, hoursEditable, type Week } from "../src/hours";
import { slugify } from "../src/slug";
import { inEditScope } from "../src/scope";
import { github, GitHubError } from "../src/github";
import { outOfScope } from "../scripts/check-edit-scope";

import { FROZEN_SITE } from "./frozen";
const SITE = FROZEN_SITE;
const ROOT = join(import.meta.dir, "..");
const files: Files = {};
for (const p of new Bun.Glob("**/*.{md,yml,json,liquid}").scanSync({ cwd: SITE })) files[p] = await Bun.file(join(SITE, p)).text();
const photoPaths = [...new Bun.Glob("{moments,photos}/*.jpg").scanSync({ cwd: SITE })];
const photos: Record<string, Photo> = Object.fromEntries(photoPaths.map((p) => [p, { width: 1200, height: 800, jpg: [{ w: 480, path: "photos/x-480.jpg" }], webp: [{ w: 480, path: "photos/x-480.webp" }] }]));
const hoursYml = files["data/hours.yml"]!;

describe("opening hours form", () => {
  test("the week read from hours.yml has one entry per day", () => {
    const week = weekFromYaml(hoursYml);
    expect(Object.keys(week)).toEqual([...DAYS]);
    expect(week.fr).toEqual({ closed: false, open: "16:00", close: "02:00" });
  });

  test("writing the same week back changes nothing a reader would see, and keeps comments and exceptions", () => {
    const again = weekToYaml(hoursYml, weekFromYaml(hoursYml));
    expect(parseYaml(again)).toEqual(parseYaml(hoursYml));
    expect(again).toContain("# Dated exceptions");
    expect(again.startsWith("# Opening hours.")).toBe(true);
  });

  test("a changed day, a closed day and until late are written, grouped like a person would", () => {
    const week: Week = { ...weekFromYaml(hoursYml), mo: { closed: true, open: "16:00", close: "00:00" }, su: { closed: false, open: "11:00", close: null } };
    const data = parseYaml(weekToYaml(hoursYml, week));
    expect(data.regular[0]).toEqual({ days: ["mo"], closed: true });
    expect(data.regular[1]).toEqual({ days: ["tu", "we", "th"], open: "16:00", close: "00:00" });
    expect(data.regular.at(-1)).toEqual({ days: ["su"], open: "11:00", close: null });
    expect(data.exceptions).toEqual([]);
    const rows = hoursRows(data, parseYaml(files["data/i18n.yml"]!).en);
    expect(rows[0]).toMatchObject({ label: "Mon", closed: true });
  });

  test("the site still builds with the edited hours and shows them", async () => {
    const week: Week = { ...weekFromYaml(hoursYml), su: { closed: false, open: "11:30", close: "22:00" } };
    const pages = await renderSite({ ...files, "data/hours.yml": weekToYaml(hoursYml, week) }, { base: "/", photos });
    expect(pages.find((p) => p.out === "index.html")!.html).toContain("11:30");
  });

  test("a bad time is refused in plain English", () => {
    const week: Week = { ...weekFromYaml(hoursYml), tu: { closed: false, open: "25:00", close: "25:00" }, we: { closed: false, open: "16:00", close: "16:00" }, th: { closed: false, open: "16:00", close: "2:00" } };
    expect(validateWeek(week)).toEqual([
      "tu: the opening time must look like 16:00",
      "tu: the closing time must look like 23:30, or be left empty for \"until late\"",
      "tu: opening and closing time are the same",
      "we: opening and closing time are the same",
      "th: the closing time must look like 23:30, or be left empty for \"until late\"",
    ]);
    expect(validateWeek(weekFromYaml(hoursYml))).toEqual([]);
  });

  test("the form refuses a file it could not write back whole", () => {
    expect(hoursEditable(hoursYml)).toBe(true);
    // two time spans on one day
    expect(hoursEditable('regular:\n  - days: [mo]\n    open: "11:00"\n    close: "14:00"\n  - days: [mo, tu, we, th, fr, sa, su]\n    open: "17:00"\n    close: "23:00"\nexceptions: []\n')).toBe(false);
    // a key the form has no field for
    expect(hoursEditable('regular:\n  - days: [mo, tu, we, th, fr, sa, su]\n    open: "17:00"\n    close: "23:00"\n    note: "kitchen until 22"\nexceptions: []\n')).toBe(false);
    // a comment at the left edge inside the block, which the rewrite would stop at
    expect(hoursEditable('regular:\n  - days: [mo, tu]\n    open: "17:00"\n    close: "23:00"\n# weekend\n  - days: [we, th, fr, sa, su]\n    open: "10:00"\n    close: "23:00"\nexceptions: []\n')).toBe(false);
    // no line break at the end, with regular: last
    expect(hoursEditable('exceptions: []\nregular:\n  - days: [mo, tu, we, th, fr, sa, su]\n    open: "17:00"\n    close: "23:00"')).toBe(false);
    // a time the form's fields cannot hold
    expect(hoursEditable('regular:\n  - days: [mo, tu, we, th, fr, sa, su]\n    open: "17:00"\n    close: "24:00"\nexceptions: []\n')).toBe(false);
    expect(hoursEditable("not: [yaml")).toBe(false);
  });
});

describe("slugs", () => {
  test("a caption becomes a file name in plain letters", () => {
    expect(slugify("Friday crowd, Zürich!")).toBe("friday-crowd-zuerich");
    expect(slugify("  Größe & Maß  ")).toBe("groesse-mass");
    expect(slugify("Café Crème")).toBe("cafe-creme");
    expect(slugify("x".repeat(80)).length).toBe(40);
  });
});

describe("what a change may touch", () => {
  test("content, moments, events and data are in; tokens, templates, code and workflows are out", () => {
    for (const p of ["site/data/hours.yml", "site/moments/2026-11-20-x.jpg", "site/moments/2026-11-20-x.md", "site/content/de/index.md", "site/events/2026-12-01-x.md"]) expect([p, inEditScope(p)]).toEqual([p, true]);
    for (const p of ["site/data/tokens.json", "site/templates/layouts/base.liquid", "site/assets/js/site.js", "src/render.ts", ".github/workflows/deploy.yml", "package.json", "site/data/../templates/x.liquid", "CLAUDE.md"]) expect([p, inEditScope(p)]).toEqual([p, false]);
  });

  test("the CI guard names every file outside that reach", () => {
    expect(outOfScope(["site/data/hours.yml", "", "src/build.ts", " .github/workflows/preview.yml "])).toEqual(["src/build.ts", ".github/workflows/preview.yml"]);
  });

  test("the scope rule imports nothing, so CI can run the base branch's copy before installing", async () => {
    expect(await Bun.file(join(ROOT, "src", "scope.ts")).text()).not.toMatch(/^import /m);
    const guard = await Bun.file(join(ROOT, "scripts", "check-edit-scope.ts")).text();
    expect([...guard.matchAll(/^import .* from "(.*)";$/gm)].map((m) => m[1])).toEqual(["../src/scope"]);
  });
});

describe("GitHub calls of Publish", () => {
  type Call = { method: string; url: string; auth: string | null; body: any };
  const fake = (answers: Record<string, any>) => {
    const calls: Call[] = [];
    const doFetch = (async (url: string, init: any) => {
      calls.push({ method: init.method, url, auth: init.headers.Authorization ?? null, body: init.body ? JSON.parse(init.body) : null });
      const key = Object.keys(answers).find((k) => `${init.method} ${url}`.startsWith(k));
      const a = key ? answers[key] : { status: 404, body: { message: "Not Found" } };
      return new Response(typeof a.body === "string" ? a.body : JSON.stringify(a.body ?? {}), { status: a.status ?? 200 });
    }) as unknown as typeof fetch;
    return { calls, doFetch };
  };
  const R = "https://api.github.com/repos/o/r";

  test("access says who and whether they may write; a bad token is said plainly", async () => {
    const ok = fake({ "GET https://api.github.com/user": { body: { login: "elias" } }, [`GET ${R}`]: { body: { permissions: { push: true } } } });
    expect(await github("o/r", "t", ok.doFetch).access()).toEqual({ login: "elias", canWrite: true, owner: false });
    expect(ok.calls.every((c) => c.auth === "Bearer t" && c.url.startsWith("https://api.github.com/") && !c.url.includes("Bearer"))).toBe(true);
    const bad = fake({ "GET https://api.github.com/user": { status: 401, body: { message: "Bad credentials" } } });
    const err = await github("o/r", "t", bad.doFetch).access().catch((e) => e);
    expect(err).toBeInstanceOf(GitHubError);
    expect(err.status).toBe(401);
    expect(err.message).toContain("did not accept the token");
  });

  test("open edit pulls are the edit/ branches of this repository, never a fork's; without a token no Authorization header is sent", async () => {
    const { calls, doFetch } = fake({ [`GET ${R}/pulls`]: { body: [{ number: 1, head: { ref: "edit/a/b", repo: { full_name: "o/r" } } }, { number: 2, head: { ref: "milestone-9", repo: { full_name: "o/r" } } }, { number: 3, head: { ref: "edit/x/y", repo: { full_name: "stranger/r" } } }] } });
    expect((await github("o/r", null, doFetch).editPulls()).map((p) => p.number)).toEqual([1]);
    expect(calls.every((c) => c.auth === null)).toBe(true);
  });

  test("a pull request is opened from the branch into the base", async () => {
    const { calls, doFetch } = fake({ [`POST ${R}/pulls`]: { status: 201, body: { number: 9 } } });
    expect((await github("o/r", "t", doFetch).openPull("edit/a/b", "main", "Title", "Body")).number).toBe(9);
    expect(calls[0]!.body).toEqual({ head: "edit/a/b", base: "main", title: "Title", body: "Body" });
  });

  test("publish squashes exactly the commit that was published, then removes the branch; a refusal from GitHub carries its reason", async () => {
    const { calls, doFetch } = fake({ [`PUT ${R}/pulls/7/merge`]: { body: { merged: true } }, [`DELETE ${R}/git/refs/heads/edit/a/b`]: { status: 204, body: "" } });
    await github("o/r", "t", doFetch).publish(7, "edit/a/b", "SEEN");
    expect(calls[0]!.body).toEqual({ merge_method: "squash", sha: "SEEN" });
    expect(calls[1]!.method + " " + calls[1]!.url).toBe(`DELETE ${R}/git/refs/heads/edit/a/b`);
    const no = fake({ [`PUT ${R}/pulls/7/merge`]: { status: 405, body: { message: "Required status check \"build\" is expected." } } });
    const err = await github("o/r", "t", no.doFetch).publish(7, "edit/a/b", "SEEN").catch((e) => e);
    expect(err.message).toContain("Required status check");
  });
});

describe("the retired phone editor", () => {
  test("/edit/ is a short note in English and German with a link to the Studio's install page, noindex and out of the sitemap", async () => {
    const pages = await renderSite(files, { base: "/robins-coffee/", photos });
    const page = pages.find((p) => p.out === "edit/index.html")!;
    expect(page.data.noindex).toBe(true);
    expect(page.html).toContain('name="robots" content="noindex');
    expect(page.html).toContain('<p lang="en">');
    expect(page.html).toContain('<p lang="de">');
    expect(page.html).toContain('href="/robins-coffee/studio/"');
    expect(page.html).not.toContain("manifest");
    expect(page.html).not.toContain("\u2014");
    expect(pages.some((p) => p.out.startsWith("de/edit"))).toBe(false);
  });

  test("the old service worker is replaced by one that clears the editor's caches and unregisters itself, and serves nothing", async () => {
    const sw = await Bun.file(join(ROOT, "src", "retired-editor-sw.js")).text();
    expect(sw).toContain('addEventListener("install"');
    expect(sw).toContain('addEventListener("activate"');
    expect(sw).toContain("caches.delete");
    expect(sw).toContain("self.registration.unregister()");
    expect(sw).not.toContain('"fetch"');
    expect(sw).not.toContain("\u2014");
  });

  test("the editor's code is gone", () => {
    expect(new Bun.Glob("src/editor/**").scanSync({ cwd: ROOT }).next().done).toBe(true);
  });
});
