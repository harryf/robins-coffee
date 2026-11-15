#!/usr/bin/env bun
// Turn a selection saved on the review page into moments.
//
//   bun scripts/import-selection.ts <path to robins-selection.json> [--dry-run] [--explorer http://127.0.0.1:4747]
//
// For each chosen photo: fetch it from the WhatsApp explorer on this Mac, clean it
// like add-photo.ts does (no metadata, at most 2400 px), date it from the message's
// sent time in Zürich time and write site/moments/<date>-<slug>.jpg and .md with the
// chosen album and feed flag. A new album is appended to site/data/albums.yml with the
// typed name as both titles.
//
// Caption and alt text the owner did not write are the literal placeholder TODO in
// both languages; a test fails while any moment contains TODO, so nothing unfinished
// can merge. Which message became which file is recorded in inbox/imported.json
// (gitignored), never in the repository. Notes from the review page are printed and
// kept nowhere.
//
// Everything is checked before the first file is written: one bad entry stops the run.
// The repository is public and permanent. Only import what may be published.
import { parseArgs } from "node:util";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { wallClock, type Album } from "../src/render";
import { cleanPhoto, momentMarkdown } from "./add-photo";
import { EXPLORER } from "./review-photos";

export const TODO = "TODO";
export type Selection = { version: number; photos: { id: number; album: string; album_name: string; feed: boolean; caption: string; note: string }[] };
export type ImportOptions = {
  /** The repository root: site/ and inbox/ live under it. */
  root: string;
  explorer: string;
  fetch: typeof fetch;
  dryRun?: boolean;
  /** The bar's group (inbox/config.json). When set, a message from any other chat is refused. */
  chat?: number;
};
export type Imported = { id: number; file: string; album: string; feed: boolean; width: number; height: number; kb: number; note: string };

/** "Quiz Night!" to "quiz-night": lowercase ASCII words joined by hyphens. */
export const slugify = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

