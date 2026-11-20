import { describe, expect, test } from "bun:test";
import sharp from "sharp";
import { join } from "node:path";
import { renderSite, sitemapXml, resolveUrl, hoursRows, parseFrontMatter, wallClock, groupGallery, type Files, type Photo } from "../src/render";
import { checkLinks } from "../scripts/check-links";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { contrast, tokensCss } from "../src/tokens";
import { cleanPhoto, MAX_EDGE } from "../scripts/add-photo";
import { fromIyfFeed, fromManual, mergeEvents, upcoming, toIcs, zonedIso, REPEAT_DAYS, type SiteEvent } from "../src/events";

const SITE = join(import.meta.dir, "..", "site");
const files: Files = {};
for (const p of new Bun.Glob("**/*.{md,yml,json,liquid}").scanSync({ cwd: SITE })) files[p] = await Bun.file(join(SITE, p)).text();
const momentPhotos = [...new Bun.Glob("moments/*.jpg").scanSync({ cwd: SITE })];
const photoPaths = [...momentPhotos, ...new Bun.Glob("photos/*.jpg").scanSync({ cwd: SITE })];
const photos: Record<string, Photo> = Object.fromEntries(photoPaths.map((p) => [p, { width: 1200, height: 800, jpg: [{ w: 480, path: "photos/x-480.jpg" }], webp: [{ w: 480, path: "photos/x-480.webp" }] }]));
const tokens = JSON.parse(files["data/tokens.json"]!);

describe("renderer", () => {
  test("renders home in both languages plus the style guide", async () => {
    const pages = await renderSite(files, { base: "/robins-coffee/", photos });
    expect(pages.map((p) => p.out).sort()).toEqual(["404.html", "de/events/index.html", "de/gallery/index.html", "de/index.html", "edit/index.html", "events/index.html", "gallery/index.html", "index.html", "styleguide/index.html"]);
    const en = pages.find((p) => p.out === "index.html")!.html;
    const de = pages.find((p) => p.out === "de/index.html")!.html;
    expect(en).toContain('<html lang="en">');
    expect(de).toContain('<html lang="de">');
    expect(en).toContain("Zähringerstrasse 33");
    expect(en).toContain('href="/robins-coffee/de/"');
    expect(de).toContain('href="/robins-coffee/"');
  });

  test("hreflang and canonical links are absolute", async () => {
    const pages = await renderSite(files, { base: "/robins-coffee/", photos, origin: "https://example.org" });
    const de = pages.find((p) => p.out === "de/index.html")!.html;
    expect(de).toContain('<link rel="alternate" hreflang="en" href="https://example.org/robins-coffee/">');
    expect(de).toContain('<link rel="canonical" href="https://example.org/robins-coffee/de/">');
    const fallback = (await renderSite(files, { base: "/", photos })).find((p) => p.out === "index.html")!.html;
    expect(fallback).toContain('<link rel="canonical" href="https://robins-coffee.ch/">');
  });

  test("every page is noindex while site.yml says preview: true", async () => {
    const pages = await renderSite(files, { base: "/", photos });
    for (const p of pages) expect(p.html).toContain('name="robots" content="noindex');
  });

  test("German copy uses Swiss spelling (no sharp s)", async () => {
    const pages = await renderSite(files, { base: "/", photos });
    for (const p of pages.filter((p) => p.lang === "de")) expect(p.html).not.toContain("ß");
  });

  test("no em dash in any rendered page", async () => {
    const pages = await renderSite(files, { base: "/", photos });
    for (const p of pages) expect(p.html).not.toContain("\u2014");
  });

  test("moment dates use the names from i18n.yml, the same on every machine", async () => {
    const pages = await renderSite(files, { base: "/", photos });
    expect(pages.find((p) => p.out === "index.html")!.html).toContain(">31 Oct 2026</time>");
    expect(pages.find((p) => p.out === "de/index.html")!.html).toContain(">31. Okt. 2026</time>");
  });

  test("moments are newest first and each has alt text and a caption in both languages", () => {
    const moments = Object.entries(files).filter(([p]) => p.startsWith("moments/"));
    expect(moments.length).toBe(momentPhotos.length);
    for (const [, text] of moments) {
      const { data } = parseFrontMatter(text);
      for (const lang of ["en", "de"]) {
        expect(data.caption[lang].length).toBeGreaterThan(3);
        expect(data.alt[lang].length).toBeGreaterThan(10);
      }
    }
  });

  test("section photos have alt text in both languages", () => {
    const home = parseFrontMatter("---\n" + files["data/home.yml"] + "\n---\n").data;
    expect(home.about_photos.length).toBe(4);
    for (const p of home.about_photos) for (const lang of ["en", "de"]) expect(p.alt[lang].length).toBeGreaterThan(10);
  });

  test("a moment without its photo fails the build", async () => {
    expect(renderSite(files, { base: "/", photos: {} })).rejects.toThrow(/photo .* is missing/);
  });

  test("user text is escaped", async () => {
    const evil = { ...files, "content/en/index.md": files["content/en/index.md"]!.replace(/^headline:.*$/m, 'headline: "<script>x</script>. Night."') };
    const html = (await renderSite(evil, { base: "/", photos })).find((p) => p.out === "index.html")!.html;
    expect(html).not.toContain("<script>x</script>");
  });
});

