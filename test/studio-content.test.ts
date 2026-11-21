// The Studio's second round of screens: one Photos section with its albums, the menu and
// events with their pictures, the calendar, and restoring an old version. The rules are
// tested here without a screen: pure helpers, the routes over a temp folder, the restore
// over real git in a temp folder, and the server on a copy of this site.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import sharp from "sharp";
import { parse as parseYaml } from "yaml";
import { changeDrink, dropCover, editMoment, eventFields, eventFile, exifDay, hasDrink, keepComments, photoDay } from "../src/content";
import { inEditScope } from "../src/editor/scope";
import { fromManual } from "../src/events";
import { parseFrontMatter } from "../src/render";
import { calendarMonths, dayShort, dayWords, fileOfEvent, whenWords } from "../src/studio/calendar";
import { contentApi, dropFocus, photoName, workingPhoto } from "../src/studio/content-api";
import { describeChanges } from "../src/studio/describe";
import { RestoreRefused, studioGit } from "../src/studio/git";
import { TOKEN_HEADER } from "../src/studio/guard";
import type { Keychain } from "../src/studio/keychain";
import { startStudio, type StudioState } from "../src/studio/server";
import { STRINGS } from "../src/studio/strings";
import { SECTIONS } from "../src/studio/ui/sections";
import { look } from "../src/vision";

const ROOT = join(import.meta.dir, "..");
const SITE = join(ROOT, "site");
const en = STRINGS.en, de = STRINGS.de;

const temps: string[] = [];
const temp = () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "robins-studio-content-")));
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
/** A working copy on main with a bare "GitHub" next to it. */
function repoWithRemote(fill: (root: string) => void): { root: string; bare: string } {
  const dir = temp();
  const root = join(dir, "work"), bare = join(dir, "remote.git");
  mkdirSync(root);
  sh(root, "init", "--quiet", "-b", "main");
  writeFileSync(join(root, ".git", "info", "exclude"), "node_modules\n.cache\n");
  for (const [k, v] of [["user.name", "Test"], ["user.email", "test@example.invalid"], ["commit.gpgsign", "false"]]) sh(root, "config", k!, v!);
  fill(root);
  sh(root, "add", "-A");
  sh(root, "commit", "--quiet", "-m", "First version");
  sh(dir, "clone", "--quiet", "--bare", root, bare);
  sh(root, "remote", "add", "origin", bare);
  sh(root, "fetch", "--quiet", "origin");
  return { root, bare };
}
const put = (root: string, path: string, data: string | Uint8Array) => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), data);
};
const jpeg = (colour: string, exif?: Record<string, Record<string, string>>) => {
  const made = sharp({ create: { width: 300, height: 200, channels: 3, background: colour } });
  return (exif ? made.withExif(exif) : made).jpeg().toBuffer();
};

// ---------- the sidebar ----------

test("C99: the sidebar is hours, photos, menu, events, history, settings; no albums and no This Mac entry", () => {
  expect(SECTIONS.map((s) => s.id)).toEqual(["hours", "photos", "menu", "events", "history", "settings"]);
  expect(SECTIONS.map((s) => s.title(en))).toEqual(["Opening hours", "Photos", "Menu", "Events", "History", "Settings"]);
  for (const t of [en, de]) expect(SECTIONS.map((s) => s.title(t))).not.toContain(t.sec_tools);
});

// ---------- rules without a screen ----------

