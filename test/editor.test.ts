import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { renderSite, hoursRows, type Files, type Photo } from "../src/render";
import { DAYS, weekFromYaml, weekToYaml, validateWeek, hoursEditable, slugify, validateMoment, momentChanges, momentId, inEditScope, branchName, describe as describeChange, type NewMoment, type Week } from "../src/editor/changes";
import { github, toBase64, GitHubError } from "../src/editor/github";
import { outOfScope } from "../scripts/check-edit-scope";

const SITE = join(import.meta.dir, "..", "site");
const files: Files = {};
for (const p of new Bun.Glob("**/*.{md,yml,json,liquid}").scanSync({ cwd: SITE })) files[p] = await Bun.file(join(SITE, p)).text();
const photoPaths = [...new Bun.Glob("{moments,photos}/*.jpg").scanSync({ cwd: SITE })];
const photos: Record<string, Photo> = Object.fromEntries(photoPaths.map((p) => [p, { width: 1200, height: 800, jpg: [{ w: 480, path: "photos/x-480.jpg" }], webp: [{ w: 480, path: "photos/x-480.webp" }] }]));
const hoursYml = files["data/hours.yml"]!;

describe("editor: opening hours", () => {
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

  test("a bad time is refused in plain words", () => {
    const week: Week = { ...weekFromYaml(hoursYml), tu: { closed: false, open: "25:00", close: "25:00" }, we: { closed: false, open: "16:00", close: "16:00" } };
    const problems = validateWeek(week);
    expect(problems.some((p) => p.startsWith("tu: the opening time"))).toBe(true);
    expect(problems.some((p) => p.startsWith("we: opening and closing time are the same"))).toBe(true);
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

describe("editor: post a photo", () => {
  const good: NewMoment = { date: "2026-11-20", slug: slugify("Friday crowd, Zürich!"), caption: { en: "Friday crowd, Zürich!", de: "Freitagabend, volle Bar." }, alt: { en: "People stand at the bar with drinks.", de: "Leute stehen mit Getränken an der Bar." }, album: "behind-the-bar" };
  const albums = ["behind-the-bar", "halloween-2026"];

  test("a caption becomes a file name in plain letters", () => {
    expect(good.slug).toBe("friday-crowd-zuerich");
    expect(slugify("  Größe & Maß  ")).toBe("groesse-mass");
    expect(slugify("x".repeat(80)).length).toBe(40);
  });

  test("a complete post passes; missing words, TODO, a long dash, a sharp s, a taken name and an unknown album do not", () => {
    expect(validateMoment(good, [], albums)).toEqual([]);
    expect(validateMoment({ ...good, alt: { en: "", de: "TODO" } }, [], albums).length).toBe(2);
    expect(validateMoment({ ...good, caption: { en: "A \u2014 B", de: "Strasse" } }, [], albums)[0]).toContain("long dash");
    expect(validateMoment({ ...good, caption: { ...good.caption, de: "Straße" } }, [], albums)[0]).toContain("ss, not ß");
    expect(validateMoment(good, [momentId(good)], albums)[0]).toContain("already exists");
    expect(validateMoment({ ...good, album: "nope" }, [], albums)[0]).toContain("no album");
    expect(validateMoment({ ...good, date: "2026-02-30" }, [], albums)[0]).toContain("real day");
  });

  test("the post is two files, and the site builds with them: on the home feed and in its album", async () => {
    const changes = momentChanges(good, new Uint8Array([1, 2, 3]));
    expect(changes.map((c) => c.path)).toEqual(["moments/2026-11-20-friday-crowd-zuerich.jpg", "moments/2026-11-20-friday-crowd-zuerich.md"]);
    const blob = "data:image/jpeg;base64,AAAA";
    const variant = [{ w: 1600, path: blob }];
    const pages = await renderSite({ ...files, [changes[1]!.path]: changes[1]!.text! }, { base: "/robins-coffee/", photos: { ...photos, [changes[0]!.path]: { width: 1600, height: 1200, jpg: variant, webp: variant } } });
    const home = pages.find((p) => p.out === "index.html")!.html;
    expect(home).toContain("Friday crowd, Zürich!");
    // A photo that is not on the site yet keeps its own address; nothing is put in front of it.
    expect(home).toContain(`href="${blob}"`);
    expect(home).not.toContain("/robins-coffee/data:");
    expect(pages.find((p) => p.out === "de/gallery/index.html")!.html).toContain("Freitagabend, volle Bar.");
  });
});

describe("editor: what a change may touch", () => {
  test("content, moments, events and data are in; tokens, templates, code and workflows are out", () => {
    for (const p of ["site/data/hours.yml", "site/moments/2026-11-20-x.jpg", "site/moments/2026-11-20-x.md", "site/content/de/index.md", "site/events/2026-12-01-x.md"]) expect([p, inEditScope(p)]).toEqual([p, true]);
    for (const p of ["site/data/tokens.json", "site/templates/layouts/base.liquid", "site/assets/js/site.js", "src/render.ts", ".github/workflows/deploy.yml", "package.json", "site/data/../templates/x.liquid", "CLAUDE.md"]) expect([p, inEditScope(p)]).toEqual([p, false]);
  });

  test("the CI guard names every file outside that reach", () => {
    expect(outOfScope(["site/data/hours.yml", "", "src/build.ts", " .github/workflows/preview.yml "])).toEqual(["src/build.ts", ".github/workflows/preview.yml"]);
  });

  test("branch names and summaries", () => {
    expect(branchName("Elias-B", "friday-crowd", new Date("2026-11-20T18:05:00Z"))).toBe("edit/elias-b/friday-crowd-2026-11-20-18-05-00");
    const d = describeChange([...momentChanges({ date: "2026-11-20", slug: "x", caption: { en: "Hello", de: "Hallo" }, alt: { en: "a", de: "b" } }, new Uint8Array(1)), { path: "data/hours.yml", label: "Opening hours", text: "x" }], "elias");
    expect(d.title).toBe("Photo: Hello and 1 more");
    expect(d.body).toContain("@elias");
    expect(d.body).toContain("`site/moments/2026-11-20-x.jpg`");
  });
});

describe("editor: GitHub", () => {
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

  test("a change becomes blobs, one tree, one commit and a new branch; main is never written", async () => {
    const { calls, doFetch } = fake({
      [`GET ${R}/git/ref/heads/main`]: { body: { object: { sha: "HEAD" } } },
      [`GET ${R}/git/commits/HEAD`]: { body: { tree: { sha: "TREE" } } },
      [`POST ${R}/git/blobs`]: { status: 201, body: { sha: "BLOB" } },
      [`POST ${R}/git/trees`]: { status: 201, body: { sha: "NEWTREE" } },
      [`POST ${R}/git/commits`]: { status: 201, body: { sha: "COMMIT" } },
      [`POST ${R}/git/refs`]: { status: 201, body: {} },
    });
    const sha = await github("o/r", "secret", doFetch).commit("edit/elias/x", "main", "Photo: x", [{ path: "moments/a.jpg", label: "p", bytes: new Uint8Array([255, 216, 255]) }, { path: "moments/a.md", label: "c", text: "---\n" }]);
    expect(sha).toBe("COMMIT");
    const posts = calls.filter((c) => c.method === "POST");
    expect(posts[0]!.body).toEqual({ content: toBase64(new Uint8Array([255, 216, 255])), encoding: "base64" });
    expect(posts[1]!.body).toEqual({ content: "---\n", encoding: "utf-8" });
    expect(posts[2]!.body).toEqual({ base_tree: "TREE", tree: [{ path: "site/moments/a.jpg", mode: "100644", type: "blob", sha: "BLOB" }, { path: "site/moments/a.md", mode: "100644", type: "blob", sha: "BLOB" }] });
    expect(posts[3]!.body).toEqual({ message: "Photo: x", tree: "NEWTREE", parents: ["HEAD"] });
    expect(posts[4]!.body).toEqual({ ref: "refs/heads/edit/elias/x", sha: "COMMIT" });
    expect(calls.every((c) => c.auth === "Bearer secret" && c.url.startsWith("https://api.github.com/") && !c.url.includes("secret"))).toBe(true);
    expect(calls.some((c) => c.method === "PATCH" || c.method === "PUT" || c.method === "DELETE")).toBe(false);
  });

  test("access says who and whether they may write; a bad token is said plainly", async () => {
    const ok = fake({ "GET https://api.github.com/user": { body: { login: "elias" } }, [`GET ${R}`]: { body: { permissions: { push: true } } } });
    expect(await github("o/r", "t", ok.doFetch).access()).toEqual({ login: "elias", canWrite: true });
    const bad = fake({ "GET https://api.github.com/user": { status: 401, body: { message: "Bad credentials" } } });
    const err = await github("o/r", "t", bad.doFetch).access().catch((e) => e);
    expect(err).toBeInstanceOf(GitHubError);
    expect(err.status).toBe(401);
    expect(err.message).toContain("did not accept the token");
  });

  test("a missing file reads as null; without a token no Authorization header is sent", async () => {
    const { calls, doFetch } = fake({ [`GET ${R}/contents/site/data/hours.yml`]: { body: "regular: []\n" }, [`GET ${R}/pulls`]: { body: [{ number: 1, head: { ref: "edit/a/b", repo: { full_name: "o/r" } } }, { number: 2, head: { ref: "milestone-9", repo: { full_name: "o/r" } } }, { number: 3, head: { ref: "edit/x/y", repo: { full_name: "stranger/r" } } }] } });
    const gh = github("o/r", null, doFetch);
    expect(await gh.fileText("site/data/hours.yml", "main")).toBe("regular: []\n");
    expect(await gh.fileText("site/moments/none.jpg", "main")).toBeNull();
    expect((await gh.editorPulls()).map((p) => p.number)).toEqual([1]);
    expect(calls.every((c) => c.auth === null)).toBe(true);
  });

  test("publish squashes exactly the commit that was looked at; a refusal from GitHub carries its reason", async () => {
    const { calls, doFetch } = fake({ [`PUT ${R}/pulls/7/merge`]: { body: { merged: true } }, [`DELETE ${R}/git/refs/heads/edit/a/b`]: { status: 204, body: "" } });
    await github("o/r", "t", doFetch).publish(7, "edit/a/b", "SEEN");
    expect(calls[0]!.body).toEqual({ merge_method: "squash", sha: "SEEN" });
    expect(calls[1]!.method + " " + calls[1]!.url).toBe(`DELETE ${R}/git/refs/heads/edit/a/b`);
    const no = fake({ [`PUT ${R}/pulls/7/merge`]: { status: 405, body: { message: "Required status check \"build\" is expected." } } });
    const err = await github("o/r", "t", no.doFetch).publish(7, "edit/a/b", "SEEN").catch((e) => e);
    expect(err.message).toContain("Required status check");
  });
});

describe("editor: the page and its bundle", () => {
  test("the editor page is at edit/index.html, noindex, out of the sitemap, with its script and manifest through the base", async () => {
    const page = (await renderSite(files, { base: "/robins-coffee/", photos })).find((p) => p.out === "edit/index.html")!;
    expect(page.html).toContain('name="robots" content="noindex');
    expect(page.html).toContain('<link rel="manifest" href="/robins-coffee/edit/manifest.webmanifest">');
    expect(page.html).toContain('data-bundle="/robins-coffee/edit/site.json"');
    expect(page.html).toContain('<script type="module" src="/robins-coffee/edit/editor.js');
    expect(page.data.noindex).toBe(true);
  });

  test("the editor's source names no host but GitHub, logs nothing, and sandboxes its preview", async () => {
    let src = "";
    for (const f of new Bun.Glob("*.{ts,js}").scanSync({ cwd: join(import.meta.dir, "..", "src", "editor") })) src += await Bun.file(join(import.meta.dir, "..", "src", "editor", f)).text();
    expect(src.match(/https?:\/\/[a-z.]+/g)!.every((u) => ["https://api.github.com", "https://github.com"].includes(u))).toBe(true);
    expect(src).not.toMatch(/console\.\w+\(/);
    expect(src).toContain('sandbox: "allow-scripts"');
    expect(src).not.toMatch(/sandbox: "[^"]*allow-same-origin/);
    expect(src).not.toMatch(/innerHTML|insertAdjacentHTML|document\.write/);
  });

  test("the scope rule imports nothing, so CI can run the base branch's copy before installing", async () => {
    expect(await Bun.file(join(import.meta.dir, "..", "src", "editor", "scope.ts")).text()).not.toMatch(/^import /m);
    const guard = await Bun.file(join(import.meta.dir, "..", "scripts", "check-edit-scope.ts")).text();
    expect([...guard.matchAll(/^import .* from "(.*)";$/gm)].map((m) => m[1])).toEqual(["../src/editor/scope"]);
  });
});
