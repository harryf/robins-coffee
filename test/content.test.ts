import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { eventFile, eventProblems, addAlbum, setDrink, removeDrink, drinkProblems, slugify } from "../src/content";
import { parseEventfrogPage, importFromPage, eventfrogUrl, eventfrogImage, plainText, shortText, fromApiEvent, listOrganiserEvents } from "../src/eventfrog";
import { fromManual, fromIyfFeed, mergeEvents } from "../src/events";
import { inEditScope } from "../src/editor/scope";

const fixture = (name: string) => Bun.file(join(import.meta.dir, "fixtures", name)).text();
import { FROZEN_SITE } from "./frozen";
const SITE = FROZEN_SITE;

describe("event files", () => {
  test("a hand event with a day, a time, a text and no ticket link reads back as it was written", () => {
    const f = eventFile({ title: "Board Game Night", date: "2026-12-03", from: "19:00", to: "23:00", text: { en: "Bring a friend.", de: "Bring jemanden mit." }, image: "photos/event-board-games.jpg" });
    expect(f.path).toBe("events/2026-12-03-board-game-night.md");
    expect(inEditScope("site/" + f.path)).toBe(true);
    const [e] = fromManual({ [f.path]: f.text });
    expect(e).toMatchObject({ title: "Board Game Night", start: "2026-12-03T19:00:00+01:00", end: "2026-12-03T23:00:00+01:00", ticket_url: "", image: "photos/event-board-games.jpg", text: { en: "Bring a friend.", de: "Bring jemanden mit." } });
  });
  test("an evening imported from Eventfrog that the comedy feed also carries is shown once, the feed's copy", async () => {
    const feed = fromIyfFeed({ events: [{ id: "brew-1", venue: "robins", name: "Comedy Brew", title: "Comedy Brew", start: "2026-11-26T19:30:00+01:00", end: "2026-11-26T22:00:00+01:00", ticket_url: "https://eventfrog.ch/en/p/comedy/x-7466832108633224028.html", go_url: "https://inyourfacecomedy.ch/go/?show=comedybrew" }] });
    const f = eventFile({ title: "Comedy Brew, English Stand-Up: Lost in town?", start: "2026-11-26T19:30:00+01:00", end: "2026-11-26T22:00:00+01:00", ticket_url: "https://eventfrog.ch/de/p/comedy/y-7466832108633224028.html", source_url: "https://eventfrog.ch/de/p/comedy/y-7466832108633224028.html" });
    const merged = mergeEvents([feed, fromManual({ [f.path]: f.text })]);
    expect(merged.map((e) => e.id)).toEqual(["iyf-brew-1"]);
  });
  test("a weekly evening and a list of dates are one file without a date in its name", () => {
    const weekly = eventFile({ title: "Beer Pong", every: "we", until: "2027-03-31" });
    expect(weekly.path).toBe("events/beer-pong.md");
    expect(fromManual({ [weekly.path]: weekly.text }, { now: new Date("2026-11-20T12:00:00+01:00") })[0]!.start).toBe("2026-11-25T00:00:00+01:00");
    const list = eventFile({ title: "Chess", dates: ["2026-12-11", "2026-11-29"] });
    expect(fromManual({ [list.path]: list.text }).map((e) => e.start.slice(0, 10))).toEqual(["2026-11-29", "2026-12-11"]);
  });
  test("an import keeps its exact times, its ticket link and where it came from", () => {
    const f = eventFile({ title: "Jazz Trio", start: "2026-12-05T20:00:00+01:00", end: "2026-12-05T22:30:00+01:00", ticket_url: "https://eventfrog.ch/de/p/x-1.html", source_url: "https://eventfrog.ch/de/p/x-1.html", price_chf: 15, category: "music", organiser: "The \"Trio\"" });
    const [e] = fromManual({ [f.path]: f.text });
    expect(e).toMatchObject({ start: "2026-12-05T20:00:00+01:00", end: "2026-12-05T22:30:00+01:00", price_chf: 15, category: "music", organiser: 'The "Trio"', ticket_url: "https://eventfrog.ch/de/p/x-1.html" });
    expect(f.path).toBe("events/2026-12-05-jazz-trio.md");
  });
  test("what is wrong is named: no title, no day, one language only, a link that is not https, a bad time", () => {
    expect(eventProblems({ title: "" })).toEqual(expect.arrayContaining(["event_title_missing", "event_date_missing"]));
    expect(eventProblems({ title: "A", date: "2026-12-03", text: { en: "Hi" } })).toEqual(["both_languages"]);
    expect(eventProblems({ title: "A", date: "3.12.2026" })).toEqual(["event_date_wrong"]);
    expect(eventProblems({ title: "A", date: "2026-12-03", ticket_url: "javascript:alert(1)" })).toEqual(["event_link_wrong"]);
    expect(eventProblems({ title: "A", date: "2026-12-03", from: "7pm" })).toEqual(["event_time_wrong"]);
    expect(eventProblems({ title: "A", date: "2026-12-03", image: "../../x.jpg" })).toEqual(["event_image_wrong"]);
    expect(() => eventFile({ title: "" })).toThrow();
  });
  test("ANTI: a loose date never becomes a file name or a line of YAML", () => {
    for (const start of ["(/../../x/) 1 Jan 2027 20:00", '1 Jan 2027 (a\nimage: "https://evil.example/x.jpg"\n#)', "2027-01-01", "2027-01-01 20:00", "2027-01-01T20:00:00+01:00\nimage: x"]) {
      expect([start, eventProblems({ title: "T", start, end: start })]).toEqual([start, ["event_time_wrong"]]);
      expect(() => eventFile({ title: "T", start, end: start })).toThrow();
    }
    expect(eventProblems({ title: "T", start: "2027-01-01T20:00:00+01:00", end: "2027-01-01T22:00:00+01:00" })).toEqual([]);
    expect(eventProblems({ title: "T", date: "2026-12-03", price_chf: "5\nimage: x" as any })).toEqual(["event_price_wrong"]);
    expect(eventProblems({ title: { en: "T" } as any, date: "2026-12-03" })).toContain("event_shape_wrong");
    expect(eventProblems({ title: "T", date: "2026-12-03", category: "other\nimage: x" as any })).toEqual(["event_shape_wrong"]);
    expect(eventProblems({ title: "T", date: "2026-12-03", source_url: "x\ny" })).toEqual(["event_link_wrong"]);
    // Text that is allowed to be anything is always written as a quoted string.
    const wild = eventFile({ title: 'A "title"\nimage: x\n---', date: "2026-12-03", organiser: "O: #1\n- x", text: { en: "a\nb: c", de: "d" } });
    const [back] = fromManual({ [wild.path]: wild.text });
    expect(back).toMatchObject({ title: 'A "title"\nimage: x\n---', organiser: "O: #1\n- x", image: null, text: { en: "a\nb: c", de: "d" } });
    expect(wild.path).toBe("events/2026-12-03-a-title-image-x.md");
  });
  test("German text never keeps a sharp s, and a slug is plain", () => {
    expect(eventFile({ title: "Strassenfest", date: "2026-12-03", text: { en: "Street party.", de: "Grosses Straßenfest." } }).text).toContain("Grosses Strassenfest.");
    expect(slugify("Queen's Gambit: Schach für Frauen!")).toBe("queen-s-gambit-schach-fur-frauen");
  });
});