describe("studio screens: the rules of the files", () => {
  const MENU = readFileSync(join(SITE, "data", "menu.yml"), "utf8");
  const names = (yaml: string, part = "signatures") => parseYaml(yaml).sections.find((s: any) => s.slug === part).drinks.map((d: any) => d.name);
  const drink = { name: "Sleepy Monkey", text: { en: "Pisco", de: "Pisco" }, price_chf: 19 };

  test("a renamed drink keeps its place in the list; moved to another part it goes to the end there", () => {
    const before = names(MENU);
    const at = before.indexOf("Lazy Monkey");
    const renamed = changeDrink(MENU, { part: "signatures", name: "Lazy Monkey" }, "signatures", drink);
    expect(names(renamed)).toEqual(before.map((n: string, i: number) => (i === at ? "Sleepy Monkey" : n)));
    expect(parseYaml(renamed).sections[0].drinks[at]).toEqual(drink);
    expect(renamed.startsWith("# The drinks menu")).toBe(true);
    const moved = changeDrink(MENU, { part: "signatures", name: "Lazy Monkey" }, "winter", drink, { en: "Winter", de: "Winter" });
    expect(names(moved)).toEqual(before.filter((n: string) => n !== "Lazy Monkey"));
    expect(names(moved, "winter")).toEqual(["Sleepy Monkey"]);
  });
  test("a new name that another drink of the part has is refused, and so is a drink that is gone", () => {
    expect(() => changeDrink(MENU, { part: "signatures", name: "Lazy Monkey" }, "signatures", { ...drink, name: "Toffee Crush" })).toThrow("drink_exists");
    expect(() => changeDrink(MENU, { part: "signatures", name: "Nope" }, "signatures", drink)).toThrow("drink_not_found");
    expect(hasDrink(MENU, "signatures", " Toffee Crush ")).toBe(true);
    expect(hasDrink(MENU, "signatures", "Nope")).toBe(false);
    expect(hasDrink("", "signatures", "Nope")).toBe(false);
  });

  const MOMENT = `---\ndate: 2026-10-22\nalbum: halloween-2026\n# cleared by the owner\ncredit: "someone"\ncaption:\n  en: "Old."\n  de: "Alt."\nalt:\n  en: "A skeleton."\n  de: "Ein Skelett."\n---\n`;
  test("an edited photo keeps its date, its notes and lines the form does not know; album and home page switch change", () => {
    const out = editMoment(MOMENT, { caption: { en: " New. ", de: "Neu, mit Spaß." }, alt: { en: "A.", de: "B." }, album: null, feed: false });
    const { data } = parseFrontMatter(out);
    expect(data).toMatchObject({ feed: false, credit: "someone", caption: { en: "New.", de: "Neu, mit Spass." }, alt: { en: "A.", de: "B." } });
    expect(data.album).toBeUndefined();
    expect(out).toContain("date: 2026-10-22");
    expect(out).toContain("# cleared by the owner");
    const back = parseFrontMatter(editMoment(out, { caption: { en: "x", de: "y" }, alt: { en: "x", de: "y" }, album: "drinks", feed: true })).data;
    expect(back.album).toBe("drinks");
    expect(back.feed).toBeUndefined();
    expect(() => editMoment(MOMENT, { caption: { en: "x", de: "" }, alt: { en: "x", de: "y" } })).toThrow("both_languages");
    expect(() => editMoment(MOMENT, { caption: { en: "x", de: "y" }, alt: { en: "x", de: "y" }, album: "../x" })).toThrow("album_unknown");
    expect(() => editMoment("no head", { caption: { en: "x", de: "y" }, alt: { en: "x", de: "y" } })).toThrow("photo_not_found");
  });
  test("every real photo of the site reads back the same after an edit that changes nothing", async () => {
    for (const p of new Bun.Glob("moments/*.md").scanSync({ cwd: SITE })) {
      const text = await Bun.file(join(SITE, p)).text();
      const { data } = parseFrontMatter(text);
      expect([p, parseFrontMatter(editMoment(text, { caption: data.caption, alt: data.alt, album: data.album, feed: data.feed !== false })).data]).toEqual([p, data]);
    }
  });

  test("C104: the day of a photo comes from the picture, else from its file, else it is today; a day in the future is not believed", () => {
    expect(exifDay("2024:05:06 07:08:09")).toBe("2024-05-06");
    expect(exifDay("2024-05-06T07:08:09")).toBe("2024-05-06");
    for (const bad of ["0000:00:00 00:00:00", "2024:13:40 00:00:00", "1970:01:01 00:00:00", "yesterday", "", null, 5, "2024:05:06x"]) expect([bad, exifDay(bad)]).toEqual([bad, null]);
    expect(photoDay({ taken: "2024:05:06 07:08:09", fileDay: "2025-01-01", today: "2026-11-20" })).toEqual({ day: "2024-05-06", from: "picture" });
    expect(photoDay({ taken: undefined, fileDay: "2025-01-01", today: "2026-11-20" })).toEqual({ day: "2025-01-01", from: "file" });
    expect(photoDay({ taken: "nonsense", fileDay: null, today: "2026-11-20" })).toEqual({ day: "2026-11-20", from: "today" });
    expect(photoDay({ taken: "2031:01:01 00:00:00", fileDay: "2030-01-01", today: "2026-11-20" })).toEqual({ day: "2026-11-20", from: "today" });
    expect(photoDay({ fileDay: "../../x", today: "2026-11-20" }).from).toBe("today");
  });

  test("an event file becomes the fields of its form and back: same days on the site, notes kept", async () => {
    for (const name of ["beer-pong", "queens-gambit"]) {
      const text = await Bun.file(join(SITE, "events", `${name}.md`)).text();
      const fields = eventFields(parseFrontMatter(text).data);
      const file = eventFile(fields);
      const again = keepComments(text, file.text);
      for (const note of text.split("\n").filter((l) => l.startsWith("#"))) expect(again).toContain(note);
      const now = new Date("2026-11-20T12:00:00Z");
      const strip = (list: any[]) => list.map((e) => ({ ...e, text: e.text && { ...e.text } }));
      expect(strip(fromManual({ [`events/${name}.md`]: again }, { now }))).toEqual(strip(fromManual({ [`events/${name}.md`]: text }, { now })));
    }
    expect(eventFields({ title: "X", start: new Date("2026-12-01T19:00:00Z"), end: "2026-12-01T22:00:00+01:00", price_chf: 5, source_url: "https://eventfrog.ch/x", organiser: "O" })).toEqual({ title: "X", start: "2026-12-01T19:00:00Z", end: "2026-12-01T22:00:00+01:00", ticket_url: "", price_chf: 5, organiser: "O", source_url: "https://eventfrog.ch/x" });
    expect(keepComments("---\ntitle: x\n---\n", "---\ntitle: y\n---\n")).toBe("---\ntitle: y\n---\n");
  });

  test("a removed photo takes its focus and an album cover that names it along; a name is made from the caption", () => {
    expect(parseYaml(dropFocus(`# where\n"moments/a.jpg": [0.5, 0.2]\n"photos/b.jpg": [0.1, 0.2]\n`, "moments/a.jpg"))).toEqual({ "photos/b.jpg": [0.1, 0.2] });
    expect(dropFocus(`# where\n"photos/b.jpg": [0.1, 0.2]\n`, "moments/a.jpg")).toBe(`# where\n"photos/b.jpg": [0.1, 0.2]\n`);
    const albums = `# note\nalbums:\n  - slug: a\n    title: { en: "A", de: "A" }\n    cover: 2026-01-01-x\n  - slug: b\n    title: { en: "B", de: "B" }\n    cover: 2026-01-01-y\n`;
    expect(parseYaml(dropCover(albums, "2026-01-01-x")).albums.map((a: any) => a.cover)).toEqual([undefined, "2026-01-01-y"]);
    expect(dropCover(albums, "nope")).toBe(albums);
    expect(photoName("Mulled wine by the window, with a cinnamon stick and a slice of orange!")).toBe("mulled-wine-by-the-window-with");
    expect(photoName("Glühwein & Spaß")).toBe("gluhwein-spass");
    expect(photoName("!!!")).toBe("photo");
    expect(photoName("../../etc/passwd")).toBe("etc-passwd");
  });

  test("the describer names every change these screens make", () => {
    const say = (paths: [string, "added" | "modified" | "removed"][]) => describeChanges(paths.map(([path, status]) => ({ path, status })));
    expect(say([["site/moments/2026-11-20-x.jpg", "added"], ["site/moments/2026-11-20-x.md", "added"], ["site/data/focus.yml", "modified"], ["site/data/albums.yml", "modified"]])).toBe("1 photo added, albums updated");
    expect(say([["site/moments/2026-11-20-x.md", "modified"]])).toBe("1 photo updated");
    expect(say([["site/moments/2026-11-20-x.jpg", "removed"], ["site/moments/2026-11-20-x.md", "removed"], ["site/data/focus.yml", "modified"]])).toBe("1 photo removed");
    expect(say([["site/data/menu.yml", "modified"], ["site/photos/menu-hot-toddy.jpg", "added"], ["site/data/focus.yml", "modified"]])).toBe("Menu updated");
    expect(say([["site/events/2026-12-03-a.md", "removed"], ["site/events/2026-12-04-a.md", "added"], ["site/photos/event-a.jpg", "added"]])).toBe("1 event added, 1 event removed");
    expect(say([["site/events/beer-pong.md", "modified"]])).toBe("1 event updated");
    expect(say([["site/photos/event-a.jpg", "added"]])).toBe("Pictures updated");
    // A restore is a mix of all of them.
    expect(say([["site/data/hours.yml", "modified"], ["site/events/a.md", "added"], ["site/events/b.md", "removed"], ["site/moments/2026-01-01-p.jpg", "modified"]])).toBe("Opening hours updated, 1 event added, 1 event removed, 1 photo updated");
  });
});

// ---------- dates in words and the calendar ----------