export async function importSelection(selection: Selection, o: ImportOptions): Promise<{ written: Imported[]; skipped: number[]; newAlbums: { slug: string; name: string }[] }> {
  if (selection?.version !== 1 || !Array.isArray(selection.photos)) throw new Error("not a robins-selection.json of version 1");
  const moments = join(o.root, "site", "moments");
  const albumsPath = join(o.root, "site", "data", "albums.yml");
  const importedPath = join(o.root, "inbox", "imported.json");
  const albums: Album[] = parseYaml(await Bun.file(albumsPath).text())?.albums ?? [];
  const timezone: string = parseYaml(await Bun.file(join(o.root, "site", "data", "site.yml")).text()).timezone;
  const imported: Record<string, string> = existsSync(importedPath) ? JSON.parse(await Bun.file(importedPath).text()) : {};

  // 1. Check and prepare everything; nothing is written yet.
  const newAlbums: { slug: string; name: string }[] = [];
  const skipped: number[] = [];
  const ready: (Imported & { data: Buffer; md: string })[] = [];
  const taken = new Set<string>();
  for (const pick of selection.photos) {
    if (!Number.isInteger(pick.id)) throw new Error(`"${pick.id}" is not a message id`);
    if (imported[String(pick.id)]) { skipped.push(pick.id); continue; }

    let album = pick.album ?? "";
    const name = (pick.album_name ?? "").trim();
    if (name) {
      album = slugify(name);
      if (!album) throw new Error(`message ${pick.id}: the album name "${name}" has no letters or digits`);
      if (!albums.some((a) => a.slug === album) && !newAlbums.some((a) => a.slug === album)) newAlbums.push({ slug: album, name });
    } else if (album && !albums.some((a) => a.slug === album)) throw new Error(`message ${pick.id}: the album "${album}" is not in site/data/albums.yml`);

    const res = await o.fetch(`${o.explorer}/api/messages/${pick.id}`);
    if (!res.ok) throw new Error(`message ${pick.id}: the explorer answered ${res.status}`);
    const message = (await res.json()) as { kind: string; sent: number; chatId: number; deletedAt: number | null };
    if (message.kind !== "image") throw new Error(`message ${pick.id} is a ${message.kind}, not a photo`);
    if (message.deletedAt) throw new Error(`message ${pick.id} was deleted by its sender`);
    if (o.chat && message.chatId !== o.chat) throw new Error(`message ${pick.id} is not from the bar's group`);
    const file = await o.fetch(`${o.explorer}/media/${pick.id}`);
    if (!file.ok) throw new Error(`message ${pick.id}: no photo file (${file.status})`);
    const { data, width, height } = await cleanPhoto(new Uint8Array(await file.arrayBuffer()));

    const day = wallClock(new Date(message.sent * 1000), timezone);
    const date = `${day.year}-${String(day.month).padStart(2, "0")}-${String(day.day).padStart(2, "0")}`;
    const caption = (pick.caption ?? "").trim();
    const slug = slugify(caption).slice(0, 48).replace(/-+$/, "") || "photo";
    let base = `${date}-${slug}`;
    for (let n = 2; taken.has(base) || existsSync(join(moments, `${base}.jpg`)) || existsSync(join(moments, `${base}.md`)); n++) base = `${date}-${slug}-${n}`;
    taken.add(base);
    const feed = album ? pick.feed !== false : true;
    const md = momentMarkdown({ date, album: album || undefined, feed, caption: { en: caption || TODO, de: TODO }, alt: { en: TODO, de: TODO } });
    ready.push({ id: pick.id, file: base, album, feed, width, height, kb: Math.round(data.length / 1024), note: (pick.note ?? "").trim(), data, md });
  }

  // 2. Write.
  if (!o.dryRun && ready.length) {
    await mkdir(moments, { recursive: true });
    for (const r of ready) {
      await Bun.write(join(moments, `${r.file}.jpg`), r.data);
      await Bun.write(join(moments, `${r.file}.md`), r.md);
      imported[String(r.id)] = r.file;
    }
    if (newAlbums.length) {
      const text = await Bun.file(albumsPath).text();
      const more = newAlbums.map((a) => `  - slug: ${a.slug}\n    title: { en: ${JSON.stringify(a.name)}, de: ${JSON.stringify(a.name)} }\n`).join("");
      await Bun.write(albumsPath, text + (text.endsWith("\n") ? "" : "\n") + more);
    }
    await mkdir(join(o.root, "inbox"), { recursive: true });
    await Bun.write(importedPath, JSON.stringify(imported, null, 1) + "\n");
  }
  return { written: ready.map(({ data, md, ...rest }) => rest), skipped, newAlbums };
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({ args: Bun.argv.slice(2), allowPositionals: true, options: { "dry-run": { type: "boolean", default: false }, explorer: { type: "string", default: EXPLORER }, help: { type: "boolean", default: false } } });
  const usage = "usage: bun scripts/import-selection.ts <path to robins-selection.json> [--dry-run] [--explorer http://127.0.0.1:4747]";
  if (values.help || !positionals[0]) { console[values.help ? "log" : "error"](usage); process.exit(values.help ? 0 : 2); }
  const root = join(import.meta.dir, "..");
  const configPath = join(root, "inbox", "config.json");
  const chat = existsSync(configPath) ? Number(JSON.parse(await Bun.file(configPath).text()).chat) || undefined : undefined;
  const dryRun = values["dry-run"];
  try {
    const selection = JSON.parse(await Bun.file(positionals[0]).text());
    const result = await importSelection(selection, { root, explorer: values.explorer!.replace(/\/$/, ""), fetch, dryRun, chat });
    const verb = dryRun ? "would write" : "wrote";
    for (const w of result.written) {
      console.log(`${verb} site/moments/${w.file}.jpg (${w.width}x${w.height}, ${w.kb} KB) and .md: ${w.album ? `album ${w.album}${w.feed ? "" : ", gallery only"}` : "feed only"}`);
      if (w.note) console.log(`  note: ${w.note}`);
    }
    for (const a of result.newAlbums) console.log(`${dryRun ? "would add" : "added"} album ${a.slug} ("${a.name}") to site/data/albums.yml: give it a German title if it needs one`);
    if (result.skipped.length) console.log(`skipped ${result.skipped.length} already published`);
    if (result.written.length && !dryRun) console.log(`next: replace every TODO in the new .md files (caption and alt text, EN and DE), then \`bun run check\`. The tests fail while a TODO is left.`);
    if (!result.written.length) console.log("nothing to import");
  } catch (error) {
    console.error(`import stopped: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}