// Milestone 4: every published photo is a moment; the gallery groups them by album.
describe("gallery", () => {
  const page = async (out: string, f: Files = files, p = photos) => (await renderSite(f, { base: "/robins-coffee/", photos: p })).find((x) => x.out === out)!.html;
  const m = (id: string, album?: string) => ({ id, album });

  test("albums come newest first by their newest photo, then the photos with no album", () => {
    const albums = [{ slug: "old", title: { en: "Old" } }, { slug: "new", title: { en: "New" } }, { slug: "empty", title: { en: "Empty" } }];
    // Moments arrive newest first.
    const g = groupGallery([m("5-new", "new"), m("4-loose"), m("3-old", "old"), m("2-new", "new"), m("1-loose")], albums);
    expect(g.albums.map((a) => a.slug)).toEqual(["new", "old"]);
    expect(g.albums[0]!.moments.map((x) => x.id)).toEqual(["5-new", "2-new"]);
    expect(g.loose.map((x) => x.id)).toEqual(["4-loose", "1-loose"]);
  });

  test("an album's cover photo is shown first; a cover or album that does not exist fails the build", () => {
    const g = groupGallery([m("3", "a"), m("2", "a"), m("1", "a")], [{ slug: "a", title: { en: "A" }, cover: "1" }]);
    expect(g.albums[0]!.moments.map((x) => x.id)).toEqual(["1", "3", "2"]);
    expect(() => groupGallery([m("1", "a")], [{ slug: "a", title: { en: "A" }, cover: "9" }])).toThrow(/cover/);
    expect(() => groupGallery([m("1", "nope")], [])).toThrow(/album "nope"/);
  });

  test("the gallery page shows every moment once, grouped, in both languages", async () => {
    const en = await page("gallery/index.html");
    const de = await page("de/gallery/index.html");
    for (const html of [en, de]) {
      expect(html.match(/class="moment"/g)?.length).toBe(momentPhotos.length);
      expect(html.match(/data-lightbox-group/g)?.length).toBe(4);
    }
    const order = (html: string, words: string[]) => words.map((w) => html.indexOf(`>${w}</h2>`));
    const enAt = order(en, ["Behind the bar", "Halloween 2026", "More from the bar"]);
    expect(enAt.every((i) => i > 0)).toBe(true);
    expect(enAt).toEqual([...enAt].sort((a, b) => a - b));
    const deAt = order(de, ["Hinter der Bar", "Halloween 2026", "Mehr aus der Bar"]);
    expect(deAt.every((i) => i > 0)).toBe(true);
    expect(deAt).toEqual([...deAt].sort((a, b) => a - b));
    // The regular has no album; the skeleton of 22 Oct sits with Halloween.
    expect(en.slice(enAt[2]!)).toContain("One of our regulars");
    expect(en.slice(enAt[1]!, enAt[2]!)).toContain("Our quietest guest");
    expect(en).toContain('<html lang="en">');
    expect(de).toContain('<html lang="de">');
  });

  test("the header and the home feed link to the gallery in both languages", async () => {
    const en = await page("index.html");
    const de = await page("de/index.html");
    expect(en).toContain('<a class="nav-link" href="/robins-coffee/gallery/">Photos</a>');
    expect(de).toContain('<a class="nav-link" href="/robins-coffee/de/gallery/">Fotos</a>');
    expect(en.split('id="moments"')[1]!.split("</section>")[0]).toContain('href="/robins-coffee/gallery/"');
    expect(de.split('id="moments"')[1]!.split("</section>")[0]).toContain('href="/robins-coffee/de/gallery/"');
  });

  test("feed: false keeps a moment out of the home feed and in the gallery", async () => {
    const key = "moments/2026-10-10-a-regular.md";
    const hidden = { ...files, [key]: files[key]!.replace("\ncaption:", "\nfeed: false\ncaption:") };
    expect(await page("index.html")).toContain("One of our regulars");
    expect(await page("index.html", hidden)).not.toContain("One of our regulars");
    expect(await page("gallery/index.html", hidden)).toContain("One of our regulars");
  });

  test("lightbox contract: every moment photo is a plain link to its largest JPEG", async () => {
    const sized: Record<string, Photo> = Object.fromEntries(photoPaths.map((p) => {
      const name = p.slice(p.indexOf("/") + 1, -4);
      const set = (ext: string) => [480, 1800].map((w) => ({ w, path: `photos/${name}-${w}.${ext}` }));
      return [p, { width: 1800, height: 1200, jpg: set("jpg"), webp: set("webp") }];
    }));
    for (const out of ["index.html", "de/index.html", "gallery/index.html", "de/gallery/index.html"]) {
      const html = await page(out, files, sized);
      const cards = html.split('<figure class="moment">').slice(1).map((c) => c.split("</figure>")[0]!);
      expect(cards.length).toBeGreaterThan(5);
      for (const card of cards) {
        const [, name] = /<a class="moment__link" href="\/robins-coffee\/photos\/([a-z0-9-]+)-1800\.jpg" data-lightbox data-srcset="[^"]+-1800\.webp 1800w">/.exec(card) ?? [];
        expect(`${out}: link to the largest JPEG: ${!!name}`).toBe(`${out}: link to the largest JPEG: true`);
        // The same photo inside the link, with its alt text, and a caption and date beside it.
        expect(card).toMatch(new RegExp(`<img src="/robins-coffee/photos/${name}-1800\\.jpg"[^>]+alt="[^"]{10,}"`));
        expect(card).toMatch(/class="moment__caption">[^<]+<\/span> <time datetime="\d{4}-\d\d-\d\d">/);
      }
    }
  });

  test("no moment still carries the TODO placeholder of an import", () => {
    const unfinished = Object.entries(files).filter(([p, text]) => p.startsWith("moments/") && text.includes("TODO")).map(([p]) => p);
    expect(unfinished).toEqual([]);
  });

  test("every album has a slug and a title in both languages", () => {
    const { albums } = parseFrontMatter("---\n" + files["data/albums.yml"] + "\n---\n").data;
    expect(albums.length).toBeGreaterThan(1);
    for (const a of albums) {
      expect(a.slug).toMatch(/^[a-z0-9-]+$/);
      for (const lang of ["en", "de"]) expect(a.title[lang].length).toBeGreaterThan(2);
    }
    expect(new Set(albums.map((a: any) => a.slug)).size).toBe(albums.length);
  });

  test("both languages define the same interface words", () => {
    const { en, de } = parseFrontMatter("---\n" + files["data/i18n.yml"] + "\n---\n").data;
    expect(Object.keys(de).sort()).toEqual(Object.keys(en).sort());
  });
});