describe("studio screens: dates a person can read", () => {
  test("a day in words, in both languages, without a word from Intl", () => {
    expect(dayWords("2026-11-29", en)).toBe("Sunday 29 November 2026");
    expect(dayWords("2026-11-29", de)).toBe("Sonntag, 29. November 2026");
    expect(dayShort("2027-03-12", en)).toBe("Fri 12 Mar 2027");
    expect(dayShort("2027-03-12", de)).toBe("Fr, 12. März 2027");
    expect(dayWords("soon", en)).toBe("soon");
  });
  test("C106: one day; every Wednesday until a day; the list of days; exact times in Zürich time", () => {
    expect(whenWords({ date: "2026-12-03", from: "19:00", to: "23:00" }, en)).toEqual({ line: "Thursday 3 December 2026, 19:00 to 23:00", days: [] });
    expect(whenWords({ date: "2026-12-03", from: "19:00" }, de)).toEqual({ line: "Donnerstag, 3. Dezember 2026, ab 19:00", days: [] });
    expect(whenWords({ every: "we" }, en).line).toBe("Every Wednesday");
    expect(whenWords({ every: "we", until: "2027-03-31" }, en).line).toBe("Every Wednesday until Wednesday 31 March 2027");
    expect(whenWords({ every: "we", until: "2027-03-31", from: "20:00" }, de).line).toBe("Jeden Mittwoch bis Mittwoch, 31. März 2027, ab 20:00");
    expect(whenWords({ dates: ["2026-12-11", "2026-11-29"] }, en)).toEqual({ line: "2 days", days: ["Sun 29 Nov 2026", "Fri 11 Dec 2026"] });
    expect(whenWords({ dates: ["2026-12-11"] }, en).line).toBe("Friday 11 December 2026");
    expect(whenWords({ start: "2026-12-31T20:00:00Z", end: "2027-01-01T02:00:00+01:00" }, en).line).toBe("Thursday 31 December 2026, 21:00 to 02:00");
    expect(whenWords({}, en)).toEqual({ line: "", days: [] });
  });

  const NOW = new Date("2026-11-20T21:00:00Z");
  const feed = [
    { id: "iyf-1", source: "iyf", name: "Comedy Brew", start: "2026-11-26T20:00:00+01:00", end: "2026-11-26T22:00:00+01:00" },
    { id: "manual-beer-pong-2026-11-25", source: "manual", name: "Beer Pong", all_day: true, start: "2026-11-25T00:00:00+01:00", end: "2026-11-26T00:00:00+01:00" },
    { id: "manual-2026-11-26-quiz", source: "manual", name: "Quiz", start: "2026-11-26T18:30:00+01:00", end: "2026-11-26T19:30:00+01:00" },
    { id: "iyf-old", source: "iyf", name: "Over", start: "2026-11-19T20:00:00+01:00", end: "2026-11-19T22:00:00+01:00" },
    { id: "iyf-late", source: "iyf", name: "Late Show", start: "2026-11-30T23:30:00Z", end: "2026-12-01T01:00:00Z" },
    { id: "iyf-feb", source: "iyf", name: "February Show", start: "2027-02-04T20:00:00+01:00", end: "2027-02-04T22:00:00+01:00" },
    { id: "bad", source: "iyf", name: "Bad", start: "never", end: "never" },
  ];
  test("C107: month grids, Monday first, each day naming its events with their time; ended events and empty months left out", () => {
    const months = calendarMonths(feed, NOW, ["beer-pong", "2026-11-26-quiz"]);
    expect(months.map((m) => [m.year, m.month])).toEqual([[2026, 11], [2026, 12], [2027, 2]]);
    const november = months[0]!;
    // 1 November 2026 is a Sunday: the first row runs from Monday 26 October to it.
    expect(november.weeks[0]!.map((d) => d.day)).toEqual(["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"]);
    expect(november.weeks.every((w) => w.length === 7)).toBe(true);
    expect(november.weeks.at(-1)!.map((d) => d.inMonth)).toEqual([true, false, false, false, false, false, false]);
    const day = (key: string) => months.flatMap((m) => m.weeks.flat()).find((d) => d.day === key && d.inMonth)!;
    expect(day("2026-11-26").events).toEqual([
      { id: "manual-2026-11-26-quiz", name: "Quiz", time: "18:30", mine: true, file: "2026-11-26-quiz" },
      { id: "iyf-1", name: "Comedy Brew", time: "20:00", mine: false, file: null },
    ]);
    expect(day("2026-11-25").events).toEqual([{ id: "manual-beer-pong-2026-11-25", name: "Beer Pong", time: null, mine: true, file: "beer-pong" }]);
    expect(day("2026-11-19")).toMatchObject({ past: true, events: [] });
    expect(day("2026-11-20")).toMatchObject({ today: true, past: false });
    // 23:30 UTC on 30 November is half past midnight on 1 December in Zürich.
    expect(day("2026-12-01").events.map((e) => [e.time, e.name])).toEqual([["00:30", "Late Show"]]);
    expect(day("2026-11-30").events).toEqual([]);
    const all = months.flatMap((m) => m.weeks.flat()).flatMap((d) => d.events.map((e) => e.id));
    expect(all.sort()).toEqual(["iyf-1", "iyf-feb", "iyf-late", "manual-2026-11-26-quiz", "manual-beer-pong-2026-11-25"]);
    expect(calendarMonths([], NOW)).toEqual([]);
  });
  test("an event of the site is traced to the file it came from, the longest name first", () => {
    expect(fileOfEvent("manual-beer-pong-2026-11-25", ["beer-pong", "beer"])).toBe("beer-pong");
    expect(fileOfEvent("manual-beer-pong", ["beer-pong"])).toBe("beer-pong");
    expect(fileOfEvent("manual-beer-pong-finals", ["beer-pong"])).toBe(null);
    expect(fileOfEvent("iyf-beer-pong", ["beer-pong"])).toBe(null);
  });
});

// ---------- the routes, over a temp folder ----------