describe("albums and menu", () => {
  test("an album is added to the real file, comments kept, and a second one of the same name is refused", async () => {
    const before = await Bun.file(join(SITE, "data/albums.yml")).text();
    const { text, slug } = addAlbum(before, { title: { en: "Live Music", de: "Live-Musik" } });
    expect(slug).toBe("live-music");
    expect(text.startsWith("# Gallery albums.")).toBe(true);
    const albums = parseYaml(text).albums;
    expect(albums.at(-1)).toEqual({ slug: "live-music", title: { en: "Live Music", de: "Live-Musik" } });
    expect(albums.length).toBe(parseYaml(before).albums.length + 1);
    expect(() => addAlbum(text, { title: { en: "Live Music", de: "x" } })).toThrow("album_exists");
    expect(() => addAlbum(before, { title: { en: "Only English", de: "" } })).toThrow("both_languages");
  });
  test("a drink is added to a part of the real menu, replaced by name, and removed again", async () => {
    const before = await Bun.file(join(SITE, "data/menu.yml")).text();
    const drink = { name: "Hot Toddy", text: { en: "Whisky, honey and lemon", de: "Whisky, Honig und Zitrone" }, price_chf: 14 };
    const added = setDrink(before, "signatures", drink);
    expect(added.startsWith("# The drinks menu")).toBe(true);
    const names = (t: string) => parseYaml(t).sections[0].drinks.map((d: any) => d.name);
    expect(names(added)).toEqual([...names(before), "Hot Toddy"]);
    const changed = setDrink(added, "signatures", { ...drink, price_chf: 15 });
    expect(names(changed)).toEqual(names(added));
    expect(parseYaml(changed).sections[0].drinks.at(-1).price_chf).toBe(15);
    expect(parseYaml(removeDrink(changed, "signatures", "Hot Toddy"))).toEqual(parseYaml(before));
    expect(() => removeDrink(before, "signatures", "Nope")).toThrow("drink_not_found");
  });
  test("a new part of the menu needs a title in both languages; a picture needs alt text", () => {
    const drink = { name: "Flat White", text: { en: "Double shot, steamed milk", de: "Doppelter Shot, geschäumte Milch" }, price_chf: 6 };
    expect(() => setDrink("sections: []\n", "coffee", drink)).toThrow("both_languages");
    const made = parseYaml(setDrink("sections: []\n", "coffee", drink, { en: "Coffee", de: "Kaffee" }));
    expect(made.sections[0]).toMatchObject({ slug: "coffee", title: { en: "Coffee", de: "Kaffee" }, drinks: [drink] });
    expect(drinkProblems({ ...drink, photo: "photos/menu-flat-white.jpg" })).toEqual(["alt_missing"]);
    expect(drinkProblems({ ...drink, price_chf: -1 })).toEqual(["drink_price_wrong"]);
  });
});