// Milestone 1: everything the 2022 WordPress page said (docs/spec.md, section 3)
// must be on the new home page. If a fact changes, change the data file and this list.
describe("content clone of the old site", () => {
  const facts = ["2022", "Dennis Cobarrubias", "Sallahi", "Zähringerstrasse 33", "8001", "Zürich", "16:00", "10:00", "+41 44 253 62 02", "info@robins-coffee.ch", "https://maps.app.goo.gl/pUvDQa4cqUcahSdu6"];
  test("every fact of the old page is on the new home page, in both languages", async () => {
    const pages = await renderSite(files, { base: "/", photos });
    for (const out of ["index.html", "de/index.html"]) {
      const html = pages.find((p) => p.out === out)!.html;
      for (const fact of facts) expect(`${out} has ${fact}: ${html.includes(fact)}`).toBe(`${out} has ${fact}: true`);
      expect(html).toMatch(/cocktails/i);
    }
  });
  test("the four old photos are on the home page with the logo wordmark", async () => {
    const html = (await renderSite(files, { base: "/", photos })).find((p) => p.out === "index.html")!.html;
    expect(html.match(/class="photo-strip"/g)?.length).toBe(1);
    expect(html.split('class="photo-strip"')[1]!.split("</div>")[0]!.match(/<picture>/g)?.length).toBe(4);
    expect(html).toContain("wordmark-white.png");
  });
  test("there is a contact form with name, phone and message that writes to the bar", async () => {
    const html = (await renderSite(files, { base: "/", photos })).find((p) => p.out === "index.html")!.html;
    for (const field of ['name="name"', 'name="phone"', 'name="message"', 'data-to="info@robins-coffee.ch"']) expect(html).toContain(field);
  });
});