describe("studio screens: the routes", () => {
  const root = temp();
  for (const f of ["albums.yml", "menu.yml", "focus.yml"]) put(root, `site/data/${f}`, readFileSync(join(SITE, "data", f)));
  put(root, "site/events/beer-pong.md", readFileSync(join(SITE, "events", "beer-pong.md")));
  for (const f of ["event-beer-pong.jpg", "event-queens-gambit.jpg", "menu-lazy-monkey.jpg"]) put(root, `site/photos/${f}`, readFileSync(join(SITE, "photos", f)));
  put(root, "site/events/queens-gambit.md", readFileSync(join(SITE, "events", "queens-gambit.md")));
  mkdirSync(join(root, "preview"));
  const written: string[] = [];
  let changed = 0;
  let taken: string | undefined = "2024:05:06 07:08:09";
  const handed: { cleanedExif: boolean; original: Buffer | null } = { cleanedExif: true, original: null };
  const api = contentApi({
    root, previewDir: join(root, "preview"),
    write: async (path, data) => { written.push(path); if (!inEditScope(path)) throw new Error("outside"); put(root, path, data); },
    changed: () => void changed++,
    readKey: async () => null,
    now: () => new Date("2026-11-20T21:00:00Z"),
    look: async (_root, file, original) => {
      handed.cleanedExif = !!(await sharp(file).metadata()).exif;
      handed.original = original ? readFileSync(original) : null;
      return { focus: { x: 0.25, y: 0.75 }, labels: [{ name: "coffee", confidence: 0.9 }], text: [], faces: [], ...(taken ? { taken } : {}) };
    },
  });
  const call = async (route: string, body: any = {}) => { const res = await api(route, async () => body); return res ? { status: res.status, data: await res.json() } : null; };
  const read = (path: string) => readFileSync(join(root, path), "utf8");
  const has = (path: string) => existsSync(join(root, path));
  const shot = async (colour = "#203040") => ({ base64: (await jpeg(colour, { IFD0: { Copyright: "secret owner" } })).toString("base64"), focus: [0.3, 0.6] });
  const texts = { caption: { en: "Mulled wine by the window", de: "Glühwein am Fenster" }, alt: { en: "A glass.", de: "Ein Glas." } };

  test("C104: the look route hands the original to the helper for its day, Vision gets the cleaned copy, and both temp files are gone afterwards", async () => {
    const original = await jpeg("#203040", { IFD0: { Copyright: "secret owner" } });
    const res = (await call("POST look", { base64: original.toString("base64"), modified: Date.parse("2025-03-04T12:00:00Z") }))!;
    expect(res.data).toMatchObject({ focus: [0.25, 0.75], date: "2024-05-06", date_from: "picture", note: null });
    expect(handed.original!.equals(original)).toBe(true);
    expect(handed.cleanedExif).toBe(false);
    expect([...new Bun.Glob("look-*").scanSync({ cwd: join(root, ".cache", "studio") })]).toEqual([]);
    taken = undefined;
    expect((await call("POST look", { base64: original.toString("base64"), modified: Date.parse("2025-03-04T23:30:00Z") }))!.data).toMatchObject({ date: "2025-03-05", date_from: "file" });
    expect((await call("POST look", { base64: original.toString("base64") }))!.data).toMatchObject({ date: "2026-11-20", date_from: "today" });
    expect((await call("POST look", { base64: original.toString("base64"), modified: "2025-03-04" }))!.data.date_from).toBe("today");
    expect([...new Bun.Glob("look-*").scanSync({ cwd: join(root, ".cache", "studio") })]).toEqual([]);
  });
  test("a Mac that cannot look still gives a day and leaves no copy behind", async () => {
    const blind = contentApi({ root, write: async () => {}, changed: () => {}, readKey: async () => null, now: () => new Date("2026-11-20T21:00:00Z"), look: async () => { throw new Error("Apple Vision needs a Mac."); } });
    const res = await blind("POST look", async () => ({ base64: (await jpeg("#000")).toString("base64"), modified: Date.parse("2025-03-04T12:00:00Z") }));
    expect(await res!.json()).toMatchObject({ focus: null, faces: 0, draft: { en: "", de: "" }, date: "2025-03-04", date_from: "file", note: "Apple Vision needs a Mac." });
    expect([...new Bun.Glob("look-*").scanSync({ cwd: join(root, ".cache", "studio") })]).toEqual([]);
  });

  test("C103 C104: a photo needs no name and no kind: the name comes from the caption, a taken name gets a number, a new album is made in the same request", async () => {
    const first = (await call("POST photo", { ...(await shot()), date: "2026-11-20", ...texts, album: "drinks" }))!;
    expect(first.data).toEqual({ ok: true, id: "2026-11-20-mulled-wine-by-the-window", path: "moments/2026-11-20-mulled-wine-by-the-window.jpg", album: "drinks" });
    expect((await sharp(join(root, "site", first.data.path)).metadata()).exif).toBeUndefined();
    expect(parseYaml(read("site/data/focus.yml"))[first.data.path]).toEqual([0.3, 0.6]);
    const second = (await call("POST photo", { ...(await shot()), date: "2026-11-20", ...texts, newAlbum: { en: "Winter 2026", de: "Winter 2026" }, feed: false }))!;
    expect(second.data).toMatchObject({ id: "2026-11-20-mulled-wine-by-the-window-2", album: "winter-2026" });
    expect(parseYaml(read("site/data/albums.yml")).albums.map((a: any) => a.slug)).toContain("winter-2026");
    expect(parseFrontMatter(read("site/moments/2026-11-20-mulled-wine-by-the-window-2.md")).data).toMatchObject({ album: "winter-2026", feed: false });
    // What a request may not do: a kind, a slug or a path of its own change nothing.
    const third = (await call("POST photo", { ...(await shot()), date: "2026-11-21", ...texts, kind: "plain", slug: "../../x", path: "site/data/site.yml" }))!;
    expect(third.data.path).toBe("moments/2026-11-21-mulled-wine-by-the-window.jpg");
    for (const bad of [{ date: "2026-13-45" }, { date: "tomorrow" }, { date: undefined }]) expect((await call("POST photo", { ...(await shot()), ...texts, ...bad }))!.data.error).toBe("event_date_wrong");
    expect((await call("POST photo", { ...(await shot()), date: "2026-11-20", ...texts, newAlbum: { en: "Winter 2026", de: "Winter 2026" } }))!.data.error).toBe("album_exists");
    expect((await call("POST photo", { ...(await shot()), date: "2026-11-20", ...texts, newAlbum: { en: "Only", de: "" } }))!.data.error).toBe("both_languages");
    expect((await call("POST photo", { base64: Buffer.from("not a picture").toString("base64"), date: "2026-11-20", ...texts }))!.data.error).toBe("photo_unreadable");
  });
  test("C103: the overview lists every photo with its album; a photo is edited, moved, taken off the home page and removed", async () => {
    const id = "2026-11-20-mulled-wine-by-the-window";
    const seen = (await call("GET content"))!.data;
    expect(seen.moments.map((m: any) => [m.id, m.album, m.feed])).toEqual([
      ["2026-11-21-mulled-wine-by-the-window", null, true],
      [id, "drinks", true],
      [`${id}-2`, "winter-2026", false],
    ]);
    expect(seen.moments[1]).toEqual({ id, date: "2026-11-20", album: "drinks", feed: true, caption: texts.caption, alt: texts.alt, photo: `moments/${id}.jpg` });
    expect((await call("PUT photo", { id, caption: { en: "New.", de: "Neu." }, alt: texts.alt, album: "winter-2026", feed: false }))!.data).toEqual({ ok: true, id, album: "winter-2026" });
    expect(parseFrontMatter(read(`site/moments/${id}.md`)).data).toMatchObject({ album: "winter-2026", feed: false, caption: { en: "New.", de: "Neu." } });
    expect((await call("PUT photo", { id, caption: { en: "New.", de: "Neu." }, alt: texts.alt, album: "" }))!.data.album).toBe(null);
    expect(parseFrontMatter(read(`site/moments/${id}.md`)).data.album).toBeUndefined();
    expect((await call("PUT photo", { id, caption: texts.caption, alt: texts.alt, album: "nope" }))!.data.error).toBe("album_unknown");
    expect((await call("PUT photo", { id, caption: { en: "x", de: "" }, alt: texts.alt }))!.data.error).toBe("both_languages");
    for (const bad of ["../data/menu", "nope", "", null, "2026-11-20-MULLED", "a/b"]) expect((await call("PUT photo", { id: bad, ...texts }))!.status).toBe(404);
    // Removing: both files, its focus, and an album cover that named it.
    put(root, "site/data/albums.yml", read("site/data/albums.yml").replace("- slug: drinks", `- slug: drinks\n    cover: ${id}`));
    const before = changed;
    expect((await call("DELETE photo", { id }))!.data).toEqual({ ok: true });
    expect([has(`site/moments/${id}.jpg`), has(`site/moments/${id}.md`)]).toEqual([false, false]);
    expect(parseYaml(read("site/data/focus.yml"))[`moments/${id}.jpg`]).toBeUndefined();
    expect(read("site/data/albums.yml")).not.toContain(`cover: ${id}`);
    expect(changed).toBe(before + 1);
    for (const bad of ["../data/menu", id, "../../README", null]) expect((await call("DELETE photo", { id: bad }))!.status).toBe(404);
    expect(has("site/data/menu.yml")).toBe(true);
  });

  test("C105: a drink is saved with its picture in one request: cleaned, under menu-<name>, a free name if taken, focus recorded", async () => {
    const drink = { name: "Hot Toddy", text: { en: "Whisky, honey", de: "Whisky, Honig" }, price_chf: 14, alt: { en: "A mug.", de: "Eine Tasse." } };
    expect((await call("POST drink", { part: "signatures", drink, picture: await shot() }))!.data).toEqual({ ok: true, photo: "photos/menu-hot-toddy.jpg" });
    expect((await sharp(join(root, "site/photos/menu-hot-toddy.jpg")).metadata()).exif).toBeUndefined();
    expect(parseYaml(read("site/data/focus.yml"))["photos/menu-hot-toddy.jpg"]).toEqual([0.3, 0.6]);
    const menu = () => parseYaml(read("site/data/menu.yml")).sections[0].drinks;
    expect(menu().at(-1)).toEqual({ ...drink, photo: "photos/menu-hot-toddy.jpg" });
    // "Add a drink" never replaces one that is there.
    expect((await call("POST drink", { part: "signatures", drink }))!.data.error).toBe("drink_exists");
    // Edit: a new name keeps the place, a new picture gets a free name, the old picture is kept when none is sent.
    const at = menu().findIndex((d: any) => d.name === "Lazy Monkey");
    const lazy = menu()[at];
    expect((await call("POST drink", { part: "signatures", was: { part: "signatures", name: "Lazy Monkey" }, drink: { ...lazy, name: "Sleepy Monkey", price_chf: 19 } }))!.data).toEqual({ ok: true, photo: "photos/menu-lazy-monkey.jpg" });
    expect(menu()[at]).toEqual({ ...lazy, name: "Sleepy Monkey", price_chf: 19 });
    expect((await call("POST drink", { part: "signatures", was: { part: "signatures", name: "Hot Toddy" }, drink, picture: await shot("#804020") }))!.data.photo).toBe("photos/menu-hot-toddy-2.jpg");
    expect(menu().at(-1).photo).toBe("photos/menu-hot-toddy-2.jpg");
    // Refusals leave no picture behind.
    const pictures = () => [...new Bun.Glob("site/photos/*.jpg").scanSync({ cwd: root })].sort();
    const before = pictures();
    expect((await call("POST drink", { part: "signatures", drink: { ...drink, name: "No Alt", alt: undefined }, picture: await shot() }))!.data.error).toBe("alt_missing");
    expect((await call("POST drink", { part: "signatures", drink: { ...drink, name: "" }, picture: await shot() }))!.data.error).toBe("drink_name_missing");
    expect((await call("POST drink", { part: "signatures", was: { part: "signatures", name: "Gone" }, drink: { ...drink, name: "Y" }, picture: await shot() }))!.data.error).toBe("drink_not_found");
    expect((await call("POST drink", { part: "signatures", was: { part: "signatures", name: "Hot Toddy" }, drink: { ...drink, name: "Toffee Crush" }, picture: await shot() }))!.data.error).toBe("drink_exists");
    expect((await call("POST drink", { part: "signatures", drink: { ...drink, name: "Z" }, picture: { base64: Buffer.from("no").toString("base64") } }))!.data.error).toBe("photo_unreadable");
    expect((await call("POST drink", { part: "../x", drink: { ...drink, name: "Z" } }))!.data.error).toBe("menu_part_wrong");
    expect(pictures()).toEqual(before);
    expect((await call("GET content"))!.data.menu[0].drinks.at(-1)).toEqual({ ...drink, photo: "photos/menu-hot-toddy-2.jpg" });
  });

  test("C106: an event is added and edited with its picture; an edit keeps the file's place, or the old file goes when name or day change", async () => {
    const event = { title: "Board Game Night", date: "2026-12-03", from: "19:00", category: "other", ticket_url: "", price_chf: null };
    const made = (await call("POST event", { event, picture: await shot() }))!;
    expect(made.data).toEqual({ ok: true, path: "site/events/2026-12-03-board-game-night.md", image: "photos/event-board-game-night.jpg" });
    expect((await sharp(join(root, "site/photos/event-board-game-night.jpg")).metadata()).exif).toBeUndefined();
    expect(parseYaml(read("site/data/focus.yml"))["photos/event-board-game-night.jpg"]).toEqual([0.3, 0.6]);
    // Same name and day: the same file, the picture kept, the text changed.
    const same = (await call("PUT event", { path: made.data.path, event: { ...event, image: made.data.image, to: "23:00", text: { en: "Bring a game.", de: "Bring ein Spiel mit." } } }))!;
    expect(same.data).toEqual({ ok: true, path: made.data.path, image: "photos/event-board-game-night.jpg" });
    expect(parseFrontMatter(read(made.data.path)).data).toMatchObject({ to: "23:00", image: "photos/event-board-game-night.jpg", text: { en: "Bring a game." } });
    // A new day: the old file goes, the new one is written.
    const before = changed;
    const moved = (await call("PUT event", { path: made.data.path, event: { ...event, date: "2026-12-10", image: made.data.image }, picture: await shot("#102030") }))!;
    expect(moved.data).toEqual({ ok: true, path: "site/events/2026-12-10-board-game-night.md", image: "photos/event-board-game-night-2.jpg" });
    expect([has(made.data.path), has(moved.data.path)]).toEqual([false, true]);
    // Two things went away and were told to the screen: the old file, and the old picture nothing uses any more.
    expect(changed).toBe(before + 2);
    expect(has("site/" + made.data.image)).toBe(false);
    // The series from the poster: its notes, its short name and its organiser stay when only the text changes.
    const pong = (await call("GET content"))!.data.events.find((e: any) => e.path === "site/events/beer-pong.md");
    expect(pong).toMatchObject({ title: "Beer Pong at ROBIN's", source: "hand", fields: { name: "Beer Pong", every: "we", image: "photos/event-beer-pong.jpg" } });
    expect((await call("PUT event", { path: pong.path, event: { ...pong.fields, until: "2027-03-31", from: "20:00" } }))!.data.path).toBe("site/events/beer-pong.md");
    expect(read("site/events/beer-pong.md")).toContain("# From the bar's poster");
    expect(parseFrontMatter(read("site/events/beer-pong.md")).data).toMatchObject({ name: "Beer Pong", every: "we", from: "20:00", image: "photos/event-beer-pong.jpg" });
    // A file named by hand keeps its name: "Queen's Gambit" alone would make "queen-s-gambit".
    const gambit = (await call("GET content"))!.data.events.find((e: any) => e.path === "site/events/queens-gambit.md");
    expect((await call("PUT event", { path: gambit.path, event: { ...gambit.fields, from: "19:00" } }))!.data.path).toBe("site/events/queens-gambit.md");
    expect([has("site/events/queens-gambit.md"), has("site/events/queen-s-gambit.md")]).toEqual([true, false]);
    // An import keeps where it came from and who organises it, though the form does not send them.
    put(root, "site/events/2026-12-01-show.md", eventFile({ title: "Show", start: "2026-12-01T20:00:00+01:00", end: "2026-12-01T22:00:00+01:00", ticket_url: "https://eventfrog.ch/x-1.html", source_url: "https://eventfrog.ch/x-1.html", organiser: "Someone" }).text);
    expect((await call("PUT event", { path: "site/events/2026-12-01-show.md", event: { title: "Show", start: "2026-12-01T20:00:00+01:00", end: "2026-12-01T22:00:00+01:00", ticket_url: "https://eventfrog.ch/x-1.html", text: { en: "A.", de: "B." } } }))!.status).toBe(200);
    expect(parseFrontMatter(read("site/events/2026-12-01-show.md")).data).toMatchObject({ organiser: "Someone", source_url: "https://eventfrog.ch/x-1.html", text: { en: "A." } });
    // Refusals.
    expect((await call("PUT event", { path: moved.data.path, event: { title: "Show", start: "2026-12-01T20:00:00+01:00", end: "2026-12-01T22:00:00+01:00" } }))!.data.error).toBe("event_exists");
    expect(has(moved.data.path)).toBe(true);
    for (const path of ["site/events/../data/menu.yml", "site/events/README.md", "site/data/menu.yml", "site/events/nope.md", "", null]) expect([path, (await call("PUT event", { path, event }))!.status]).toEqual([path, 404]);
    const pictures = () => [...new Bun.Glob("site/photos/*.jpg").scanSync({ cwd: root })].sort();
    const kept = pictures();
    expect((await call("PUT event", { path: moved.data.path, event: { ...event, title: "" }, picture: await shot() }))!.data.error).toBe("event_title_missing");
    expect((await call("POST event", { event: { ...event, start: "2026-12-01T20:00:00+01:00\nevil: 1", end: "x" }, picture: await shot() }))!.data.error).toBe("event_time_wrong");
    expect((await call("POST event", { event, picture: { base64: "" } }))!.data.error).toBe("photo_unreadable");
    expect(pictures()).toEqual(kept);
  });

  test("C107: the calendar route reads the preview's own events.json and marks what came from a file here", async () => {
    expect((await call("GET calendar"))!.data).toEqual({ built: null, months: [] });
    const events = [
      { id: "iyf-1", source: "iyf", name: "Comedy Brew", start: "2026-11-26T20:00:00+01:00", end: "2026-11-26T22:00:00+01:00" },
      { id: "manual-beer-pong-2026-11-25", source: "manual", name: "Beer Pong", all_day: true, start: "2026-11-25T00:00:00+01:00", end: "2026-11-26T00:00:00+01:00" },
    ];
    put(root, "preview/events.json", JSON.stringify({ generated_at: "2026-11-20T20:59:00.000Z", events }));
    const res = (await call("GET calendar"))!.data;
    expect(res.built).toBe("2026-11-20T20:59:00.000Z");
    expect(res.months).toEqual(calendarMonths(events, new Date("2026-11-20T21:00:00Z"), ["2026-12-01-show", "2026-12-10-board-game-night", "beer-pong", "queens-gambit"]));
    expect(res.months[0].weeks.flat().flatMap((d: any) => d.events)).toEqual([
      { id: "manual-beer-pong-2026-11-25", name: "Beer Pong", time: null, mine: true, file: "beer-pong" },
      { id: "iyf-1", name: "Comedy Brew", time: "20:00", mine: false, file: null },
    ]);
    put(root, "preview/events.json", "not json");
    expect((await call("GET calendar"))!.data).toEqual({ built: null, months: [] });
  });

  test("ANTI: every path these routes wrote is inside the edit scope, and restore is not offered without git", async () => {
    expect(written.length).toBeGreaterThan(15);
    for (const p of written) expect([p, inEditScope(p)]).toEqual([p, true]);
    expect(await call("POST restore", { sha: "0".repeat(40) })).toBeNull();
  });

  test("thumbnails: only a .jpg of site/moments or site/photos, by a checked name; nothing climbs out and a link out of site/ is not followed", async () => {
    const ok = workingPhoto(root, "/_studio/photo/photos/event-beer-pong.jpg");
    expect([ok.status, ok.headers.get("content-type"), ok.headers.get("x-content-type-options")]).toEqual([200, "image/jpeg", "nosniff"]);
    expect(Buffer.from(await ok.arrayBuffer()).equals(readFileSync(join(root, "site/photos/event-beer-pong.jpg")))).toBe(true);
    expect(workingPhoto(root, "/_studio/photo/moments/2026-11-21-mulled-wine-by-the-window.jpg").status).toBe(200);
    put(root, "secret.jpg", "secret");
    symlinkSync(join(root, "secret.jpg"), join(root, "site/photos/link-out.jpg"));
    for (const path of [
      "/_studio/photo/photos/nope.jpg", "/_studio/photo/photos/link-out.jpg", "/_studio/photo/data/menu.yml", "/_studio/photo/photos/../data/menu.yml", "/_studio/photo/photos/..%2Fdata%2Fmenu.yml",
      "/_studio/photo/moments/2026-11-21-mulled-wine-by-the-window.md", "/_studio/photo/photos/EVENT-BEER-PONG.jpg", "/_studio/photo/photos/event-beer-pong.jpg/", "/_studio/photo/photos/a/b.jpg", "/_studio/photo/../photos/event-beer-pong.jpg",
      "/_studio/photo/events/beer-pong.md", "/_studio/photo/photos/event-beer-pong.jpeg", "/_studio/photo//event-beer-pong.jpg", "/_studio/photo/photos/.jpg",
    ]) expect([path, workingPhoto(root, path).status]).toEqual([path, 404]);
  });
});

