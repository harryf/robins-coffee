#!/usr/bin/env bun
// The owner's photo review page. LOCAL ONLY: nothing this script reads or writes
// belongs in the repository.
//
//   bun scripts/review-photos.ts --chat <id> [--days 90] [--explorer http://127.0.0.1:4747]
//
// Reads the recent image messages of one WhatsApp group from the WhatsApp explorer
// running on this Mac and writes inbox/review.html (inbox/ is gitignored): one page,
// opened from disk, that loads the photos straight from the explorer. On it the owner
// ticks photos, gives each an album or "feed only", and saves robins-selection.json
// for scripts/import-selection.ts. The chat id is remembered in inbox/config.json
// after the first run, so later runs need no --chat.
//
// The page shows a sender's first name and nothing else about a person: no phone
// number, no id, no chat name, no chat text.
import { parseArgs } from "node:util";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { wallClock, type Album } from "../src/render";
import { tokensCss, type Tokens } from "../src/tokens";

export const EXPLORER = "http://127.0.0.1:4747";
const PAGE = 500;

export type ReviewPhoto = { id: number; sent: number; name: string };
export type ReviewData = { photos: ReviewPhoto[]; skipped: { videos: number; others: number; noFile: number; deleted: number } };

/** "Anna Muster" to "Anna". A name the explorer could only fill with a number gives "". */
export function firstName(name: string | null | undefined): string {
  const first = (name ?? "").trim().split(/\s+/)[0] ?? "";
  return /\d/.test(name ?? "") ? "" : first;
}

const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * Ask the explorer for one chat's photos of the last `days` days, newest first, and
 * count what is left out. Only id, sent time and first name leave this function.
 */
export async function loadReview(o: { fetch: typeof fetch; explorer: string; chat: number; days: number; now?: Date }): Promise<ReviewData> {
  // The explorer reads `from` as a day in this Mac's time zone.
  const from = localDay(new Date((o.now ?? new Date()).getTime() - o.days * 864e5));
  const list = async (query: Record<string, string | number>) => {
    const url = `${o.explorer}/api/chats/${o.chat}/messages?${new URLSearchParams({ from, ...Object.fromEntries(Object.entries(query).map(([k, v]) => [k, String(v)])) })}`;
    const res = await o.fetch(url);
    if (!res.ok) throw new Error(`the explorer answered ${res.status} for chat ${o.chat}`);
    return (await res.json()) as { total: number; items: any[] };
  };
  const images: any[] = [];
  for (;;) {
    const page = await list({ type: "image", limit: PAGE, offset: images.length });
    images.push(...page.items);
    if (!page.items.length || images.length >= page.total) break;
  }
  const videos = (await list({ type: "video,gif", limit: 1 })).total;
  const all = (await list({ nosystem: 1, limit: 1 })).total;
  // A photo its sender deleted for everyone is not ours to publish; one without a file cannot be shown.
  const deleted = images.filter((m) => m.deletedAt);
  const noFile = images.filter((m) => !m.deletedAt && !m.mediaPath && !m.archived);
  const photos = images.filter((m) => !deleted.includes(m) && !noFile.includes(m))
    .map((m) => ({ id: Number(m.id), sent: Number(m.sent), name: m.fromMe ? "" : firstName(m.senderName) }))
    .sort((a, b) => b.sent - a.sent || b.id - a.id);
  return { photos, skipped: { videos, others: Math.max(0, all - images.length - videos), noFile: noFile.length, deleted: deleted.length } };
}

const esc = (s: unknown) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[c]!);
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export type ReviewOptions = {
  albums: Album[];
  /** Explorer message id to the moment it became (inbox/imported.json). */
  imported: Record<string, string>;
  tokens: Tokens;
  /** The English block of i18n.yml: day and month names come from there, not from Intl. */
  t: any;
  explorer: string;
  timezone: string;
  days: number;
};