describe("eventfrog", () => {
  test("an event page gives one evening with title, times, picture, price and a short plain text", async () => {
    const { kind, events } = parseEventfrogPage(await fixture("eventfrog-event.html"));
    expect(kind).toBe("event");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ title: "Gratis Comedy Zum Mitnehmen - Free Entry Stand Up Comedy", start: "2026-11-22T20:00:00+01:00", end: "2026-11-22T22:00:00+01:00", price_chf: 0, organiser: "Example Organiser" });
    expect(events[0]!.url).toMatch(/^https:\/\/eventfrog\.ch\/.+-7492505145781047015\.html$/);
    expect(events[0]!.image).toMatch(/^https:\/\/res\.eventfrog\.net\//);
    expect(events[0]!.text).toBe("A laid-back new material night. Local comedians try out their newest jokes. Free entry & pay what you want.");
  });
  test("a series page gives every date it lists, each with its own ticket page", async () => {
    const { kind, events } = parseEventfrogPage(await fixture("eventfrog-series.html"));
    expect(kind).toBe("series");
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) { expect(e.url).toContain("/p/"); expect(e.url).not.toContain("gruppen"); expect(e.start).toMatch(/^\d{4}-\d{2}-\d{2}T/); expect(e.organiser).toBe("Example Organiser"); }
  });
  test("a page without an event says so", () => {
    expect(() => parseEventfrogPage("<html><body>nothing</body></html>")).toThrow(/No event/);
    expect(() => parseEventfrogPage('<script type="application/ld+json">{broken</script>')).toThrow(/No event/);
  });
  test("only https pages on Eventfrog are fetched, and a redirect elsewhere is refused", async () => {
    for (const bad of ["http://eventfrog.ch/x", "https://eventfrog.ch.evil.example/x", "https://example.com/eventfrog.ch", "file:///etc/passwd", "https://127.0.0.1/x", "not a url"]) expect(() => eventfrogUrl(bad)).toThrow();
    expect(eventfrogUrl("https://eventfrog.ch/de/p/x-1.html?utm=1#top").href).toBe("https://eventfrog.ch/de/p/x-1.html");
    let asked = "";
    const html = await fixture("eventfrog-event.html");
    const ok = await importFromPage("https://eventfrog.ch/de/p/x-1.html", async (url) => { asked = url; return { ok: true, status: 200, text: async () => html, url }; });
    expect(asked).toBe("https://eventfrog.ch/de/p/x-1.html");
    expect(ok.events).toHaveLength(1);
    // A redirect is never followed blind: the fetch is told not to follow, and a hop to another host is refused before it is asked.
    const asks: { url: string; redirect: string }[] = [];
    const hop = (to: string) => async (url: string, init: any) => { asks.push({ url, redirect: init.redirect }); return asks.length === 1 ? { ok: false, status: 302, text: async () => "", headers: { get: () => to } } : { ok: true, status: 200, text: async () => html }; };
    expect(importFromPage("https://eventfrog.ch/de/p/x-1.html", hop("https://evil.example/steal"))).rejects.toThrow(/eventfrog/);
    await Bun.sleep(5);
    expect(asks).toEqual([{ url: "https://eventfrog.ch/de/p/x-1.html", redirect: "manual" }]);
    asks.length = 0;
    expect((await importFromPage("https://eventfrog.ch/de/p/x-1.html", hop("/de/p/x-2.html"))).events).toHaveLength(1);
    expect(asks.map((a) => a.url)).toEqual(["https://eventfrog.ch/de/p/x-1.html", "https://eventfrog.ch/de/p/x-2.html"]);
    expect(importFromPage("https://eventfrog.ch/a.html", async () => ({ ok: false, status: 301, text: async () => "", headers: { get: () => "https://eventfrog.ch/a.html" } }))).rejects.toThrow(/Too many redirects/);
    expect(importFromPage("https://eventfrog.ch/de/p/x-1.html", async () => ({ ok: false, status: 404, text: async () => "" }))).rejects.toThrow(/404/);
    expect(eventfrogImage("https://res.eventfrog.net/a.webp")).toBe("https://res.eventfrog.net/a.webp");
    expect(eventfrogImage("https://evil.example/a.webp")).toBeNull();
    expect(eventfrogImage(["http://res.eventfrog.net/a.webp"])).toBeNull();
  });
  test("text helpers: tags and entities out, and a cut never lands inside a word", () => {
    expect(plainText("<p>Z&uuml;rich &amp; <b>friends</b>&nbsp;&#33;</p>")).toBe("Zürich & friends !");
    expect(shortText("One. Two is longer. Three is the longest of them all.", 22)).toBe("One. Two is longer.");
    expect(shortText("Alpha beta gamma delta epsilon zeta", 20)).toBe("Alpha beta gamma...");
  });
  test("the organiser list: the key goes in the header only, cancelled and unpublished and past events are left out", async () => {
    const rows = [
      { id: 1, beginDate: "2026-12-05T20:00:00+01:00", endDate: "2026-12-05T22:00:00+01:00", localizedInfo: [{ locale: "de", title: "Jazz Trio", shortDescription: "Drei Leute, ein Abend." }] },
      { id: 2, beginDate: "2026-12-06T20:00:00+01:00", cancelled: true, localizedInfo: [{ title: "Cancelled" }] },
      { id: 3, beginDate: "2026-12-07T20:00:00+01:00", visibility: { published: false }, localizedInfo: [{ title: "Draft" }] },
      { id: 4, beginDate: "2026-01-07T20:00:00+01:00", endDate: "2026-01-07T22:00:00+01:00", localizedInfo: [{ title: "Long ago" }] },
    ];
    let seen: any = null;
    const got = await listOrganiserEvents("SECRET-KEY", async (url, init) => { seen = { url, init }; return { ok: true, status: 200, text: async () => JSON.stringify({ totalNumberOfResources: 4, data: rows }) }; }, new Date("2026-11-20T12:00:00+01:00"));
    expect(got.map((e) => e.title)).toEqual(["Jazz Trio"]);
    expect(got[0]!.text).toBe("Drei Leute, ein Abend.");
    expect(seen.url).not.toContain("SECRET-KEY");
    expect(seen.init.headers.Authorization).toBe("Bearer SECRET-KEY");
    expect(seen.init.method).toBe("GET");
    expect(listOrganiserEvents("SECRET-KEY", async () => ({ ok: false, status: 401, text: async () => "SECRET-KEY" }))).rejects.toThrow("Eventfrog did not accept the key.");
    expect(listOrganiserEvents("", async () => ({ ok: true, status: 200, text: async () => "{}" }))).rejects.toThrow(/No Eventfrog key/);
    expect(fromApiEvent({ beginDate: "2026-12-05T20:00:00+01:00" })).toBeNull();
  });
});