test.skipIf(process.platform !== "darwin" || !Bun.which("swiftc"))("C104 on a Mac: the Swift helper reads the day a picture was taken from the original, while Vision looks at the cleaned copy", async () => {
  const dir = temp();
  const original = join(dir, "original.jpg"), cleaned = join(dir, "cleaned.jpg");
  writeFileSync(original, await jpeg("#804020", { IFD2: { DateTimeOriginal: "2024:05:06 07:08:09" } }));
  writeFileSync(cleaned, await sharp(original).jpeg().toBuffer());
  expect((await look(ROOT, cleaned, original)).taken).toBe("2024:05:06 07:08:09");
  expect((await look(ROOT, cleaned)).taken).toBeUndefined();
  expect((await look(ROOT, original)).taken).toBe("2024:05:06 07:08:09");
}, 240_000);

// ---------- restore, over real git ----------

describe("studio screens: restoring an old version", () => {
  const A = { hours: "open: a\n", event: "---\ntitle: X\ndate: 2026-12-01\n---\n", photo: new Uint8Array([255, 216, 255, 0, 1, 2, 3, 250]), tokens: "{}\n", readme: "one\n" };
  const B = { hours: "open: b\n", photo: new Uint8Array([255, 216, 255, 9, 9, 9, 9, 9, 9]), tokens: '{"a":1}\n', readme: "two\n" };
  function repo() {
    const { root, bare } = repoWithRemote((to) => {
      put(to, "site/data/hours.yml", A.hours);
      put(to, "site/data/tokens.json", A.tokens);
      put(to, "site/events/2026-12-01-x.md", A.event);
      put(to, "site/events/README.md", "Events\n");
      put(to, "site/moments/2026-01-01-p.jpg", A.photo);
      put(to, "site/templates/home.liquid", "one\n");
      put(to, "README.md", A.readme);
    });
    const first = sh(root, "rev-parse", "HEAD").trim();
    put(root, "site/data/hours.yml", B.hours);
    put(root, "site/data/tokens.json", B.tokens);
    rmSync(join(root, "site/events/2026-12-01-x.md"));
    put(root, "site/events/2026-12-02-y.md", "---\ntitle: Y\ndate: 2026-12-02\n---\n");
    put(root, "site/moments/2026-01-01-p.jpg", B.photo);
    put(root, "site/moments/2026-02-02-q.md", "---\ndate: 2026-02-02\n---\n");
    put(root, "site/templates/home.liquid", "two\n");
    put(root, "README.md", B.readme);
    sh(root, "add", "-A");
    sh(root, "commit", "--quiet", "-m", "Second version");
    sh(root, "push", "--quiet", "origin", "main");
    sh(root, "fetch", "--quiet", "origin");
    return { root, bare, first, second: sh(root, "rev-parse", "HEAD").trim(), git: studioGit(root, { remote: bare }) };
  }
  const refs = (root: string) => [sh(root, "for-each-ref"), sh(root, "rev-parse", "HEAD"), sh(root, "symbolic-ref", "HEAD"), sh(root, "reflog", "--all"), sh(root, "stash", "list")].join("|");
  const file = (root: string, path: string) => readFileSync(join(root, path));

  test("C108: the content files become what they were at that commit: changed back, added since removed, removed since brought back", async () => {
    const { root, first, git } = repo();
    expect((await git.history()).map((e) => e.what)).toEqual(["Second version", "First version"]);
    expect(await git.restoreContent(first)).toEqual({ changed: 2, back: 1, removed: 2 });
    expect(file(root, "site/data/hours.yml").toString()).toBe(A.hours);
    expect(file(root, "site/events/2026-12-01-x.md").toString()).toBe(A.event);
    expect(new Uint8Array(file(root, "site/moments/2026-01-01-p.jpg"))).toEqual(A.photo);
    expect([existsSync(join(root, "site/events/2026-12-02-y.md")), existsSync(join(root, "site/moments/2026-02-02-q.md"))]).toEqual([false, false]);
    // It is an unpublished change like any other: the Studio lists it, every path inside the scope.
    const changes = await git.changes();
    expect(changes).toEqual([
      { path: "site/data/hours.yml", status: "modified" },
      { path: "site/events/2026-12-01-x.md", status: "added" },
      { path: "site/events/2026-12-02-y.md", status: "removed" },
      { path: "site/moments/2026-01-01-p.jpg", status: "modified" },
      { path: "site/moments/2026-02-02-q.md", status: "removed" },
    ]);
    expect(changes.every((c) => inEditScope(c.path))).toBe(true);
    // And it publishes like any other: staged by name, the commit's guard does not trip, the content equals the old version.
    await git.createBranch("edit/2026-11-20-restore");
    await git.stage(changes.map((c) => c.path));
    await git.commit("Restore", { name: "Test", email: "test@example.invalid" });
    expect(sh(root, "diff", "--name-only", first, "HEAD", "--", "site/data/hours.yml", "site/events", "site/moments")).toBe("");
    expect(sh(root, "status", "--porcelain")).toBe("");
  });

  test("C109 ANTI: a restore touches only files inside the edit scope, moves no branch, commits nothing and stages nothing", async () => {
    const { root, first, second, git } = repo();
    const before = refs(root);
    await git.restoreContent(first);
    // Changed in the same commit, but not content: the design tokens, a template, the read me.
    expect(file(root, "site/data/tokens.json").toString()).toBe(B.tokens);
    expect(file(root, "site/templates/home.liquid").toString()).toBe("two\n");
    expect(file(root, "README.md").toString()).toBe(B.readme);
    expect(refs(root)).toBe(before);
    expect(sh(root, "rev-parse", "HEAD").trim()).toBe(second);
    expect(sh(root, "diff", "--cached", "--name-only")).toBe("");
    const touched = sh(root, "status", "--porcelain", "--untracked-files=all").split("\n").filter(Boolean).map((l) => l.slice(3));
    expect(touched.length).toBe(5);
    expect(touched.every((p) => inEditScope(p))).toBe(true);
    // Nothing but unstaged changes: the second letter of every status line, never the first.
    expect(sh(root, "status", "--porcelain", "--untracked-files=all").split("\n").filter(Boolean).every((l) => l[0] === " " || l.startsWith("??"))).toBe(true);
  });

  test("C108: restore is refused while other unpublished changes exist, and nothing changes then", async () => {
    const { root, first, git } = repo();
    put(root, "site/data/hours.yml", "open: mine\n");
    await expect(git.restoreContent(first)).rejects.toThrow("restore_changes");
    await expect(git.restoreContent(first)).rejects.toBeInstanceOf(RestoreRefused);
    expect(file(root, "site/data/hours.yml").toString()).toBe("open: mine\n");
    expect(existsSync(join(root, "site/events/2026-12-01-x.md"))).toBe(false);
    await git.discard("site/data/hours.yml");
    // A new file outside the content folders counts too: the folder is not clean.
    put(root, "notes.txt", "x");
    await expect(git.restoreContent(first)).rejects.toThrow("restore_changes");
    rmSync(join(root, "notes.txt"));
    // A restore itself is an unpublished change: a second one on top is refused.
    await git.restoreContent(first);
    await expect(git.restoreContent(first)).rejects.toThrow("restore_changes");
  });

  test("C109 ANTI: only a commit of the history's own entries is taken", async () => {
    const { root, first, git } = repo();
    // A commit that exists in the folder but is not on origin/main.
    sh(root, "switch", "--quiet", "-c", "side", first);
    put(root, "site/data/hours.yml", "open: side\n");
    sh(root, "commit", "--quiet", "-am", "Side");
    const side = sh(root, "rev-parse", "HEAD").trim();
    sh(root, "switch", "--quiet", "main");
    const before = refs(root);
    for (const sha of [side, "0".repeat(40), "main", "HEAD~1", "origin/main", first.slice(0, 12), `${first} --`, "", "--all"]) await expect(git.restoreContent(sha)).rejects.toThrow("restore_unknown");
    await expect(git.restoreContent(undefined as any)).rejects.toThrow("restore_unknown");
    expect(refs(root)).toBe(before);
    expect(sh(root, "status", "--porcelain")).toBe("");
    // The newest entry is what the folder has: nothing to do.
    expect(await git.restoreContent((await git.history())[0]!.sha)).toEqual({ changed: 0, back: 0, removed: 0 });
  });

  test("C109 ANTI: a link or a file of another kind that an old commit holds in a content folder is not written", async () => {
    const { root, bare } = repoWithRemote((to) => {
      put(to, "site/data/hours.yml", A.hours);
      put(to, "site/moments/IMG_1.HEIC", "original with metadata");
      put(to, "site/data/secret.txt", "x");
      symlinkSync("/etc/hosts", join(to, "site/data/link.yml"));
    });
    const first = sh(root, "rev-parse", "HEAD").trim();
    for (const p of ["site/moments/IMG_1.HEIC", "site/data/secret.txt", "site/data/link.yml"]) rmSync(join(root, p));
    put(root, "site/data/hours.yml", B.hours);
    sh(root, "add", "-A");
    sh(root, "commit", "--quiet", "-m", "Tidy");
    sh(root, "push", "--quiet", "origin", "main");
    sh(root, "fetch", "--quiet", "origin");
    expect(await studioGit(root, { remote: bare }).restoreContent(first)).toEqual({ changed: 1, back: 0, removed: 0 });
    expect(sh(root, "status", "--porcelain", "--untracked-files=all").trim()).toBe("M site/data/hours.yml");
  });
});