/** The whole review page as one HTML string. Pure: no disk, no network. */
export function reviewPage(data: ReviewData, o: ReviewOptions): string {
  const clock = (p: ReviewPhoto) => wallClock(new Date(p.sent * 1000), o.timezone);
  const dayLabel = (c: ReturnType<typeof clock>) => `${o.t.days[c.weekday]} ${c.day} ${o.t.months[c.month - 1]} ${c.year}`;
  const days: { label: string; photos: ReviewPhoto[] }[] = [];
  for (const p of data.photos) {
    const label = dayLabel(clock(p));
    (days.at(-1)?.label === label ? days.at(-1)! : days[days.push({ label, photos: [] }) - 1]!).photos.push(p);
  }
  const s = data.skipped;
  const skipped = [
    s.videos && count(s.videos, "video", "videos"), s.others && count(s.others, "other message", "other messages"),
    s.noFile && count(s.noFile, "photo without a file", "photos without a file"), s.deleted && count(s.deleted, "photo deleted by its sender", "photos deleted by their sender"),
  ].filter(Boolean);
  const albumOptions = o.albums.map((a) => `<option value="${esc(a.slug)}">${esc(a.title.en)}</option>`).join("");

  const card = (p: ReviewPhoto) => {
    const c = clock(p);
    const src = `${o.explorer}/media/${p.id}`;
    const published = o.imported[String(p.id)];
    const meta = `${c.time}${p.name ? ` · ${esc(p.name)}` : ""}`;
    const photo = `<a class="photo__img" href="${src}" target="_blank" rel="noopener"><img loading="lazy" src="${src}" alt="Photo of ${c.day} ${o.t.months[c.month - 1]}, ${c.time}"></a>`;
    if (published) return `<article class="photo is-published" data-id="${p.id}">${photo}
      <div class="photo__body"><label class="tick"><input type="checkbox" data-f="on" disabled> <span>Published</span></label><p class="photo__meta">${meta}<br>${esc(published)}</p></div></article>`;
    return `<article class="photo" data-id="${p.id}">${photo}
      <div class="photo__body"><label class="tick"><input type="checkbox" data-f="on"> <span>Publish</span></label><p class="photo__meta">${meta}</p>
      <div class="photo__fields">
        <label>Album <select data-f="album"><option value="">Feed only (no album)</option>${albumOptions}<option value="+">New album…</option></select></label>
        <label data-new hidden>New album name <input type="text" data-f="album_name" autocomplete="off"></label>
        <label class="tick" data-feed hidden><input type="checkbox" data-f="feed" checked> <span>Also in the home feed</span></label>
        <label>Rough caption <input type="text" data-f="caption" autocomplete="off"></label>
        <label>Note <small>(stays on this Mac)</small> <input type="text" data-f="note" autocomplete="off"></label>
      </div></div></article>`;
  };

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>ROBIN's photo review</title>
<style>
${tokensCss(o.tokens).replace(/^@font-face.*\n/gm, "")}
/* page */
*, *::before, *::after { box-sizing: border-box; }
body { margin: 0; background: var(--c-bg); color: var(--c-text); font: 400 var(--size-md)/1.5 var(--font-body); }
h1, h2, p { margin: 0; }
h1, h2 { font-family: var(--font-display); font-weight: 400; line-height: 1.1; }
h1 { font-size: var(--size-xl); }
h2 { font-size: var(--size-lg); margin-block: var(--space-12) var(--space-4); }
a { color: var(--c-neon); }
small { color: var(--c-muted); font-weight: 400; }
:focus-visible { outline: 3px solid var(--c-amber); outline-offset: 2px; border-radius: var(--radius-sm); }
[hidden] { display: none !important; }
.wrap { max-width: var(--layout-max); margin-inline: auto; padding: var(--space-8) var(--layout-gutter) var(--space-24); }
.intro > * + * { margin-top: var(--space-3); }
.intro p { color: var(--c-muted); max-width: 44em; }
.bar { position: sticky; top: 0; z-index: 2; background: var(--c-surface); border-bottom: 1px solid var(--c-line); }
.bar__row { max-width: var(--layout-max); margin-inline: auto; padding: var(--space-3) var(--layout-gutter); display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-3); }
.bar__status { font-weight: 700; }
.bar__status small { display: block; }
.btn { min-height: 48px; padding: var(--space-3) var(--space-6); border-radius: var(--radius-pill); border: 2px solid var(--c-neon); background: var(--c-neon); color: var(--c-on-neon); font: inherit; font-weight: 700; cursor: pointer; }
.btn:disabled { border-color: var(--c-line); background: var(--c-raised); color: var(--c-muted); cursor: not-allowed; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 15rem), 1fr)); gap: var(--space-4); align-items: start; }
.photo { background: var(--c-surface); border: 2px solid var(--c-line); border-radius: var(--radius-md); overflow: hidden; }
.photo.is-on { border-color: var(--c-neon); }
.photo.is-published { opacity: 0.6; }
.photo__img { display: block; background: var(--c-raised); }
.photo__img img { display: block; width: 100%; aspect-ratio: 4 / 3; object-fit: contain; }
.photo__body { padding: var(--space-3); display: grid; gap: var(--space-2); }
.photo__meta { color: var(--c-muted); font-size: var(--size-xs); overflow-wrap: anywhere; }
.photo__fields { display: none; gap: var(--space-3); }
.photo.is-on .photo__fields { display: grid; }
.photo__fields label:not(.tick) { display: grid; gap: var(--space-1); font-size: var(--size-xs); font-weight: 700; }
.tick { display: flex; align-items: center; gap: var(--space-3); min-height: 44px; font-weight: 700; cursor: pointer; }
.tick input { width: 1.5rem; height: 1.5rem; flex: none; accent-color: var(--c-neon); }
select, input[type="text"] { width: 100%; min-height: 44px; padding: var(--space-2) var(--space-3); border-radius: var(--radius-sm); border: 2px solid var(--c-muted); background: var(--c-raised); color: var(--c-text); font: inherit; font-weight: 400; }
input.is-missing { border-color: var(--c-amber); }
</style>
</head>
<body>
<div class="bar"><div class="bar__row">
  <p class="bar__status" aria-live="polite"><span data-count>0 selected</span><small data-message></small></p>
  <button class="btn" type="button" data-save disabled>Save selection</button>