import { cropBox, readFocus, draftAlt } from "../src/focus";
import { toolReport, look } from "../src/vision";

describe("focus and pictures", () => {
  test("a cut keeps its shape, stays inside the picture and sits around the focus", () => {
    expect(cropBox(1000, 2000, 1)).toEqual({ left: 0, top: 500, width: 1000, height: 1000 });
    expect(cropBox(1000, 2000, 1, [0.5, 0.1])).toEqual({ left: 0, top: 0, width: 1000, height: 1000 });
    expect(cropBox(1000, 2000, 1, [0.5, 0.95])).toEqual({ left: 0, top: 1000, width: 1000, height: 1000 });
    expect(cropBox(2000, 1000, 1, [0.25, 0.5])).toEqual({ left: 0, top: 0, width: 1000, height: 1000 });
    const og = cropBox(1080, 1454, 1200 / 630, [0.5, 0.18]);
    expect(og.width).toBe(1080);
    expect(og.top).toBe(0);
    expect(og.top + og.height).toBeLessThanOrEqual(1454);
  });
  test("focus.yml takes two numbers from 0 to 1 per photo and nothing else", async () => {
    const real = parseYaml(await Bun.file(join(SITE, "data/focus.yml")).text());
    for (const [p, f] of Object.entries(readFocus(real))) { expect(await Bun.file(join(SITE, p)).exists()).toBe(true); expect(f).toHaveLength(2); }
    expect(() => readFocus({ "photos/a.jpg": [0.5] })).toThrow(/two numbers/);
    expect(() => readFocus({ "photos/a.jpg": [0.5, 1.5] })).toThrow(/two numbers/);
    expect(readFocus(null)).toEqual({});
  });
  test("the alt text draft lists what was seen, in both languages, and guesses no German word", () => {
    const coffee = draftAlt({ labels: [{ name: "coffee", confidence: 0.9 }, { name: "liquid", confidence: 0.9 }, { name: "cup", confidence: 0.8 }, { name: "zebra_crossing", confidence: 0.5 }], text: [], faces: [] });
    expect(coffee.en).toBe("Coffee, cup, zebra crossing.");
    expect(coffee.de).toBe("Kaffee, Tasse.");
    const poster = draftAlt({ labels: [{ name: "sign", confidence: 0.7 }], text: ["BEER PONG", "EVERY WEDNESDAY"], faces: [] });
    expect(poster.en).toBe('Sign; text: "BEER PONG / EVERY WEDNESDAY".');
    expect(poster.de).toBe('Schild; Text: "BEER PONG / EVERY WEDNESDAY".');
    expect(draftAlt({ labels: [{ name: "people", confidence: 0.9 }], faces: [{}, {}] }).de).toBe("2 Personen.");
    expect(draftAlt({})).toEqual({ en: "", de: "" });
    expect(coffee.de).not.toContain("ß");
  });
  test("the tools list names what is missing and how to install it", () => {
    const none = toolReport(() => null, "darwin");
    expect(none.filter((t) => t.needed).map((t) => t.name)).toEqual(["bun", "git"]);
    expect(none.every((t) => !t.found && t.install.length > 5)).toBe(true);
    expect(toolReport((n) => "/usr/bin/" + n, "linux").find((t) => t.name === "swiftc")!.found).toBe(false);
    expect(toolReport((n) => "/usr/bin/" + n, "darwin").every((t) => t.found)).toBe(true);
  });
  test.skipIf(process.platform !== "darwin" || !Bun.which("swiftc"))("Apple Vision reads the beer pong poster: its words, no faces, a focus inside the picture", async () => {
    const seen = await look(join(import.meta.dir, ".."), join(SITE, "photos/event-beer-pong.jpg"));
    expect(seen.text.join(" ")).toContain("BEER PONG");
    expect(seen.faces).toHaveLength(0);
    expect(seen.focus!.x).toBeGreaterThan(0.2);
    expect(seen.focus!.x).toBeLessThan(0.8);
  }, 240_000);
});