// ---------- the server, on a copy of this site ----------

describe("studio screens: the server", () => {
  const FEED = join(ROOT, "test", "fixtures", "iyf-events.json");
  const keys: Keychain = { has: async () => false, read: async () => null, save: async () => {}, remove: async () => {} };
  let studio: Awaited<ReturnType<typeof startStudio>>;
  let root = "", at = "";
  const call = (method: string, path: string, body?: unknown) =>
    fetch(`${at}/_studio/api/${path}`, { method, headers: { [TOKEN_HEADER]: studio.token, ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const state = async () => (await (await call("GET", "state")).json()) as StudioState;

  beforeAll(async () => {
    let bare = "";
    ({ root, bare } = repoWithRemote((to) => {
      const list = Bun.spawnSync(["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: ROOT }).stdout.toString().split("\0").filter(Boolean);
      for (const p of list) {
        if (!existsSync(join(ROOT, p)) || statSync(join(ROOT, p)).isDirectory()) continue;
        mkdirSync(dirname(join(to, p)), { recursive: true });
        cpSync(join(ROOT, p), join(to, p));
      }
      symlinkSync(join(ROOT, "node_modules"), join(to, "node_modules"));
      mkdirSync(join(ROOT, ".cache", "photos"), { recursive: true });
      mkdirSync(join(to, ".cache"));
      symlinkSync(join(ROOT, ".cache", "photos"), join(to, ".cache", "photos"));
    }));
    // A second version on "GitHub", so the history has an older one to go back to.
    put(root, "site/data/hours.yml", readFileSync(join(root, "site/data/hours.yml"), "utf8").replace(/"\d\d:\d\d"/, '"06:45"'));
    sh(root, "commit", "--quiet", "-am", "Earlier doors");
    sh(root, "push", "--quiet", "origin", "main");
    sh(root, "fetch", "--quiet", "origin");
    studio = await startStudio({ root, port: 0, events: FEED, remote: bare, keys, github: () => { throw new Error("no GitHub in this test"); }, open: () => {}, look: async () => ({ labels: [], text: [], faces: [] }) });
    at = `http://127.0.0.1:${studio.port}`;
    await studio.firstBuild;
    await studio.settled();
  }, 120_000);
  afterAll(async () => {
    await studio?.stop();
  });

  test("thumbnails are served to the editing screen only: its own Host, GET, no token in the address, and the screen's picture policy stays", async () => {
    const res = await fetch(`${at}/_studio/photo/photos/event-beer-pong.jpg`);
    expect([res.status, res.headers.get("content-type")]).toEqual([200, "image/jpeg"]);
    expect((await res.arrayBuffer()).byteLength).toBe(statSync(join(root, "site/photos/event-beer-pong.jpg")).size);
    expect((await fetch(`${at}/_studio/photo/moments/2026-10-10-a-regular.jpg`)).status).toBe(200);
    // Under the preview's name, or a foreign one, there is no such thing.
    expect((await fetch(`${at}/_studio/photo/photos/event-beer-pong.jpg`, { headers: { Host: `localhost:${studio.port}` } })).status).toBe(403);
    expect((await fetch(`${at}/_studio/photo/photos/event-beer-pong.jpg`, { headers: { Host: "evil.example" } })).status).toBe(403);
    expect((await fetch(`${at}/_studio/photo/photos/event-beer-pong.jpg`, { method: "POST" })).status).toBe(405);
    for (const path of ["data/site.yml", "photos/..%2Fdata%2Fsite.yml", "photos/%2e%2e/data/site.yml", "moments/2026-10-10-a-regular.md", "photos/nope.jpg"]) expect([path, (await fetch(`${at}/_studio/photo/${path}`)).status]).toEqual([path, 404]);
    expect((await fetch(`${at}/_studio/`)).headers.get("content-security-policy")).toContain("img-src 'self' blob:");
  });

  test("C107: the calendar is the preview's own events.json, comedy feed included, with this site's own events marked", async () => {
    const built = await (await fetch(`${at}/events.json`, { headers: { Host: `localhost:${studio.port}` } })).json();
    const upcoming = built.events.filter((e: any) => Date.parse(e.end) > Date.now() + 5_000);
    const res = await (await call("GET", "calendar")).json();
    expect(res.built).toBe(built.generated_at);
    const shown = res.months.flatMap((m: any) => m.weeks.flat()).flatMap((d: any) => d.events);
    // At most a year of months is drawn; everything of the fixture and of the site's own files falls inside it.
    for (const e of upcoming.filter((x: any) => Date.parse(x.start) < Date.now() + 300 * 864e5)) expect([e.id, shown.some((s: any) => s.id === e.id)]).toEqual([e.id, true]);
    for (const s of shown) expect([s.id, s.mine, s.file !== null]).toEqual([s.id, s.id.startsWith("manual-"), s.id.startsWith("manual-")]);
    expect(shown.filter((s: any) => s.file === "beer-pong").length).toBeGreaterThan(3);
    expect(res.months.every((m: any) => m.weeks.every((w: any) => w.length === 7 && new Date(w[0].day + "T00:00:00Z").getUTCDay() === 1))).toBe(true);
  });

  test("C108: restore through the screen's route: refused with unpublished changes, then the old hours come back as an unpublished change and the preview is rebuilt", async () => {
    const { entries } = await (await call("GET", "history")).json();
    expect(entries.map((e: any) => e.what)).toEqual(["Earlier doors", "First version"]);
    const old = entries[1].sha;
    expect((await state()).changes).toEqual([]);
    // With a change of the person's own in the folder.
    expect((await call("POST", "album", { title: { en: "Live Music", de: "Live-Musik" } })).status).toBe(200);
    const refused = await call("POST", "restore", { sha: old });
    expect([refused.status, (await refused.json()).error]).toEqual([409, "restore_changes"]);
    expect((await call("POST", "discard", { path: "site/data/albums.yml" })).status).toBe(200);
    for (const sha of ["0".repeat(40), "HEAD", "", undefined]) {
      const res = await call("POST", "restore", { sha });
      expect([sha, res.status, (await res.json()).error]).toEqual([sha, 409, "restore_unknown"]);
    }
    const head = sh(root, "rev-parse", "HEAD");
    const done = await call("POST", "restore", { sha: old });
    expect(await done.json()).toEqual({ ok: true, changed: 1, back: 0, removed: 0 });
    expect(readFileSync(join(root, "site/data/hours.yml"), "utf8")).not.toContain("06:45");
    expect((await state()).changes).toEqual([{ path: "site/data/hours.yml", status: "modified", publishable: true }]);
    expect(sh(root, "rev-parse", "HEAD")).toBe(head);
    expect(sh(root, "diff", "--cached", "--name-only")).toBe("");
    await studio.settled();
    expect((await state()).build.status).toBe("ok");
    // Without the token there is no restore.
    expect((await fetch(`${at}/_studio/api/restore`, { method: "POST", body: JSON.stringify({ sha: old }) })).status).toBe(403);
    expect((await call("POST", "discard", { path: "site/data/hours.yml" })).status).toBe(200);
  }, 60_000);

  test("C103 C105: through the real server, a photo and a drink with its picture land in the working copy, build, and are listed as publishable changes", async () => {
    const picture = (await jpeg("#804020", { IFD0: { Copyright: "secret owner" } })).toString("base64");
    const photo = await (await call("POST", "photo", { base64: picture, date: "2026-11-19", caption: { en: "A quiet corner", de: "Eine ruhige Ecke" }, alt: { en: "A corner.", de: "Eine Ecke." }, album: "drinks" })).json();
    expect(photo.path).toBe("moments/2026-11-19-a-quiet-corner.jpg");
    const drink = await (await call("POST", "drink", { part: "signatures", drink: { name: "Hot Toddy", text: { en: "Whisky", de: "Whisky" }, price_chf: 14, alt: { en: "A mug.", de: "Eine Tasse." } }, picture: { base64: picture, focus: [0.5, 0.4] } })).json();
    expect(drink).toEqual({ ok: true, photo: "photos/menu-hot-toddy.jpg" });
    await studio.settled();
    const now = await state();
    expect(now.build.status).toBe("ok");
    expect(now.changes.map((c) => [c.path, c.publishable])).toEqual([
      ["site/data/focus.yml", true], ["site/data/menu.yml", true], ["site/moments/2026-11-19-a-quiet-corner.jpg", true], ["site/moments/2026-11-19-a-quiet-corner.md", true], ["site/photos/menu-hot-toddy.jpg", true],
    ]);
    expect(describeChanges(now.changes)).toBe("1 photo added, menu updated");
    expect((await fetch(`${at}/_studio/photo/${photo.path}`)).status).toBe(200);
    const home = await (await fetch(`${at}/`, { headers: { Host: `localhost:${studio.port}` } })).text();
    expect(home).toContain("Hot Toddy");
    // Removing the photo again leaves a build that works: its focus went with it.
    expect((await call("DELETE", "photo", { id: "2026-11-19-a-quiet-corner" })).status).toBe(200);
    await studio.settled();
    const after = await state();
    expect(after.build.status).toBe("ok");
    expect(after.changes.map((c) => c.path)).toEqual(["site/data/focus.yml", "site/data/menu.yml", "site/photos/menu-hot-toddy.jpg"]);
  }, 60_000);
});