</div></div>
<main class="wrap">
  <div class="intro">
    <h1>Photos from the group</h1>
    <p>The last ${o.days} days: ${count(data.photos.length, "photo", "photos")} on ${count(days.length, "day", "days")}, newest first.${skipped.length ? ` Left out: ${skipped.join(", ")}.` : ""}</p>
    <p>Tick the photos to publish, give each an album or leave it "feed only", then save. The file <code>robins-selection.json</code> lands in Downloads; hand it to <code>bun scripts/import-selection.ts</code>. Your ticks stay in this browser, so a reload keeps them. Only tick a photo that may be public for good: the site's history cannot be undone.</p>
  </div>
${days.map((d) => `  <h2>${esc(d.label)}</h2>\n  <div class="grid">\n${d.photos.map(card).join("\n")}\n  </div>`).join("\n")}
${data.photos.length ? "" : "  <p>No photos in this time.</p>"}
</main>
<script>
// Choices live in localStorage, so a reload or a new run of the script keeps them.
(function () {
  var KEY = "robins-review-v1";
  var state = {};
  try { state = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) {}
  var cards = Array.prototype.slice.call(document.querySelectorAll(".photo:not(.is-published)"));
  var saveButton = document.querySelector("[data-save]");
  var field = function (card, name) { return card.querySelector('[data-f="' + name + '"]'); };
  var read = function (card) {
    return { on: field(card, "on").checked, album: field(card, "album").value, album_name: field(card, "album_name").value.trim(), feed: field(card, "feed").checked, caption: field(card, "caption").value.trim(), note: field(card, "note").value.trim() };
  };
  var paint = function (card) {
    var v = read(card);
    card.classList.toggle("is-on", v.on);
    card.querySelector("[data-new]").hidden = v.album !== "+";
    // "Feed only" has no album, so it is always in the feed; the choice shows with an album.
    card.querySelector("[data-feed]").hidden = v.album === "";
  };
  var total = function () {
    var n = cards.filter(function (c) { return field(c, "on").checked; }).length;
    document.querySelector("[data-count]").textContent = n + " selected";
    saveButton.disabled = n === 0;
  };
  cards.forEach(function (card) {
    var saved = state[card.dataset.id];
    if (saved) {
      field(card, "on").checked = !!saved.on;
      field(card, "album").value = saved.album || "";
      if (field(card, "album").selectedIndex < 0) field(card, "album").value = "";
      field(card, "album_name").value = saved.album_name || "";
      field(card, "feed").checked = saved.feed !== false;
      field(card, "caption").value = saved.caption || "";
      field(card, "note").value = saved.note || "";
    }
    paint(card);
    card.addEventListener("input", function () {
      state[card.dataset.id] = read(card);
      try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
      field(card, "album_name").classList.remove("is-missing");
      paint(card);
      total();
    });
  });
  total();

  saveButton.addEventListener("click", function () {
    var message = document.querySelector("[data-message]");
    var chosen = cards.filter(function (c) { return field(c, "on").checked; });
    var unnamed = chosen.filter(function (c) { var v = read(c); return v.album === "+" && !v.album_name; })[0];
    if (unnamed) {
      field(unnamed, "album_name").classList.add("is-missing");
      field(unnamed, "album_name").focus();
      message.textContent = "A new album needs a name.";
      return;
    }
    var photos = chosen.map(function (c) {
      var v = read(c);
      var isNew = v.album === "+";
      return { id: +c.dataset.id, album: isNew ? "" : v.album, album_name: isNew ? v.album_name : "", feed: v.album === "" ? true : v.feed, caption: v.caption, note: v.note };
    });
    var blob = new Blob([JSON.stringify({ version: 1, saved_at: new Date().toISOString(), photos: photos }, null, 1)], { type: "application/json" });
    var link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "robins-selection.json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    message.textContent = "Saved " + photos.length + " to robins-selection.json.";
  });
})();
</script>
</body>
</html>
`;
}

if (import.meta.main) {
  const { values } = parseArgs({ args: Bun.argv.slice(2), options: { chat: { type: "string" }, days: { type: "string", default: "90" }, explorer: { type: "string", default: EXPLORER }, help: { type: "boolean", default: false } } });
  const usage = "usage: bun scripts/review-photos.ts --chat <id> [--days 90] [--explorer http://127.0.0.1:4747]\n  Writes inbox/review.html from the group's recent photos. --chat is only needed the first time.";
  if (values.help) { console.log(usage); process.exit(0); }
  const ROOT = join(import.meta.dir, "..");
  const INBOX = join(ROOT, "inbox");
  const json = async (path: string) => ((await Bun.file(path).exists()) ? JSON.parse(await Bun.file(path).text()) : {});
  const config = await json(join(INBOX, "config.json"));
  const chat = Number(values.chat ?? config.chat);
  const days = Number(values.days);
  if (!Number.isInteger(chat) || chat <= 0 || !(days > 0)) {
    console.error(usage);
    console.error(values.chat || config.chat ? "--chat and --days must be numbers" : "no chat yet: pass --chat <id> once; it is then kept in inbox/config.json");
    process.exit(2);
  }
  const explorer = values.explorer!.replace(/\/$/, "");
  let data: ReviewData;
  try {
    data = await loadReview({ fetch, explorer, chat, days });
  } catch (error) {
    console.error(`could not read the WhatsApp explorer at ${explorer} (${error instanceof Error ? error.message : error}).\nStart it with \`bun start\` in its folder, then run this again.`);
    process.exit(1);
  }
  await mkdir(INBOX, { recursive: true });
  // Remembered only once the explorer has answered for this chat.
  if (config.chat !== chat) await Bun.write(join(INBOX, "config.json"), JSON.stringify({ ...config, chat }, null, 1) + "\n");
  const site = (f: string) => Bun.file(join(ROOT, "site", "data", f)).text();
  const page = reviewPage(data, {
    albums: parseYaml(await site("albums.yml")).albums, imported: await json(join(INBOX, "imported.json")), tokens: JSON.parse(await site("tokens.json")),
    t: parseYaml(await site("i18n.yml")).en, explorer, timezone: parseYaml(await site("site.yml")).timezone, days,
  });
  await Bun.write(join(INBOX, "review.html"), page);
  const s = data.skipped;
  console.log(`wrote inbox/review.html: ${data.photos.length} photos of the last ${days} days; left out ${s.videos} videos, ${s.others} other messages, ${s.noFile} photos without a file, ${s.deleted} deleted by the sender`);
  console.log(`open ${join(INBOX, "review.html")}`);
}
