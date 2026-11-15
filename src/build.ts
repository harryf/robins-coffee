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
import { renderSite, sitemapXml, resolveUrl, parseFrontMatter, OG_SIZE, type Files, type Photo } from "./render";
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

/**
 * Link preview pictures for chat apps and social sites: the photo cropped to OG_SIZE,
 * kept from the top (faces sit high in a photo), darkened towards the bottom, with the wordmark on it. No text is drawn, so the
 * picture is the same on every machine. Made for the hero photo and any page's `og_photo`.
 */
async function buildOg(files: Files, photos: Record<string, Photo>) {
  const night = JSON.parse(files["data/tokens.json"]!).color.night;
  const keys = new Set<string>([parseYaml(files["data/home.yml"]!).hero_photo]);
  for (const [p, text] of Object.entries(files)) if (p.startsWith("content/") && parseFrontMatter(text).data.og_photo) keys.add(parseFrontMatter(text).data.og_photo);
  const { width, height } = OG_SIZE;
  const shade = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0.35" stop-color="${night.bg}" stop-opacity="0"/><stop offset="1" stop-color="${night.bg}" stop-opacity="0.9"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`);
  const wordmark = await sharp(join(SITE, "assets", "brand", "wordmark-white.png")).resize({ width: 420 }).toBuffer({ resolveWithObject: true });
  await mkdir(join(OUT, "og"), { recursive: true });
  for (const key of keys) {
    if (!photos[key]) throw new Error(`link preview: photo ${key} is missing`);
    const bytes = new Uint8Array(await Bun.file(join(SITE, key)).arrayBuffer());
    const file = `og/${key.slice(key.indexOf("/") + 1, -4)}-${Bun.hash(bytes).toString(36).slice(0, 8)}.jpg`;
    await sharp(bytes).resize({ width, height, fit: "cover", position: "north" })
      .composite([{ input: shade }, { input: wordmark.data, left: 64, top: height - wordmark.info.height - 52 }])
      .jpeg({ quality: 82, mozjpeg: true }).toFile(join(OUT, file));
    photos[key]!.og = file;
  }
}

/**
 * The editor at /edit/: its script (the renderer and the forms, bundled for the browser),
 * the site's text files and photo list in one file so the editor can show the real
 * page without a login, a web app manifest and a small service worker.
 */
async function buildEditor(files: Files, photos: Record<string, Photo>, version: string) {
  const dir = join(OUT, "edit");
  await mkdir(dir, { recursive: true });
  const built = await Bun.build({ entrypoints: [join(ROOT, "src", "editor", "main.ts")], target: "browser", minify: true, outdir: dir, naming: "editor.js" });
  if (!built.success) throw new Error("editor bundle failed:\n" + built.logs.join("\n"));
  const site = parseYaml(files["data/site.yml"]!);
  const night = JSON.parse(files["data/tokens.json"]!).color.night;
  await Bun.write(join(dir, "site.json"), JSON.stringify({ built_at: new Date().toISOString(), base, preview_root: base.replace(/pr-preview\/pr-\d+\/$/, ""), version, repo: site.repo, branch: site.branch, files, photos }));
  await Bun.write(join(dir, "manifest.webmanifest"), JSON.stringify({
    name: `${site.name} editor`, short_name: `${site.name} edit`, start_url: "./", scope: "./", display: "standalone",
    background_color: night.bg, theme_color: night.bg,
    icons: [192, 512].map((s) => ({ src: `../assets/icons/icon-${s}.png`, sizes: `${s}x${s}`, type: "image/png" })),
  }, null, 1));
  await cp(join(ROOT, "src", "editor", "sw.js"), join(dir, "sw.js"));
}

/** Favicons: the R on the night colour for the small sizes, the roundel for the home screen sizes. Bitmaps until vector logos arrive. */
async function buildIcons(files: Files) {
  const background = JSON.parse(files["data/tokens.json"]!).color.night.bg;
  const icon = async (mark: string, size: number, inner: number) =>
    sharp({ create: { width: size, height: size, channels: 4, background } })
      .composite([{ input: await sharp(join(SITE, "assets", "brand", mark)).resize({ width: inner, height: inner, fit: "inside" }).toBuffer() }])
      .png().toBuffer();
  await mkdir(join(OUT, "assets", "icons"), { recursive: true });
  const small = await icon("r-mark-white.png", 32, 30);
  await Bun.write(join(OUT, "assets", "icons", "icon-32.png"), small);
  await Bun.write(join(OUT, "assets", "icons", "icon-192.png"), await icon("logo-roundel-white.png", 192, 168));
  await Bun.write(join(OUT, "assets", "icons", "icon-512.png"), await icon("logo-roundel-white.png", 512, 448));
  await Bun.write(join(OUT, "assets", "icons", "apple-touch-icon.png"), await icon("logo-roundel-white.png", 180, 156));
  // favicon.ico is a six byte header, one sixteen byte entry and the 32 px PNG itself.
  const head = Buffer.alloc(22);
  head.writeUInt16LE(1, 2); head.writeUInt16LE(1, 4);
  head.writeUInt8(32, 6); head.writeUInt8(32, 7); head.writeUInt16LE(1, 10); head.writeUInt16LE(32, 12);
  head.writeUInt32LE(small.length, 14); head.writeUInt32LE(22, 18);
  await Bun.write(join(OUT, "favicon.ico"), Buffer.concat([head, small]));
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
await buildOg(files, photos);
await buildIcons(files);
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
await buildEditor(files, photos, version);
for (const page of pages) {
  await mkdir(dirname(join(OUT, page.out)), { recursive: true });
  await Bun.write(join(OUT, page.out), page.html);
}
await Bun.write(join(OUT, ".nojekyll"), "");
// While the preview flag is on, ask crawlers to stay away from the whole site.
const site = parseYaml(files["data/site.yml"]!);
// The sitemap needs full addresses, so a relative build (file://, editor preview) has none.
const abs = (path: string) => (values.origin ?? site.url).replace(/\/$/, "") + resolveUrl(path, base, 0);
if (base !== "relative") await Bun.write(join(OUT, "sitemap.xml"), sitemapXml(pages, site.languages[0], abs));
await Bun.write(join(OUT, "robots.txt"), site.preview || base === "relative" ? "User-agent: *\nDisallow: /\n" : `User-agent: *\nAllow: /\nDisallow: ${resolveUrl("/styleguide/", base, 0)}\nDisallow: ${resolveUrl("/edit/", base, 0)}\n\nSitemap: ${abs("/sitemap.xml")}\n`);
console.log(`built ${pages.length} pages, ${upcoming(events, now).length} upcoming events, ${Object.keys(photos).length} photos into ${values.out}/ (base ${base}) in ${Math.round(performance.now() - started)} ms`);
