#!/usr/bin/env bun
// Add one photo to the site.
//
// A post in the "moments" feed (writes site/moments/<date>-<slug>.jpg and .md):
//   bun scripts/add-photo.ts <file-or-url> --date 2026-11-07 --slug elias-at-the-taps \
//     --caption-en "..." --caption-de "..." --alt-en "..." --alt-de "..." \
//     [--album <slug from site/data/albums.yml>] [--gallery-only] [--dry-run]
//   --gallery-only keeps it out of the home feed (feed: false); it still shows in the gallery.
//   A whole batch from the group goes through review-photos.ts and import-selection.ts.
//
// A plain photo for a page section (writes site/photos/<slug>.jpg; its alt text
// lives where the photo is used, for example site/data/home.yml):
//   bun scripts/add-photo.ts <file-or-url> --plain --slug barista-at-the-machine [--dry-run]
//
// The source is never changed. The copy written is auto-oriented,
// converted to sRGB, capped at 2400 px on the long edge and re-encoded WITHOUT any
// metadata (no EXIF, no GPS, no camera or phone details). The repo is public and its
// history is permanent: only run this for photos that may be published.
import sharp from "sharp";
import { parseArgs } from "node:util";
import { existsSync } from "node:fs";
import { join } from "node:path";

export const MAX_EDGE = 2400;
export const JPEG_QUALITY = 84;

/** Clean one image buffer for publication. Pure: buffer in, buffer out. */
export async function cleanPhoto(input: Uint8Array): Promise<{ data: Buffer; width: number; height: number }> {
  const { data, info } = await sharp(input)
    .rotate() // apply EXIF orientation, then the tag is dropped with the rest
    .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
    .toColourspace("srgb")
    .jpeg({ quality: JPEG_QUALITY, progressive: true, mozjpeg: true })
    .toBuffer({ resolveWithObject: true }); // no withMetadata(): everything is stripped
  return { data, width: info.width, height: info.height };
}

const yamlString = (s: string) => JSON.stringify(s);

export type MomentText = { date: string; album?: string; feed?: boolean; caption: { en: string; de: string }; alt: { en: string; de: string } };

/** The .md file of a moment. `feed` is written only when false; `album` only when set. */
export function momentMarkdown(m: MomentText): string {
  return [
    "---",
    `date: ${m.date}`,
    ...(m.album ? [`album: ${m.album}`] : []),
    ...(m.feed === false ? ["feed: false"] : []),
    "caption:",
    `  en: ${yamlString(m.caption.en)}`,
    `  de: ${yamlString(m.caption.de)}`,
    "alt:",
    `  en: ${yamlString(m.alt.en)}`,
    `  de: ${yamlString(m.alt.de)}`,
    "---",
    "",
  ].join("\n");
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    allowPositionals: true,
    options: {
      date: { type: "string" }, slug: { type: "string" },
      "caption-en": { type: "string" }, "caption-de": { type: "string" },
      "alt-en": { type: "string" }, "alt-de": { type: "string" },
      album: { type: "string" }, "gallery-only": { type: "boolean", default: false },
      plain: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
    },
  });
  const src = positionals[0];
  const need = values.plain ? (["slug"] as const) : (["date", "slug", "caption-en", "caption-de", "alt-en", "alt-de"] as const);
  const missing = need.filter((k) => !values[k]);
  if (!src || missing.length) {
    console.error(`usage: bun scripts/add-photo.ts <file-or-url> ${values.plain ? "--plain " : ""}${need.map((k) => `--${k} …`).join(" ")}${values.plain ? "" : " [--album <slug>] [--gallery-only]"} [--dry-run]`);
    if (missing.length) console.error(`missing: ${missing.join(", ")}`);
    process.exit(2);
  }
  if (!values.plain && !/^\d{4}-\d{2}-\d{2}$/.test(values.date!)) throw new Error("--date must be YYYY-MM-DD");
  if (!/^[a-z0-9-]+$/.test(values.slug!)) throw new Error("--slug must be lowercase letters, digits and hyphens");

  const bytes = /^https?:\/\//.test(src)
    ? new Uint8Array(await (await fetch(src)).arrayBuffer())
    : new Uint8Array(await Bun.file(src).arrayBuffer());
  const { data, width, height } = await cleanPhoto(bytes);

  const base = values.plain
    ? join(import.meta.dir, "..", "site", "photos", values.slug!)
    : join(import.meta.dir, "..", "site", "moments", `${values.date}-${values.slug}`);
  if (existsSync(`${base}.jpg`)) throw new Error(`${base}.jpg exists already; pick another slug`);
  const md = values.plain ? "" : momentMarkdown({
    date: values.date!, album: values.album, feed: !values["gallery-only"],
    caption: { en: values["caption-en"]!, de: values["caption-de"]! }, alt: { en: values["alt-en"]!, de: values["alt-de"]! },
  });
  console.log(`${values["dry-run"] ? "would write" : "wrote"} ${base}.jpg (${width}x${height}, ${(data.length / 1024).toFixed(0)} KB)${values.plain ? "" : " and .md"}`);
  if (!values["dry-run"]) {
    await Bun.write(`${base}.jpg`, data);
    if (!values.plain) await Bun.write(`${base}.md`, md);
  }
}