import { contentApi, setFocus } from "../src/studio/content-api";
import { mkdtempSync, mkdirSync as mkdir2, cpSync as cp2, existsSync as exists2, readFileSync as read2 } from "node:fs";
import { tmpdir as tmp2 } from "node:os";
import sharp2 from "sharp";

describe("studio: content routes", () => {
  const root = mkdtempSync(join(tmp2(), "studio-content-"));
  mkdir2(join(root, "site", "data"), { recursive: true });
  mkdir2(join(root, "site", "events"), { recursive: true });
  for (const f of ["albums.yml", "menu.yml", "focus.yml"]) cp2(join(SITE, "data", f), join(root, "site", "data", f));
  const written: string[] = [];
  let removed = 0;
  const fetched: string[] = [];
  const api = contentApi({
    root,
    write: async (path, data) => { written.push(path); mkdir2(join(root, path, ".."), { recursive: true }); await Bun.write(join(root, path), data); },
    changed: () => void removed++,
    readKey: async () => null,
    fetchFn: (async (url: any) => { fetched.push(String(url)); return String(url).includes("res.eventfrog.net") ? new Response(await sharp2({ create: { width: 40, height: 60, channels: 3, background: "#804020" } }).png().toBuffer()) : new Response(await fixture("eventfrog-series.html"), { headers: { "Content-Type": "text/html" } }); }) as any,
    look: async () => ({ focus: { x: 0.25, y: 0.75 }, labels: [{ name: "coffee", confidence: 0.9 }], text: [], faces: [{ x: 0, y: 0, w: 0.1, h: 0.1 }] }),
  });
  const call = async (route: string, body: any = {}) => { const res = await api(route, async () => body); return res ? { status: res.status, data: await res.json() } : null; };
  const picture = async () => (await sharp2({ create: { width: 300, height: 200, channels: 3, background: "#203040" } }).withExif({ IFD0: { Copyright: "secret owner" } }).jpeg().toBuffer()).toString("base64");

  test("a route that is not about content is left to the server", async () => {
    expect(await call("GET state")).toBeNull();
  });
  test("looking at a picture gives a focus, a face count and a draft, and leaves no copy behind", async () => {
    const res = (await call("POST look", { base64: await picture() }))!;
    expect(res.data).toMatchObject({ width: 300, height: 200, focus: [0.25, 0.75], faces: 1, draft: { en: "One person; coffee.", de: "Eine Person; Kaffee." }, note: null });
    expect([...new Bun.Glob("look-*").scanSync({ cwd: join(root, ".cache", "studio") })]).toEqual([]);
    expect((await call("POST look", { base64: "" }))!.status).toBe(400);
    expect((await call("POST look", { base64: Buffer.from("not a picture").toString("base64") }))!.status).toBe(422);
  });
  test("a photo post writes a cleaned picture, its text and its focus, under a name made from the caption", async () => {
    const post = { base64: await picture(), date: "2026-11-20", caption: { en: "Mulled Wine!", de: "Warm, mit Spaß." }, alt: { en: "A glass.", de: "Ein Glas." }, album: "drinks", focus: [0.251, 0.75] };
    const res = (await call("POST photo", post))!;
    expect(res).toEqual({ status: 200, data: { ok: true, id: "2026-11-20-mulled-wine", path: "moments/2026-11-20-mulled-wine.jpg", album: "drinks" } });
    const meta = await sharp2(join(root, "site/moments/2026-11-20-mulled-wine.jpg")).metadata();
    expect(meta.exif).toBeUndefined();
    const md = read2(join(root, "site/moments/2026-11-20-mulled-wine.md"), "utf8");
    expect(md).toContain("album: drinks");
    expect(md).toContain("Warm, mit Spass.");
    expect(parseYaml(read2(join(root, "site/data/focus.yml"), "utf8"))["moments/2026-11-20-mulled-wine.jpg"]).toEqual([0.25, 0.75]);
    expect((await call("POST photo", { ...post, album: "nope" }))!.data.error).toBe("album_unknown");
    expect((await call("POST photo", { ...post, alt: { en: "Only English", de: "" } }))!.data.error).toBe("both_languages");
    expect((await call("POST photo", { ...post, caption: { en: "../../etc", de: "x" } }))!.data.path).toBe("moments/2026-11-20-etc.jpg");
    for (const p of written) expect([p, inEditScope(p)]).toEqual([p, true]);
  });
  test("a drink and an event take a picture that is on the site, and an event is listed with its fields", async () => {
    const shot = { base64: await picture(), focus: [0.5, 0.5] };
    expect((await call("POST drink", { part: "signatures", drink: { name: "Hot Toddy", text: { en: "Whisky", de: "Whisky" }, price_chf: 14, alt: { en: "A", de: "B" } }, picture: shot }))!.data).toEqual({ ok: true, photo: "photos/menu-hot-toddy.jpg" });
    expect((await call("POST drink", { part: "signatures", drink: { name: "X", text: { en: "a", de: "b" }, price_chf: 1, photo: "photos/nope.jpg", alt: { en: "A", de: "B" } } }))!.data.error).toBe("event_image_wrong");
    const made = (await call("POST event", { event: { title: "Board Games", date: "2026-12-03", from: "19:00", image: "photos/menu-hot-toddy.jpg" } }))!;
    expect(made.data.path).toBe("site/events/2026-12-03-board-games.md");
    // The drink goes, its picture stays: the event still uses it.
    expect((await call("DELETE drink", { part: "signatures", name: "Hot Toddy" }))!.status).toBe(200);
    expect(exists2(join(root, "site/photos/menu-hot-toddy.jpg"))).toBe(true);
    expect((await call("POST event", { event: { title: "Board Games", date: "2026-12-03" } }))!.data.error).toBe("event_exists");
    expect((await call("POST event", { event: { title: "", date: "x" } }))!.data.problems).toEqual(expect.arrayContaining(["event_title_missing", "event_date_wrong"]));
    const seen = (await call("GET content"))!.data;
    expect(seen.events).toEqual([{ path: "site/events/2026-12-03-board-games.md", title: "Board Games", source: "hand", fields: { title: "Board Games", date: "2026-12-03", from: "19:00", image: "photos/menu-hot-toddy.jpg", ticket_url: "", price_chf: null, category: "other" } }]);
    expect(seen.tools.map((x: any) => x.name)).toContain("git");
    expect((await call("DELETE event", { path: "site/events/../data/menu.yml" }))!.status).toBe(404);
    expect((await call("DELETE event", { path: made.data.path }))!.status).toBe(200);
    // The event went, and with it the picture that nothing uses any more: two things told to the screen.
    expect(removed).toBe(2);
    expect(exists2(join(root, made.data.path))).toBe(false);
    expect(exists2(join(root, "site/photos/menu-hot-toddy.jpg"))).toBe(false);
  });
  test("an album is added through the route", async () => {
    expect((await call("POST album", { title: { en: "Live Music", de: "Live-Musik" } }))!.data.slug).toBe("live-music");
    expect((await call("POST album", { title: { en: "Live Music", de: "Live-Musik" } }))!.data.error).toBe("album_exists");
  });
  test("Eventfrog: a pasted address is read, ticked dates become event files with a cleaned picture, a second add skips them", async () => {
    expect((await call("POST eventfrog/page", { address: "https://evil.example/x" }))!.data.error).toBe("eventfrog_failed");
    const read = (await call("POST eventfrog/page", { address: "https://eventfrog.ch/de/p/gruppen/x-1.html" }))!;
    expect(read.data.kind).toBe("series");
    const first = (await call("POST eventfrog/add", { events: read.data.events, category: "comedy" }))!;
    expect(first.data).toEqual({ ok: true, added: read.data.events.length, skipped: 0 });
    const file = [...new Bun.Glob("site/events/*.md").scanSync({ cwd: root })][0]!;
    const text = read2(join(root, file), "utf8");
    expect(text).toContain("category: comedy");
    expect(text).toContain("source_url: \"https://eventfrog.ch/");
    expect(text).toMatch(/image: "photos\/event-[a-z0-9-]+\.jpg"/);
    expect(fetched.filter((u) => u.includes("res.eventfrog.net")).length).toBe(1);
    expect((await call("POST eventfrog/add", { events: read.data.events }))!.data).toEqual({ ok: true, added: 0, skipped: read.data.events.length });
    expect((await call("POST eventfrog/add", { events: [{ title: "Bad", start: "2026-12-01T20:00:00+01:00", end: "2026-12-01T22:00:00+01:00", url: "https://evil.example/x", image: null }] }))!.data).toEqual({ ok: true, added: 0, skipped: 1 });
    expect((await call("GET eventfrog/list"))!.data.error).toBe("no_eventfrog_key");
    for (const p of written) expect([p, inEditScope(p)]).toEqual([p, true]);
  });
  test("focus.yml keeps its comments when a photo is added to it", () => {
    const out = setFocus("# where to cut\n\"photos/a.jpg\": [0.5, 0.2]\n", "photos/b.jpg", [0.333, 0.667]);
    expect(out.startsWith("# where to cut")).toBe(true);
    expect(parseYaml(out)).toEqual({ "photos/a.jpg": [0.5, 0.2], "photos/b.jpg": [0.33, 0.67] });
  });
});