describe("events", () => {
  // A real copy of the comedy site feed, trimmed to ten weeks.
  const feed = JSON.parse(require("node:fs").readFileSync(join(import.meta.dir, "fixtures/iyf-events.json"), "utf8"));
  const NOW = new Date("2026-11-15T22:00:00+01:00");
  const imported = fromIyfFeed(feed);
  const withEvents = (events: SiteEvent[]) => ({ ...files, "data/events.json": JSON.stringify({ events }) });

  test("only dates at ROBIN's are kept, and ticket links go through the tracked /go/ link", () => {
    expect(imported.length).toBe(feed.events.filter((e: any) => e.venue === "robins").length);
    expect(imported.length).toBeGreaterThan(10);
    for (const e of imported) {
      expect(e.ticket_url).toMatch(/^https:\/\/inyourfacecomedy\.ch\/go\/\?show=[a-z0-9-]+&utm_source=robins&utm_medium=referral/);
      expect(e.organiser).toBe("IN YOUR FACE Comedy");
    }
  });

  test("the same event from two sources appears once, and the first source wins", () => {
    const first = imported[0]!;
    const twinByName: SiteEvent = { ...first, id: "eventfrog-1", source: "eventfrog", name: first.name.toUpperCase() + "!", ticket_url: "https://eventfrog.ch/x" };
    const twinByLink: SiteEvent = { ...first, id: "eventfrog-2", source: "eventfrog", name: "Another name" };
    const other: SiteEvent = { ...first, id: "manual-dj", source: "manual", name: "DJ night", ticket_url: "", start: first.start, end: first.end };
    const merged = mergeEvents([imported, [twinByName, twinByLink, other]]);
    expect(merged.length).toBe(imported.length + 1);
    expect(merged.filter((e) => e.start === first.start).map((e) => e.id).sort()).toEqual([first.id, "manual-dj"].sort());
    expect(new Set(merged.map((e) => e.id)).size).toBe(merged.length);
  });

  test("overrides hide, rename and feature", () => {
    const [a, b] = imported;
    const merged = mergeEvents([imported], [{ id: a!.id, hide: true }, { id: b!.id, name: "Renamed", featured: true }]);
    expect(merged.find((e) => e.id === a!.id)).toBeUndefined();
    expect(merged.find((e) => e.id === b!.id)).toMatchObject({ name: "Renamed", featured: true });
  });

  test("upcoming keeps an event until it ends and respects the window", () => {
    const e = imported[0]!;
    expect(upcoming([e], new Date(new Date(e.end).getTime() - 60_000)).length).toBe(1);
    expect(upcoming([e], new Date(new Date(e.end).getTime() + 60_000)).length).toBe(0);
    expect(upcoming(imported, NOW, 60).every((x) => new Date(x.start).getTime() <= NOW.getTime() + 60 * 864e5)).toBe(true);
  });

  test("hand-written events are read from site/events and need title, start and end", () => {
    const md = "---\ntitle: \"New Year's Eve\"\nstart: 2026-12-31T21:00:00+01:00\nend: 2027-01-01T03:00:00+01:00\nprice_chf: 0\n---\n";
    const got = fromManual({ "events/2026-12-31-nye.md": md, "events/README.md": "no front matter" });
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ id: "manual-2026-12-31-nye", source: "manual", price_chf: 0, ticket_url: "" });
    expect(() => fromManual({ "events/x.md": "---\ntitle: T\n---\n" })).toThrow(/"start" is missing/);
  });

  test("a hand event can say its day in Zürich time, with or without a time", () => {
    expect(zonedIso("2026-12-11", "19:30", "Europe/Zurich")).toBe("2026-12-11T19:30:00+01:00");
    expect(zonedIso("2027-04-09", "19:30", "Europe/Zurich")).toBe("2027-04-09T19:30:00+02:00");
    const timed = fromManual({ "events/a.md": '---\ntitle: A\ndate: 2026-12-31\nfrom: "21:00"\nto: "03:00"\n---\n' })[0]!;
    expect(timed).toMatchObject({ id: "manual-a", start: "2026-12-31T21:00:00+01:00", end: "2027-01-01T03:00:00+01:00" });
    expect(timed.all_day).toBeUndefined();
    const day = fromManual({ "events/b.md": "---\ntitle: B\ndate: 2026-12-11\n---\n" })[0]!;
    expect(day).toMatchObject({ all_day: true, start: "2026-12-11T00:00:00+01:00", end: "2026-12-12T00:00:00+01:00" });
    expect(() => fromManual({ "events/c.md": "---\ntitle: C\ndate: 11.12.2026\n---\n" })).toThrow(/not a date/);
  });

  test("one file can hold a list of dates or repeat every week", () => {
    const list = fromManual({ "events/chess.md": "---\ntitle: Chess\ndates: [2026-11-29, 2026-12-11]\ntext:\n  en: Hi\n  de: Hallo\n---\n" });
    expect(list.map((e) => e.id)).toEqual(["manual-chess-2026-11-29", "manual-chess-2026-12-11"]);
    expect(list[0]!.text).toEqual({ en: "Hi", de: "Hallo" });
    const weekly = fromManual({ "events/pong.md": "---\ntitle: Pong\nevery: we\n---\n" }, { now: NOW });
    // 15 Nov 2026 is a Sunday: the first Wednesday is the 18th, then one a week for ten weeks.
    expect(weekly[0]!.start).toBe("2026-11-18T00:00:00+01:00");
    expect(weekly).toHaveLength(Math.floor((REPEAT_DAYS - 3) / 7) + 1);
    expect(weekly.every((e) => new Date(e.start.slice(0, 10) + "T12:00:00Z").getUTCDay() === 3)).toBe(true);
    const capped = fromManual({ "events/pong.md": "---\ntitle: Pong\nevery: we\nuntil: 2026-12-02\n---\n" }, { now: NOW });
    expect(capped.map((e) => e.start.slice(0, 10))).toEqual(["2026-11-18", "2026-11-25", "2026-12-02"]);
    expect(() => fromManual({ "events/x.md": "---\ntitle: X\nevery: wednesday\n---\n" })).toThrow(/every/);
  });

  test("a card without a ticket link says people can just come, shows its text, and a day event shows no time", async () => {
    const mine = fromManual({ "events/b.md": '---\ntitle: "Board games"\ndate: 2026-11-20\ntext:\n  en: "Bring a friend."\n  de: "Bring jemanden mit."\n---\n' });
    const pages = await renderSite(withEvents(mine), { base: "/", photos, now: NOW });
    const en = pages.find((p) => p.out === "events/index.html")!.html, de = pages.find((p) => p.out === "de/events/index.html")!.html;
    expect(en).toContain("Just come by");
    expect(en).toContain("Bring a friend.");
    expect(de).toContain("Einfach vorbeikommen");
    expect(de).toContain("Bring jemanden mit.");
    expect(en).toMatch(/<time datetime="2026-11-20T00:00:00\+01:00">[^<,]*20[^<,]*<\/time>/);
    expect(en).not.toContain("00:00</time>");
    const ics = toIcs(mine, { legal_name: "R", street: "S", postal_code: "1", city: "Z" }, NOW);
    expect(ics).toContain("DTSTART;VALUE=DATE:20261120");
    expect(ics).toContain("DTEND;VALUE=DATE:20261121");
  });

  test("an event that names a photo the site does not have fails the build", async () => {
    const bad = fromManual({ "events/b.md": '---\ntitle: B\ndate: 2026-11-20\nimage: "photos/nope.jpg"\n---\n' });
    expect(renderSite(withEvents(bad), { base: "/", photos, now: NOW })).rejects.toThrow(/photo photos\/nope.jpg is missing/);
  });

  test("the events page lists every date of the next 60 days once, in both languages, in Zürich time", async () => {
    const want = upcoming(imported, NOW, 60);
    const pages = await renderSite(withEvents(imported), { base: "/", photos, now: NOW });
    for (const out of ["events/index.html", "de/events/index.html"]) {
      const html = pages.find((p) => p.out === out)!.html;
      const ends = [...html.matchAll(/class="event" data-end="([^"]+)"/g)].map((m) => m[1]);
      expect(ends.length).toBe(want.length);
      expect(ends).toEqual(want.map((e) => e.end));
      const ld = JSON.parse(/<script type="application\/ld\+json">(\{"@context":"https:\/\/schema.org","@graph".*?)<\/script>/s.exec(html)![1]!);
      expect(ld["@graph"].length).toBe(want.length);
    }
    const en = pages.find((p) => p.out === "events/index.html")!.html;
    expect(en).toContain("Tue 17 Nov, 20:00");
    expect(en).toContain("CHF 5");
    expect(en).not.toMatch(/·\s*<\/p>/); // no dangling separator when a show is in the page language
    expect(pages.find((p) => p.out === "de/events/index.html")!.html).toContain("Di, 17. Nov., 20:00");
  });

  test("wall clock time is Zürich time across the winter and summer change", () => {
    expect(wallClock(new Date("2026-11-17T19:00:00Z"), "Europe/Zurich")).toEqual({ year: 2026, month: 11, day: 17, weekday: "tu", time: "20:00" });
    expect(wallClock(new Date("2026-07-02T22:30:00Z"), "Europe/Zurich")).toEqual({ year: 2026, month: 7, day: 3, weekday: "fr", time: "00:30" });
  });

  test("the home page shows the next four, and no events section when there are none", async () => {
    const home = async (events: SiteEvent[]) => (await renderSite(withEvents(events), { base: "/", photos, now: NOW })).find((p) => p.out === "index.html")!.html;
    expect((await home(imported)).match(/class="event"/g)?.length).toBe(4);
    expect(await home([])).not.toContain('id="events"');
  });

  test("the calendar feed has one entry per event with UTC times", () => {
    const ics = toIcs(imported.slice(0, 3), { legal_name: "ROBIN's Bar & Coffee", street: "Zähringerstrasse 33", postal_code: "8001", city: "Zürich" }, NOW);
    expect(ics.match(/BEGIN:VEVENT/g)?.length).toBe(3);
    expect(ics).toContain("DTSTART:20261117T190000Z");
    expect(ics).toContain("LOCATION:ROBIN's Bar & Coffee\\, Zähringerstrasse 33\\, 8001 Zürich");
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });
});

