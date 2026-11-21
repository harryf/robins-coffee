// What must hold for the content as it is today, whatever the bar has written. These are
// the only tests that read the live site/ folder (see test/frozen.ts for why). Nothing
// here may count things or name a caption, an album, a price or a time: a test that does
// fails the next change made in the Studio.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { renderSite, parseFrontMatter, type Files, type Photo } from "../src/render";
import { readFocus } from "../src/focus";
import { LIVE_SITE } from "./frozen";

const files: Files = {};
for (const p of new Bun.Glob("**/*.{md,yml,json,liquid}").scanSync({ cwd: LIVE_SITE })) files[p] = await Bun.file(join(LIVE_SITE, p)).text();
const pictures = [...new Bun.Glob("{moments,photos}/*.jpg").scanSync({ cwd: LIVE_SITE })];
const photos: Record<string, Photo> = Object.fromEntries(pictures.map((p) => [p, { width: 1200, height: 800, jpg: [{ w: 480, path: "photos/x-480.jpg" }], webp: [{ w: 480, path: "photos/x-480.webp" }] }]));
// English is the source and must be there. Another language may be missing (the page then
// shows the English), but what is there is a real text, and German is Swiss (ss, never ß).
const told = (v: any, least: number) =>
  typeof v?.en === "string" && v.en.trim().length >= least &&
  Object.entries(v).every(([lang, s]) => typeof s === "string" && s.trim().length > 0 && !(lang === "de" && s.includes("ß")));

describe("the live content", () => {
  test("every page renders with it, in every language", async () => {
    const pages = await renderSite(files, { base: "/", photos });
    for (const out of ["index.html", "de/index.html", "fr/index.html", "it/index.html", "gallery/index.html", "de/gallery/index.html", "fr/gallery/index.html", "it/gallery/index.html", "events/index.html", "de/events/index.html", "fr/events/index.html", "it/events/index.html"]) expect(pages.map((p) => p.out)).toContain(out);
  });

  test("every photo post is a picture and a text, with caption and alt text in English (and any other language) and no TODO left", () => {
    const texts = Object.keys(files).filter((p) => p.startsWith("moments/") && p.endsWith(".md"));
    expect(texts.map((p) => p.replace(/\.md$/, ".jpg")).sort()).toEqual(pictures.filter((p) => p.startsWith("moments/")).sort());
    for (const p of texts) {
      const { data } = parseFrontMatter(files[p]!);
      expect([p, told(data.caption, 3), told(data.alt, 10), files[p]!.includes("TODO")]).toEqual([p, true, true, false]);
    }
  });

  test("every album has a plain short name of its own and a title in English", () => {
    const albums = parseYaml(files["data/albums.yml"]!)?.albums ?? [];
    for (const a of albums) expect([a.slug, /^[a-z0-9-]+$/.test(a.slug), told(a.title, 2)]).toEqual([a.slug, true, true]);
    expect(new Set(albums.map((a: any) => a.slug)).size).toBe(albums.length);
  });

  test("every drink has a name, a text in English and a price; with a picture, alt text", () => {
    for (const part of parseYaml(files["data/menu.yml"]!)?.sections ?? []) {
      expect(told(part.title, 2)).toBe(true);
      for (const d of part.drinks ?? []) expect([d.name, told(d.text, 3), typeof d.price_chf === "number" && d.price_chf > 0, !d.photo || told(d.alt, 10)]).toEqual([d.name, true, true, true]);
    }
  });

  test("every event written by hand has a title and, with a text, English", () => {
    for (const p of Object.keys(files).filter((p) => p.startsWith("events/") && p.endsWith(".md") && !/README\.md$/i.test(p))) {
      const { data } = parseFrontMatter(files[p]!);
      expect([p, typeof data.title === "string" && data.title.trim().length > 1, !data.text || told(data.text, 3)]).toEqual([p, true, true]);
    }
  });

  test("every focus point names a picture that is there, with two numbers from 0 to 1", () => {
    for (const [p, at] of Object.entries(readFocus(parseYaml(files["data/focus.yml"]!)))) expect([p, pictures.includes(p), at.length === 2 && at.every((n) => n >= 0 && n <= 1)]).toEqual([p, true, true]);
  });
});
