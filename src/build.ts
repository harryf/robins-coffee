#!/usr/bin/env bun
// Build the site into dist/.   bun src/build.ts [--base /robins-coffee/ | relative] [--out dist]
// Everything about HOW a page looks lives in src/render.ts and site/; this file only
// does what needs a disk: reading files, resizing photos, copying assets.
import sharp from "sharp";
import { parseArgs } from "node:util";
import { mkdir, rm, cp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { renderSite, type Files, type Photo } from "./render";
import { tokensCss } from "./tokens";

const ROOT = join(import.meta.dir, "..");
const SITE = join(ROOT, "site");
const CACHE = join(ROOT, ".cache", "photos");
const WIDTHS = [480, 800, 1200, 1800];
const TEXT = /\.(md|yml|json|liquid)$/;

const { values } = parseArgs({ args: Bun.argv.slice(2), options: { base: { type: "string", default: "/" }, out: { type: "string", default: "dist" } } });
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

const started = performance.now();
await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
const files = await readSite();
const photos = await buildPhotos();
const version = await buildAssets(files);
const pages = await renderSite(files, { base, photos, version });
for (const page of pages) {
  await mkdir(dirname(join(OUT, page.out)), { recursive: true });
  await Bun.write(join(OUT, page.out), page.html);
}
await Bun.write(join(OUT, ".nojekyll"), "");
// While the preview flag is on, ask crawlers to stay away from the whole site.
const preview = /^preview:\s*true/m.test(files["data/site.yml"]!);
await Bun.write(join(OUT, "robots.txt"), preview ? "User-agent: *\nDisallow: /\n" : "User-agent: *\nAllow: /\nDisallow: /styleguide/\n");
console.log(`built ${pages.length} pages, ${Object.keys(photos).length} photos into ${values.out}/ (base ${base}) in ${Math.round(performance.now() - started)} ms`);