describe("urls", () => {
  test("absolute base", () => {
    expect(resolveUrl("/de/", "/robins-coffee/", 1)).toBe("/robins-coffee/de/");
    expect(resolveUrl("/", "/", 0)).toBe("/");
  });
  test("relative base works from any depth and names index.html", () => {
    expect(resolveUrl("/", "relative", 0)).toBe("./index.html");
    expect(resolveUrl("/de/", "relative", 0)).toBe("./de/index.html");
    expect(resolveUrl("/assets/site.css", "relative", 1)).toBe("../assets/site.css");
  });
  test("external and special links pass through", () => {
    for (const u of ["https://example.com/", "mailto:a@b.ch", "tel:+41", "#visit"]) expect(resolveUrl(u, "/x/", 2)).toBe(u);
  });
});

describe("hours", () => {
  test("consecutive days collapse into a range", () => {
    const t = { days_short: { mo: "Mon", tu: "Tue", we: "Wed", th: "Thu", fr: "Fri", sa: "Sat", su: "Sun" }, range_sep: " to " };
    const rows = hoursRows({ regular: [{ days: ["mo", "tu", "we", "th", "fr"], open: "16:00", close: null }, { days: ["sa", "su"], open: "10:00", close: null }] }, t);
    expect(rows.map((r: any) => r.label)).toEqual(["Mon to Fri", "Sat, Sun"]);
  });
  test("midnight closes a range as 24:00; single days and real hours come through", () => {
    const t = { days_short: { mo: "Mon", tu: "Tue", we: "Wed", th: "Thu", fr: "Fri", sa: "Sat", su: "Sun" }, range_sep: " to " };
    const rows = hoursRows(parseFrontMatter("---\n" + files["data/hours.yml"] + "\n---\n").data, t);
    expect(rows.map((r: any) => `${r.label} ${r.open}-${r.close}`)).toEqual(["Mon to Thu 16:00-24:00", "Fri 16:00-02:00", "Sat 10:00-02:00", "Sun 10:00-24:00"]);
  });
  test("structured data carries the opening hours and never a rating", async () => {
    const html = (await renderSite(files, { base: "/", photos })).find((p) => p.out === "index.html")!.html;
    const ld = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/s.exec(html)![1]!);
    expect(ld.openingHoursSpecification.length).toBe(4);
    expect(ld.openingHoursSpecification[1]).toEqual({ "@type": "OpeningHoursSpecification", dayOfWeek: ["Friday"], opens: "16:00", closes: "02:00" });
    expect(JSON.stringify(ld)).not.toMatch(/AggregateRating|Review/);
  });
  test("the hero photo is not repeated in the feed", async () => {
    const html = (await renderSite(files, { base: "/", photos })).find((p) => p.out === "index.html")!.html;
    expect(html.match(/class="moment"/g)?.length).toBe(momentPhotos.length - 1);
  });
});

describe("design tokens", () => {
  test("every declared text and surface pair meets WCAG AA (4.5:1) in both themes", () => {
    for (const theme of ["night", "day"] as const) for (const [fg, bg] of tokens.contrast_pairs) {
      const ratio = contrast(tokens.color[theme][fg], tokens.color[theme][bg]);
      expect(`${theme} ${fg} on ${bg}: ${ratio >= 4.5}`).toBe(`${theme} ${fg} on ${bg}: true`);
    }
  });
  test("both themes define the same colour names", () => {
    expect(Object.keys(tokens.color.day).sort()).toEqual(Object.keys(tokens.color.night).sort());
  });
  test("the stylesheet uses tokens only: no raw colours at all", async () => {
    const css = await Bun.file(join(SITE, "assets/css/site.css")).text();
    const raw = css.split("\n").filter((l) => /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i.test(l));
    expect(raw).toEqual([]);
    expect(tokensCss(tokens)).toContain(".on-photo {");
    expect(tokensCss(tokens)).toContain("--c-neon: #ff4fa8");
  });
});