import { buildEnv } from "../src/studio/preview";
test("studio: the preview's build never thinks it runs on GitHub", () => {
  expect(buildEnv({ PATH: "/bin", GITHUB_ACTIONS: "true", CI: "true", HOME: undefined })).toEqual({ PATH: "/bin" });
});

import { studioGit } from "../src/studio/git";
test("ANTI: a file staged by hand outside the content folders never rides along in a publish commit", async () => {
  const repo = mkdtempSync(join(tmp2(), "studio-staged-"));
  const git = (...args: string[]) => Bun.spawnSync(["git", "-c", "user.name=T", "-c", "user.email=t@example.com", ...args], { cwd: repo });
  git("init", "-q", "-b", "main");
  mkdir2(join(repo, "site", "data"), { recursive: true });
  await Bun.write(join(repo, "site", "data", "hours.yml"), "a: 1\n");
  git("add", "-A");
  git("commit", "-q", "-m", "first");
  await Bun.write(join(repo, "notes.env"), "SOMETHING=1\n");
  git("add", "notes.env");
  await Bun.write(join(repo, "site", "data", "hours.yml"), "a: 2\n");
  const studio = studioGit(repo, { remote: repo, token: async () => null });
  await studio.stage(["site/data/hours.yml"]);
  expect(studio.commit("Opening hours updated", { name: "T", email: "t@example.com" })).rejects.toThrow(/staged outside the content folders: notes\.env/);
  await Bun.sleep(300);
  expect(git("log", "--format=%s").stdout.toString().trim()).toBe("first");
  git("rm", "-q", "--cached", "notes.env");
  await studio.commit("Opening hours updated", { name: "T", email: "t@example.com" });
  expect(git("log", "-1", "--format=%s").stdout.toString().trim()).toBe("Opening hours updated");
  expect(git("show", "--name-only", "--format=").stdout.toString().trim()).toBe("site/data/hours.yml");
});

test("ANTI: the edit scope takes each folder's own kind of file in lower case, nothing else", () => {
  for (const ok of ["site/data/hours.yml", "site/data/menu.yml", "site/events/README.md", "site/events/beer-pong.md", "site/content/en/404.md", "site/moments/2026-11-20-mulled-wine.jpg", "site/moments/2026-11-20-mulled-wine.md", "site/photos/menu-lazy-monkey.jpg"]) expect([ok, inEditScope(ok)]).toEqual([ok, true]);
  for (const bad of ["site/moments/IMG_1.HEIC", "site/moments/original.png", "site/photos/x.jpeg", "site/photos/sub/x.jpg", "site/data/TOKENS.JSON", "site/data/tokens.json", "site/data/Hours.yml", "site/data/x.json", "site/events/x.sh", "site/content/en/x.html", "site/templates/a.md", "site/data/../templates/a.yml", "package.json", ".github/workflows/deploy.yml"]) expect([bad, inEditScope(bad)]).toEqual([bad, false]);
});
