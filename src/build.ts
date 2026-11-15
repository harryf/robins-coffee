#!/usr/bin/env bun
// Build the site into dist/.   bun src/build.ts [--base /robins-coffee/ | relative] [--origin https://host] [--out dist]
//                                                [--events <file or URL of the comedy feed>]
// Everything about HOW a page looks lives in src/render.ts and site/; this file only
// does what needs a disk: reading files, resizing photos, copying assets.
import sharp from "sharp";
import { parseArgs } from "node:util";
import { mkdir, rm, cp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { renderSite, type Files, type Photo } from "./render";
import { tokensCss } from "./tokens";
import { parse as parseYaml } from "yaml";
import { fromIyfFeed, fromManual, mergeEvents, upcoming, toIcs, type SiteEvent } from "./events";

const ROOT = join(import.meta.dir, "..");
const SITE = join(ROOT, "site");
const CACHE = join(ROOT, ".cache", "photos");
const WIDTHS = [480, 640, 800, 1200, 1800];
const TEXT = /\.(md|yml|json|liquid)$/;

const { values } = parseArgs({ args: Bun.argv.slice(2), options: { base: { type: "string", default: "/" }, out: { type: "string", default: "dist" }, origin: { type: "string" }, events: { type: "string" } } });
const base = values.base === "relative" ? "relative" : "/" + values.base!.replace(/^\/|\/$/g, "") + (values.base === "/" ? "" : "/");
const OUT = join(ROOT, values.out!);

async function readSite(): Promise<Files> {
  const files: Files = {};
  for await (const p of new Bun.Glob("**/*").scan({ cwd: SITE })) if (TEXT.test(p)) files[p] = await Bun.file(join(SITE, p)).text();
  return files;
}

/** Resize every photo (the moments feed and plain section photos) into webp and jpg at a few widths; cached by content hash. */
async function buildPhotos(): Promise<Record<string, Photo>> {
  const photos: Record<string, Photo> = {};
  await mkdir(CACHE, { recursive: true });
  await mkdir(join(OUT, "photos"), { recursive: true });
  for await (const p of new Bun.Glob("{moments,photos}/*.jpg").scan({ cwd: SITE })) {
    const bytes = new Uint8Array(await Bun.file(join(SITE, p)).arrayBuffer());
    const hash = Bun.hash(bytes).toString(36).slice(0, 8);
    const meta = await sharp(bytes).metadata();
    const name = p.slice(p.indexOf("/") + 1, -4);
    const widths = WIDTHS.filter((w) => w < meta.width!).concat(meta.width! <= WIDTHS.at(-1)! ? [meta.width!] : []);
    const photo: Photo = { width: meta.width!, height: meta.height!, jpg: [], webp: [] };
    for (const w of widths) for (const ext of ["jpg", "webp"] as const) {
      const file = `${name}-${w}-${hash}.${ext}`;
      const cached = join(CACHE, file);
      if (!existsSync(cached)) {
        const img = sharp(bytes).resize({ width: w });
        await (ext === "jpg" ? img.jpeg({ quality: 78, progressive: true, mozjpeg: true }) : img.webp({ quality: 74 })).toFile(cached);
      }
      await cp(cached, join(OUT, "photos", file));
      photo[ext].push({ w, path: `photos/${file}` });
    }
    photos[p] = photo;
  }
  return photos;
}

async function buildAssets(files: Files): Promise<string> {
  const assets = join(OUT, "assets");
  await mkdir(join(assets, "fonts"), { recursive: true });
  const fonts: [string, string][] = [
    ["@fontsource/alfa-slab-one/files/alfa-slab-one-latin-400-normal.woff2", "alfa-slab-one.woff2"],
    ["@fontsource-variable/dm-sans/files/dm-sans-latin-wght-normal.woff2", "dm-sans.woff2"],
  ];
  for (const [from, to] of fonts) await cp(join(ROOT, "node_modules", from), join(assets, "fonts", to));
  let css = tokensCss(JSON.parse(files["data/tokens.json"]!));
  for (const p of [...new Bun.Glob("assets/css/*.css").scanSync({ cwd: SITE })].sort()) css += "\n" + (await Bun.file(join(SITE, p)).text());
  await Bun.write(join(assets, "site.css"), css);
  await cp(join(SITE, "assets", "js"), join(assets, "js"), { recursive: true });
  await cp(join(SITE, "assets", "brand"), join(assets, "brand"), { recursive: true });
  return Bun.hash(css).toString(36).slice(0, 8);
}

const warn = (msg: string) => console.warn(process.env.GITHUB_ACTIONS ? `::warning title=Events::${msg}` : `WARNING: ${msg}`);
const getJson = async (src: string) => (/^https?:/.test(src) ? await (await fetch(src, { signal: AbortSignal.timeout(20_000) })).json() : JSON.parse(await Bun.file(src).text()));

/**
 * Imported events are fetched now and never committed. If the comedy feed cannot be
 * read, the list this site published last time is used instead, with a warning, so a
 * bad morning at the source never empties the calendar.
 */
async function loadEvents(files: Files): Promise<SiteEvent[]> {
  const site = parseYaml(files["data/site.yml"]!);
  const overrides = parseYaml(files["data/event-overrides.yml"] ?? "")?.overrides ?? [];
  const manual = fromManual(files);
  const feed = values.events ?? site.events_feed;
  try {
    const imported = fromIyfFeed(await getJson(feed), site.events_feed_venue);
    if (!imported.length) warn(`the feed ${feed} holds no event at this venue`);
    return mergeEvents([imported, manual], overrides);
  } catch (error) {
    const last = base === "relative" || !values.origin ? null : `${values.origin}${base}events.json`;
    try {
      if (!last) throw new Error("no published copy to fall back to in this kind of build");
      const kept: SiteEvent[] = (await getJson(last)).events.filter((e: SiteEvent) => e.source !== "manual");
      warn(`could not read ${feed} (${error}); using the ${kept.length} imported events published last time`);
      return mergeEvents([kept, manual], overrides);
    } catch (second) {
      warn(`could not read ${feed} (${error}) and there is no earlier copy (${second}); building with hand-written events only`);
      return mergeEvents([manual], overrides);
    }
  }
}

/** Flyer thumbnails of the events shown on the site, fetched and resized; a failed one is just left out. */
async function buildEventImages(events: SiteEvent[], photos: Record<string, Photo>) {
  for (const src of new Set(events.map((e) => e.image).filter((s): s is string => !!s))) {
    try {
      const key = Bun.hash(src).toString(36).slice(0, 10);
      const original = join(CACHE, `event-${key}.orig`);
      if (!existsSync(original)) await Bun.write(original, await (await fetch(src, { signal: AbortSignal.timeout(20_000) })).arrayBuffer());
      const bytes = new Uint8Array(await Bun.file(original).arrayBuffer());
      const photo: Photo = { width: 400, height: 400, jpg: [], webp: [] };
      for (const w of [200, 400]) for (const ext of ["jpg", "webp"] as const) {
        const file = `event-${key}-${w}.${ext}`;
        const img = sharp(bytes).resize({ width: w, height: w, fit: "cover" }).flatten({ background: "#000000" });
        await (ext === "jpg" ? img.jpeg({ quality: 78, mozjpeg: true }) : img.webp({ quality: 74 })).toFile(join(OUT, "photos", file));
        photo[ext].push({ w, path: `photos/${file}` });
      }
      photos[src] = photo;
    } catch (error) {
      warn(`event image ${src} could not be used (${error})`);
    }
  }
}

const started = performance.now();
await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
const files = await readSite();
const photos = await buildPhotos();
const version = await buildAssets(files);
const now = new Date();
const events = await loadEvents(files);
await buildEventImages(upcoming(events, now, 60), photos);
// The merged list is a build product: the renderer reads it as data, visitors and the
// next build (as a fallback) can fetch it, and it never enters git.
files["data/events.json"] = JSON.stringify({ generated_at: now.toISOString(), events }, null, 1);
await Bun.write(join(OUT, "events.json"), files["data/events.json"]);
await Bun.write(join(OUT, "events.ics"), toIcs(upcoming(events, now), parseYaml(files["data/site.yml"]!), now));
const pages = await renderSite(files, { base, photos, version, origin: values.origin, now });
for (const page of pages) {
  await mkdir(dirname(join(OUT, page.out)), { recursive: true });
  await Bun.write(join(OUT, page.out), page.html);
}
await Bun.write(join(OUT, ".nojekyll"), "");
// While the preview flag is on, ask crawlers to stay away from the whole site.
const preview = /^preview:\s*true/m.test(files["data/site.yml"]!);
await Bun.write(join(OUT, "robots.txt"), preview ? "User-agent: *\nDisallow: /\n" : "User-agent: *\nAllow: /\nDisallow: /styleguide/\n");
console.log(`built ${pages.length} pages, ${upcoming(events, now).length} upcoming events, ${Object.keys(photos).length} photos into ${values.out}/ (base ${base}) in ${Math.round(performance.now() - started)} ms`);