// Milestone 6: the design system is complete when nothing shared is typed by hand.
const css = await Bun.file(join(SITE, "assets/css/site.css")).text();
describe("design system", () => {
  // Properties whose values are shared scales. A component's own geometry (width, height,
  // columns, transforms, positions) is not in this list on purpose.
  const SCALED = /^(font|font-size|font-weight|font-family|line-height|letter-spacing|gap|column-gap|row-gap|margin(-[a-z-]+)?|padding(-[a-z-]+)?|border(-[a-z-]+)?|outline|outline-offset|z-index|box-shadow|transition|animation|max-width)$/;
  const BARE = /^(font-weight|line-height|z-index)$/;

  test("shared values in the stylesheet are tokens: type, space, borders, radius, shadow, motion, layers, measures", () => {
    const raw: string[] = [];
    for (const line of css.split("\n").filter((l) => !l.includes("/* shape */"))) {
      for (const m of line.matchAll(/([a-z-]+)\s*:\s*([^;{}]+)[;}]/g)) {
        const [, prop, value] = m as unknown as [string, string, string];
        if (!SCALED.test(prop)) continue;
        const rest = value.replace(/var\(--[a-z0-9-]+\)/g, "").replace(/\b(0|50%|100%)(?![\w.%])/g, "");
        if (/\d*\.?\d+(px|rem|em|ms|s|%|vw|vh)\b/.test(rest) || (BARE.test(prop) && /\d/.test(rest)) || (/^font(-family)?$/.test(prop) && /["']|serif/.test(rest))) raw.push(`${prop}: ${value.trim()}`);
      }
    }
    expect(raw).toEqual([]);
  });

  test("every token the stylesheet uses exists, and every media query uses a breakpoint token", () => {
    const made = tokensCss(tokens);
    for (const m of css.matchAll(/var\((--[a-z0-9-]+)\)/g)) if (!/^--(gap|scrim)$/.test(m[1]!)) expect(made).toContain(`  ${m[1]}: `);
    const points = Object.values(tokens.breakpoint as Record<string, string>).map(parseFloat);
    const used = [...css.matchAll(/@media[^{]*\{/g)].flatMap((m) => [...m[0].matchAll(/([\d.]+)rem/g)].map((x) => Number(x[1])));
    expect(used.length).toBeGreaterThan(5);
    // "max-width: 47.99rem" is the breakpoint 48rem seen from below.
    for (const v of used) expect(points.some((p) => p === v || Math.abs(p - 0.01 - v) < 1e-9)).toBe(true);
  });

  test("every token group becomes custom properties, except breakpoints", () => {
    const made = tokensCss(tokens);
    for (const [group, values] of Object.entries(tokens)) {
      if (["color", "contrast_pairs", "breakpoint"].includes(group)) continue;
      for (const name of Object.keys(values as object)) expect(made).toContain(`  --${group}-${name}: `);
    }
  });

  test("no template styles anything inline; only the style guide may, and only with tokens", () => {
    for (const [path, text] of Object.entries(files)) {
      if (!path.startsWith("templates/")) continue;
      const styles = [...text.matchAll(/\sstyle="([^"]*)"/g)].map((m) => m[1]!);
      if (path !== "templates/layouts/styleguide.liquid") expect([path, styles]).toEqual([path, []]);
      else for (const s of styles) expect(s.replace(/var\(--[a-z-]+\{\{[^}]+\}\}\)|\{\{[^}]+\}\}/g, "")).not.toMatch(/\d/);
    }
  });

  test("every component and section has a top comment and its own style guide entry", async () => {
    const guide = (await renderSite(files, { base: "/", photos })).find((p) => p.out === "styleguide/index.html")!.html;
    const parts = Object.keys(files).filter((p) => /^templates\/(components|sections)\//.test(p));
    expect(parts.length).toBeGreaterThan(15);
    expect(guide).not.toContain("No example yet");
    for (const p of parts) {
      expect([p, /^\{%-? comment %\}/.test(files[p]!)]).toEqual([p, true]);
      expect(guide).toContain(`data-sg="${p.slice(10, -7)}"`);
    }
    for (const p of Object.keys(files).filter((p) => /^templates\/layouts\//.test(p))) expect(guide).toContain(`<code>${p.slice(10, -7)}</code>`);
  });

  test("the style guide shows every token group and the contrast of every pair", async () => {
    const guide = (await renderSite(files, { base: "/", photos })).find((p) => p.out === "styleguide/index.html")!.html;
    for (const group of Object.keys(tokens)) if (group !== "contrast_pairs") expect(guide).toContain(`data-sg-tokens="${group}"`);
    expect((guide.match(/data-sg-pair/g) ?? []).length).toBe(tokens.contrast_pairs.length);
  });
});

describe("photo cleaning", () => {
  test("strips EXIF and GPS, caps the long edge, keeps sRGB", async () => {
    const dirty = await sharp({ create: { width: 3200, height: 1600, channels: 3, background: "#804060" } })
      .withExif({ IFD0: { Make: "TestCam", Artist: "Somebody" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "47/1 22/1 0/1" } })
      .jpeg().toBuffer();
    expect((await sharp(dirty).metadata()).exif).toBeDefined();
    const { data, width, height } = await cleanPhoto(dirty);
    const meta = await sharp(data).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
    expect(Math.max(width, height)).toBe(MAX_EDGE);
    expect(meta.space).toBe("srgb");
  });
  test("no committed photo carries metadata or exceeds the cap", async () => {
    for (const p of photoPaths) {
      const meta = await sharp(join(SITE, p)).metadata();
      expect(`${p} exif:${!!meta.exif} xmp:${!!meta.xmp} iptc:${!!meta.iptc}`).toBe(`${p} exif:false xmp:false iptc:false`);
      expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(MAX_EDGE);
    }
  });
});

// Milestone 5: the things a visitor never asks for and notices when they are missing.
describe("polish", () => {
  const hero = parseFrontMatter("---\n" + files["data/home.yml"] + "\n---\n").data.hero_photo as string;
  const withOg = { ...photos, [hero]: { ...photos[hero]!, og: "og/hero-abc.jpg" } };

  test("every page a search engine may list exists in every language", async () => {
    const pages = await renderSite(files, { base: "/", photos });
    const listed = pages.filter((p) => !p.data.noindex);
    for (const p of listed) expect(listed.filter((o) => o.slug === p.slug).map((o) => o.lang).sort()).toEqual(["de", "en"]);
  });

  test("the 404 page sits at the root, speaks both languages and uses no link relative to itself", async () => {
    const page = (await renderSite(files, { base: "/robins-coffee/", photos, origin: "https://example.org" })).find((p) => p.out === "404.html")!;
    expect(page.html).toContain("This page is not here");
    expect(page.html).toContain('<div class="notfound__block prose" lang="de"');
    expect(page.html).toContain('href="/robins-coffee/de/"');
    expect(page.html).toContain('name="robots" content="noindex');
    expect(page.html).not.toContain('rel="canonical"');
    for (const m of page.html.matchAll(/\s(?:href|src)="([^"]*)"/g)) expect(m[1]).toMatch(/^(\/robins-coffee\/|https?:|mailto:|tel:|#)/);
  });

  test("the sitemap lists the public pages with full addresses and their language versions", async () => {
    const pages = await renderSite(files, { base: "/robins-coffee/", photos });
    const xml = sitemapXml(pages, "en", (p) => "https://example.org/robins-coffee" + p);
    expect([...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])).toEqual(["/", "/de/", "/de/events/", "/de/gallery/", "/events/", "/gallery/"].map((p) => "https://example.org/robins-coffee" + p));
    expect(xml).not.toContain("styleguide");
    expect(xml).not.toContain("404");
    expect(xml.match(/hreflang="x-default" href="https:\/\/example.org\/robins-coffee\/events\/"/g)!.length).toBe(2);
  });

  test("every page carries link preview data; the picture is absolute and described in the page language", async () => {
    const pages = await renderSite(files, { base: "/robins-coffee/", photos: withOg, origin: "https://example.org" });
    for (const p of pages) {
      expect(p.html).toContain('<meta property="og:title" content="');
      expect(p.html).toContain('<meta property="og:image" content="https://example.org/robins-coffee/og/hero-abc.jpg">');
      expect(p.html).toContain('<meta property="og:image:width" content="1200">');
      expect(p.html).toContain('<meta name="twitter:card" content="summary_large_image">');
    }
    const de = pages.find((p) => p.out === "de/index.html")!.html;
    expect(de).toContain('<meta property="og:locale" content="de_CH">');
    expect(de).toContain('<meta property="og:locale:alternate" content="en_GB">');
    expect(de).toContain('<meta property="og:url" content="https://example.org/robins-coffee/de/">');
    expect(de).toContain('<link rel="alternate" hreflang="x-default" href="https://example.org/robins-coffee/">');
    const alt = /og:image:alt" content="([^"]+)"/.exec(de)![1]!;
    const en = /og:image:alt" content="([^"]+)"/.exec(pages.find((p) => p.out === "index.html")!.html)![1]!;
    expect(alt.length).toBeGreaterThan(10);
    expect(alt).not.toBe(en);
  });

  test("without a preview picture the page says nothing about one", async () => {
    const html = (await renderSite(files, { base: "/", photos })).find((p) => p.out === "index.html")!.html;
    expect(html).not.toContain("og:image");
    expect(html).not.toContain("twitter:card");
  });

  test("favicons are linked through the base", async () => {
    const html = (await renderSite(files, { base: "/robins-coffee/", photos })).find((p) => p.out === "de/events/index.html")!.html;
    expect(html).toContain('<link rel="icon" href="/robins-coffee/favicon.ico" sizes="32x32">');
    expect(html).toContain('<link rel="apple-touch-icon" href="/robins-coffee/assets/icons/apple-touch-icon.png');
  });

  test("a closed day in the hours table reads Closed, not Closed today", () => {
    const { en } = parseFrontMatter("---\n" + files["data/i18n.yml"] + "\n---\n").data;
    expect(files["templates/components/hours.liquid"]).toContain("t.closed }}");
    expect(en.closed).toBe("Closed");
  });
});

describe("link check", () => {
  const site = async (pages: Record<string, string>) => {
    const dir = await mkdtemp(join(tmpdir(), "robins-links-"));
    for (const [name, body] of Object.entries(pages)) {
      await mkdir(join(dir, name, ".."), { recursive: true });
      await Bun.write(join(dir, name), body);
    }
    return dir;
  };

  test("a sound site passes: pages, folders, anchors, images, queries, its own full address", async () => {
    const dir = await site({
      "index.html": '<a href="/shop/de/">de</a> <a href="/shop/de/#top">top</a> <a href="#here">here</a> <p id="here"></p> <img src="/shop/photos/A.jpg?v=1" srcset="/shop/photos/A.jpg 480w, /shop/photos/A.jpg 800w"> <a href="https://elsewhere.example/">out</a> <link rel="canonical" href="https://example.org/shop/"> <meta property="og:image" content="https://example.org/shop/photos/A.jpg">',
      "de/index.html": '<h1 id="top">x</h1><a href="/shop/">home</a>',
      "photos/A.jpg": "x",
      "site.css": "@font-face { src: url(\"photos/A.jpg\") }",
    });
    const report = await checkLinks(dir, "/shop/", "https://example.org");
    expect(report.problems).toEqual([]);
    expect(report.external).toBe(1);
    await rm(dir, { recursive: true });
  });

  test("it names a missing page, a wrong case, a missing anchor, a link outside the base and a relative link", async () => {
    const dir = await site({
      "index.html": '<a href="/shop/nope/">1</a> <img src="/shop/photos/a.jpg"> <a href="/shop/de/#gone">3</a> <a href="/de/">4</a> <a href="de/">5</a>',
      "de/index.html": "<p>x</p>",
      "photos/A.jpg": "x",
    });
    const { problems } = await checkLinks(dir, "/shop/");
    expect(problems.length).toBe(5);
    expect(problems[0]).toContain("does not exist");
    expect(problems[1]).toContain("spelled photos/A.jpg");
    expect(problems[2]).toContain("#gone");
    expect(problems[3]).toContain("does not start with the base");
    expect(problems[4]).toContain("is relative");
    await rm(dir, { recursive: true });
  });

  test("a relative build is checked from each page's own folder", async () => {
    const dir = await site({ "index.html": '<a href="./de/index.html">de</a>', "de/index.html": '<a href="../index.html">home</a> <a href="../missing.html">x</a>' });
    const { problems } = await checkLinks(dir, "relative");
    expect(problems.length).toBe(1);
    expect(problems[0]).toContain("missing.html");
    await rm(dir, { recursive: true });
  });
});

// 16 Nov 2026: the coffee theme for the day, the switch, the ticker without its button.
describe("day and night", () => {
  test("a dark day theme needs no special case; a light one would get night colours on photos and dark logos", () => {
    const dark = tokensCss(tokens);
    expect(dark).not.toContain("invert(1)");
    expect(dark).toContain(".on-photo { color: var(--c-text); }");
    const light = tokensCss({ ...tokens, color: { ...tokens.color, day: { ...tokens.color.day, bg: "#ffffff" } } });
    expect(light).toContain(':root[data-theme="day"] .on-photo {');
    expect(light).toContain(':root[data-theme="day"] .theme-invert { filter: invert(1); }');
    expect(light).toContain("color-scheme: light");
  });
  test("the home page has a hero photo per theme, the header a switch that JavaScript reveals, and the ticker is one button with no pause mark", async () => {
    const html = (await renderSite(files, { base: "/", photos })).find((p) => p.out === "index.html")!.html;
    expect(html).toContain('class="hero__shot" data-theme-only="night"');
    expect(html).toContain('class="hero__shot hero__shot--day" data-theme-only="day"');
    expect(html).not.toContain('fetchpriority="high"'); // only the photo on show may load, so neither is forced
    expect(html).toMatch(/<button class="theme-switch"[^>]*role="switch"[^>]*data-theme-switch hidden>/);
    expect(html).toMatch(/<button class="ticker" type="button" data-ticker aria-pressed="false" aria-label="[^"]+">/);
    expect(html).not.toContain("ticker__pause");
    expect(html).toContain('sessionStorage.getItem("theme")');
    const de = (await renderSite(files, { base: "/", photos })).find((p) => p.out === "de/index.html")!.html;
    expect(de).toContain('aria-label="Nachtfarben"');
  });
});

describe("menu", () => {
  const menu = parseFrontMatter("---\n" + files["data/menu.yml"] + "\n---\n").data;
  test("every drink has a name, a text in both languages, a price and, with a picture, alt text in both", () => {
    expect(menu.sections.length).toBeGreaterThan(0);
    for (const part of menu.sections) {
      expect(part.slug).toMatch(/^[a-z0-9-]+$/);
      for (const lang of ["en", "de"]) expect(part.title[lang]).toBeTruthy();
      for (const d of part.drinks) {
        expect(d.name).toBeTruthy();
        expect(typeof d.price_chf).toBe("number");
        for (const lang of ["en", "de"]) {
          expect(d.text[lang]).toBeTruthy();
          expect(d.text[lang]).not.toContain("ß");
          if (d.photo) expect(d.alt[lang]).toBeTruthy();
        }
        if (d.photo) expect(photos[d.photo]).toBeDefined();
      }
    }
  });
  test("the home page shows every drink with its price in both languages", async () => {
    const pages = await renderSite(files, { base: "/", photos });
    for (const [out, lang] of [["index.html", "en"], ["de/index.html", "de"]] as const) {
      const html = pages.find((p) => p.out === out)!.html;
      expect(html).toContain('id="menu"');
      for (const d of menu.sections.flatMap((p: any) => p.drinks)) {
        expect(html).toContain(d.name);
        expect(html).toContain(d.text[lang].replace(/&/g, "&amp;"));
        expect(html).toContain(`CHF ${d.price_chf}`);
      }
    }
  });
  test("a menu photo that is missing fails the build", async () => {
    const broken = { ...files, "data/menu.yml": files["data/menu.yml"]!.replace("photos/menu-lazy-monkey.jpg", "photos/nope.jpg") };
    expect(renderSite(broken, { base: "/", photos })).rejects.toThrow(/photo photos\/nope.jpg of "Lazy Monkey" is missing/);
  });
});
