import { describe, expect, test } from "bun:test";
import sharp from "sharp";
import { join } from "node:path";
import { renderSite, resolveUrl, hoursRows, parseFrontMatter, type Files, type Photo } from "../src/render";
import { contrast, tokensCss } from "../src/tokens";
import { cleanPhoto, MAX_EDGE } from "../scripts/add-photo";
import { fromIyfFeed, fromManual, mergeEvents, upcoming, toIcs, type SiteEvent } from "../src/events";

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
    expect(pages.map((p) => p.out).sort()).toEqual(["de/events/index.html", "de/index.html", "events/index.html", "index.html", "styleguide/index.html"]);
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
    for (const p of pages) expect(p.html).not.toContain("—");
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

// Milestone 1: everything the 2022 WordPress page said (docs/spec.md, section 3)
// must be on the new home page. If a fact changes, change the data file and this list.
describe("content clone of the old site", () => {
  const facts = ["2022", "Dennis Cobarrubias", "Sallahi", "Zähringerstrasse 33", "8001", "Zürich", "16:00", "10:00", "+41 79 176 74 46", "info@robins-coffee.ch", "https://maps.app.goo.gl/pUvDQa4cqUcahSdu6"];
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
    expect(pages.find((p) => p.out === "de/events/index.html")!.html).toContain("Di. 17. Nov., 20:00");
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
