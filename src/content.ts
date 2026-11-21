// Writers for the content files an editor changes: events, albums, the drinks menu.
// Pure and browser-safe: text in, text out. The Studio and the scripts share them, so a
// form and a hand edit produce the same file.
import { parse as parseYaml, parseDocument } from "yaml";

const q = (s: string) => JSON.stringify(String(s));
export const slugify = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "event";
const DAY = /^\d{4}-\d{2}-\d{2}$/, TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
/** A full time as it is written into a file: nothing but digits, the T, colons and an offset. */
export const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;
const noSharpS = (s: string) => s.replace(/ß/g, "ss");

/**
 * A text of the site in its languages: English always, every other language when there is
 * one. A language without a text is left out of the file and the site shows English there.
 */
export type Texts = { en: string; [lang: string]: string | undefined };
/** A language code as site.yml lists it. */
export const LANG = /^[a-z]{2}$/;
const ORDER = ["en", "de", "fr", "it"];
const rankLang = (code: string) => { const at = ORDER.indexOf(code); return at < 0 ? ORDER.length : at; };

/** True when a value is a text map: language codes to strings, nothing else. */
export function textsShape(v: unknown): boolean {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  return Object.entries(v).every(([k, x]) => LANG.test(k) && (x == null || typeof x === "string"));
}
/** True when a text map has an English text. */
export const hasEnglish = (v: unknown): boolean => textsShape(v) && typeof (v as Texts).en === "string" && !!(v as Texts).en.trim();

/** A text map as it is written into a file: trimmed, empty languages left out, English first, German without the sharp s. */
export function cleanTexts(v: Partial<Texts>): Record<string, string> {
  const out: Record<string, string> = {};
  const rows = Object.entries(v).filter(([k, x]) => LANG.test(k) && typeof x === "string" && x.trim()).sort(([a], [b]) => rankLang(a) - rankLang(b) || a.localeCompare(b));
  for (const [k, x] of rows) out[k] = k === "de" ? noSharpS(x!.trim()) : x!.trim();
  return out;
}

/**
 * What a form's text keeps and what this Mac still has to translate. `given` is what the
 * form sent (English, plus any translation shown in its fold), `old` what the file had,
 * `languages` the site's languages. For each language other than English:
 * - a translation the form sent is kept, unless the English changed and it is the old
 *   one unchanged (then it no longer says what the English says, and is made again);
 * - one the form sent empty is made again;
 * - one the form did not send is kept from the file while the English did not change.
 * Everything else is to be translated. So an unchanged English is never translated
 * again, and a German text written by hand stays.
 */
export function planTexts(given: Partial<Texts>, old: Partial<Record<string, string | undefined>> | null | undefined, languages: string[]): { keep: Texts; need: string[] } {
  const en = String(given.en ?? "").trim();
  const same = !!old && String(old.en ?? "").trim() === en;
  const keep: Texts = { en };
  const need: string[] = [];
  for (const lang of languages) {
    if (lang === "en" || !LANG.test(lang)) continue;
    const sent = given[lang], was = typeof old?.[lang] === "string" ? old[lang]!.trim() : "";
    if (typeof sent === "string" && sent.trim()) {
      if (!same && old && sent.trim() === was) need.push(lang);
      else keep[lang] = sent.trim();
    } else if (sent === undefined && same && was) keep[lang] = was;
    else need.push(lang);
  }
  return { keep, need };
}

export type EventInput = {
  title: string; name?: string;
  /** One day, a list of days, or a weekday code for a weekly evening. */
  date?: string; dates?: string[]; every?: string; until?: string;
  from?: string; to?: string;
  /** Full times instead of date/from/to (an import knows them exactly). */
  start?: string; end?: string;
  text?: Partial<Texts>;
  image?: string; ticket_url?: string; price_chf?: number | null;
  category?: "comedy" | "music" | "other"; organiser?: string; source_url?: string;
};

/** What is wrong with an event, as message keys the screen translates; empty when it is fine. */
export function eventProblems(e: EventInput): string[] {
  const out: string[] = [];
  // Shape first: everything below may then treat a field as the text it should be.
  if (!e || typeof e !== "object") return ["event_shape_wrong"];
  for (const v of [e.title, e.name, e.organiser, e.ticket_url, e.source_url, e.image, e.date, e.until, e.from, e.to, e.every, e.start, e.end]) if (v != null && typeof v !== "string") return ["event_shape_wrong"];
  if (e.dates !== undefined && (!Array.isArray(e.dates) || e.dates.some((d) => typeof d !== "string"))) return ["event_shape_wrong"];
  if (e.text !== undefined && !textsShape(e.text)) return ["event_shape_wrong"];
  if (e.category !== undefined && !["comedy", "music", "other"].includes(e.category)) return ["event_shape_wrong"];
  if (!e.title?.trim()) out.push("event_title_missing");
  const whens = [e.start ? 1 : 0, e.date ? 1 : 0, e.dates?.length ? 1 : 0, e.every ? 1 : 0].reduce((a, b) => a + b, 0);
  if (e.start != null || e.end != null) { if (typeof e.start !== "string" || typeof e.end !== "string" || !STAMP.test(e.start) || !STAMP.test(e.end) || Number.isNaN(Date.parse(e.start)) || Number.isNaN(Date.parse(e.end)) || Date.parse(e.end) < Date.parse(e.start)) out.push("event_time_wrong"); }
  else if (!e.date && !e.dates?.length && !e.every) out.push("event_date_missing");
  if (whens > 1 && !(e.every && e.date && whens === 2)) out.push("event_date_twice");
  for (const d of [e.date, e.until, ...(e.dates ?? [])]) if (d && !DAY.test(d)) out.push("event_date_wrong");
  if (e.every && !["mo", "tu", "we", "th", "fr", "sa", "su"].includes(e.every)) out.push("event_date_wrong");
  for (const t of [e.from, e.to]) if (t && !TIME.test(t)) out.push("event_time_wrong");
  if (e.to && !e.from) out.push("event_time_wrong");
  if (e.ticket_url && !/^https:\/\/[^\s]+$/.test(e.ticket_url)) out.push("event_link_wrong");
  if (e.text && !e.text.en?.trim() && Object.values(e.text).some((x) => typeof x === "string" && x.trim())) out.push("english_needed");
  if (e.image && !/^photos\/[a-z0-9-]+\.jpg$/.test(e.image)) out.push("event_image_wrong");
  if (e.price_chf != null && !(typeof e.price_chf === "number" && e.price_chf >= 0 && Number.isFinite(e.price_chf))) out.push("event_price_wrong");
  if (e.source_url && !/^https:\/\/[^\s]+$/.test(e.source_url)) out.push("event_link_wrong");
  return [...new Set(out)];
}

/** The file of a hand event: its path under site/ and its text. Throws when the event is not valid. */
export function eventFile(e: EventInput): { path: string; text: string } {
  const problems = eventProblems(e);
  if (problems.length) throw new Error(problems.join(", "));
  const first = e.start ? e.start.slice(0, 10) : e.date ?? (e.every ? "" : e.dates![0]!);
  const single = !!(e.start || (e.date && !e.every));
  const lines = ["---", `title: ${q(e.title.trim())}`];
  if (e.name?.trim() && e.name.trim() !== e.title.trim()) lines.push(`name: ${q(e.name.trim())}`);
  if (e.start) lines.push(`start: ${e.start}`, `end: ${e.end}`);
  else {
    if (e.dates?.length) lines.push(`dates: [${[...e.dates].sort().join(", ")}]`);
    if (e.every) lines.push(`every: ${e.every}`);
    if (e.date) lines.push(`date: ${e.date}`);
    if (e.every && e.until) lines.push(`until: ${e.until}`);
    if (e.from) lines.push(`from: ${q(e.from)}`);
    if (e.from && e.to) lines.push(`to: ${q(e.to)}`);
  }
  if (e.price_chf != null) lines.push(`price_chf: ${e.price_chf}`);
  lines.push(`category: ${e.category ?? "other"}`);
  if (e.organiser?.trim()) lines.push(`organiser: ${q(e.organiser.trim())}`);
  if (e.image) lines.push(`image: ${q(e.image)}`);
  if (e.text?.en?.trim()) lines.push("text:", ...Object.entries(cleanTexts(e.text)).map(([k, v]) => `  ${k}: ${q(v)}`));
  lines.push(`ticket_url: ${q(e.ticket_url ?? "")}`);
  if (e.source_url) lines.push(`source_url: ${q(e.source_url)}`);
  lines.push("---", "");
  const slug = slugify(e.name?.trim() || e.title);
  return { path: `events/${single ? first + "-" : ""}${slug}.md`, text: lines.join("\n") };
}

export type AlbumInput = { slug?: string; title: Texts; cover?: string };

/** albums.yml with one more album; comments and order of the file are kept. */
export function addAlbum(yamlText: string, a: AlbumInput): { text: string; slug: string } {
  if (!hasEnglish(a?.title)) throw new Error("english_needed");
  const slug = a.slug?.trim() || slugify(a.title.en);
  if (!/^[a-z0-9-]+$/.test(slug)) throw new Error("album_slug_wrong");
  const doc = parseDocument(yamlText);
  const list: any[] = (parseYaml(yamlText)?.albums ?? []) as any[];
  if (list.some((x) => x.slug === slug)) throw new Error("album_exists");
  const entry: any = { slug, title: cleanTexts(a.title) };
  if (a.cover) entry.cover = a.cover;
  if (!doc.has("albums")) doc.set("albums", []);
  const node = doc.createNode(entry) as any;
  node.get("title", true).flow = true;
  (doc.get("albums") as any).add(node);
  return { text: doc.toString({ lineWidth: 0 }), slug };
}

/** albums.yml with one album's name changed. The slug stays, so every photo of the album stays in it. */
export function renameAlbum(yamlText: string, slug: string, title: Texts): string {
  if (!hasEnglish(title)) throw new Error("english_needed");
  const doc = parseDocument(yamlText);
  const album = (doc.get("albums") as any)?.items?.find((a: any) => a.get("slug") === slug);
  if (!album) throw new Error("album_unknown");
  const node = doc.createNode(cleanTexts(title)) as any;
  node.flow = true;
  album.set("title", node);
  return doc.toString({ lineWidth: 0 });
}

export type DrinkInput = { name: string; text: Texts; price_chf: number; photo?: string; alt?: Texts };

export function drinkProblems(d: DrinkInput): string[] {
  const out: string[] = [];
  if (!d || typeof d !== "object") return ["drink_name_missing"];
  for (const v of [d.name, d.photo]) if (v != null && typeof v !== "string") return ["english_needed"];
  if ((d.text != null && !textsShape(d.text)) || (d.alt != null && !textsShape(d.alt))) return ["english_needed"];
  if (!d.name?.trim()) out.push("drink_name_missing");
  if (!hasEnglish(d.text)) out.push("english_needed");
  if (!(typeof d.price_chf === "number" && d.price_chf >= 0)) out.push("drink_price_wrong");
  if (d.photo && !/^photos\/[a-z0-9-]+\.jpg$/.test(d.photo)) out.push("event_image_wrong");
  if (d.photo && !hasEnglish(d.alt)) out.push("alt_missing");
  return out;
}

/**
 * menu.yml with a drink added to a part of the menu, or replaced when the part already
 * has one of that name. A part that does not exist yet is created from `partTitle`.
 */
export function setDrink(yamlText: string, part: string, d: DrinkInput, partTitle?: Texts): string {
  const problems = drinkProblems(d);
  if (problems.length) throw new Error(problems.join(", "));
  if (!/^[a-z0-9-]+$/.test(part)) throw new Error("menu_part_wrong");
  const doc = parseDocument(yamlText || "sections: []\n");
  if (!doc.has("sections")) doc.set("sections", []);
  const sections = doc.get("sections") as any;
  let section = sections.items.find((s: any) => s.get("slug") === part);
  if (!section) {
    if (!partTitle || !hasEnglish(partTitle)) throw new Error("english_needed");
    section = doc.createNode({ slug: part, title: cleanTexts(partTitle), drinks: [] });
    (section.get("title", true) as any).flow = true;
    sections.add(section);
  }
  const entry: any = { name: d.name.trim(), text: cleanTexts(d.text), price_chf: d.price_chf };
  if (d.photo) { entry.photo = d.photo; entry.alt = cleanTexts(d.alt!); }
  const node = doc.createNode(entry) as any;
  for (const k of ["text", "alt"]) if (node.has(k)) node.get(k, true).flow = true;
  if (!section.has("drinks")) section.set("drinks", []);
  const drinks = section.get("drinks") as any;
  const at = drinks.items.findIndex((x: any) => x.get("name") === entry.name);
  if (at >= 0) drinks.items[at] = node; else drinks.add(node);
  return doc.toString({ lineWidth: 0 });
}

/** menu.yml without one drink; an emptied part stays, so its title is not lost. */
export function removeDrink(yamlText: string, part: string, name: string): string {
  const doc = parseDocument(yamlText);
  const section = (doc.get("sections") as any)?.items.find((s: any) => s.get("slug") === part);
  const drinks = section?.get("drinks") as any;
  const at = drinks?.items.findIndex((x: any) => x.get("name") === name) ?? -1;
  if (at < 0) throw new Error("drink_not_found");
  drinks.items.splice(at, 1);
  return doc.toString({ lineWidth: 0 });
}

/** Where a drink of that name sits in that part; `at` is -1 when it is not there. */
const findDrink = (doc: any, part: string, name: string) => {
  const section = (doc.get("sections") as any)?.items.find((s: any) => s.get("slug") === part);
  const drinks = section?.get("drinks") as any;
  const at: number = drinks?.items?.findIndex((x: any) => x.get("name") === name) ?? -1;
  return { drinks, at };
};

/** True when a part of the menu has a drink of that name. */
export function hasDrink(yamlText: string, part: string, name: string): boolean {
  return findDrink(parseDocument(yamlText || "sections: []\n"), part, name.trim()).at >= 0;
}

/**
 * menu.yml with a drink changed: `was` says which one it was before the form was opened.
 * It keeps its place in the list, also under a new name. Moved to another part it goes
 * to the end of that part. A new name that another drink of the part already has is refused.
 */
export function changeDrink(yamlText: string, was: { part: string; name: string }, part: string, d: DrinkInput, partTitle?: Texts): string {
  const problems = drinkProblems(d);
  if (problems.length) throw new Error(problems.join(", "));
  const doc = parseDocument(yamlText);
  const old = findDrink(doc, was.part, was.name);
  if (old.at < 0) throw new Error("drink_not_found");
  const name = d.name.trim();
  if ((part !== was.part || name !== was.name) && findDrink(doc, part, name).at >= 0) throw new Error("drink_exists");
  if (part !== was.part) return setDrink(removeDrink(yamlText, was.part, was.name), part, d, partTitle);
  // Same part: setDrink replaces by name, so the old entry takes the new name first and keeps its place.
  old.drinks.items[old.at].set("name", name);
  return setDrink(doc.toString({ lineWidth: 0 }), part, d);
}

export type MomentEdit = { caption: Texts; alt: Texts; album?: string | null; feed?: boolean };

/**
 * The text file of a photo with a new caption, alt text, album and home page switch.
 * Its date, its notes and any line this form does not know stay as they are.
 */
export function editMoment(mdText: string, m: MomentEdit): string {
  const found = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(mdText);
  if (!found) throw new Error("photo_not_found");
  if (!hasEnglish(m?.caption) || !hasEnglish(m?.alt)) throw new Error("english_needed");
  if (m.album != null && m.album !== "" && (typeof m.album !== "string" || !/^[a-z0-9-]+$/.test(m.album))) throw new Error("album_unknown");
  const doc = parseDocument(found[1]!);
  const texts = (v: Texts) => doc.createNode(cleanTexts(v));
  if (m.album) doc.set("album", m.album); else doc.delete("album");
  if (m.feed === false) doc.set("feed", false); else doc.delete("feed");
  doc.set("caption", texts(m.caption));
  doc.set("alt", texts(m.alt));
  // The order every moment file has: date, album, feed, caption, alt, then anything else.
  const order = ["date", "album", "feed", "caption", "alt"];
  const rank = (pair: any) => { const at = order.indexOf(String(pair.key?.value ?? pair.key)); return at < 0 ? order.length : at; };
  (doc.contents as any).items.sort((a: any, b: any) => rank(a) - rank(b));
  return `---\n${doc.toString({ lineWidth: 0, defaultStringType: "QUOTE_DOUBLE", defaultKeyType: "PLAIN" }).trimEnd()}\n---\n${found[2]}`;
}

/** albums.yml without a cover that names this photo: an album whose cover photo is gone would stop the build. */
export function dropCover(yamlText: string, momentId: string): string {
  const doc = parseDocument(yamlText);
  let changed = false;
  for (const album of ((doc.get("albums") as any)?.items ?? []) as any[]) if (album.get("cover") === momentId) { album.delete("cover"); changed = true; }
  return changed ? doc.toString({ lineWidth: 0 }) : yamlText;
}

/** "2026:11:07 21:14:05", as a camera writes the moment a picture was taken, to "2026-11-07"; null for anything else. */
export function exifDay(taken: unknown): string | null {
  const m = typeof taken === "string" ? /^(\d{4})[:-](\d{2})[:-](\d{2})(?:[ T]|$)/.exec(taken.trim()) : null;
  if (!m) return null;
  const day = `${m[1]}-${m[2]}-${m[3]}`;
  const at = Date.parse(`${day}T00:00:00Z`);
  // A camera with a flat battery says 0000 or 1970; a real day reads back as itself.
  return !Number.isNaN(at) && new Date(at).toISOString().slice(0, 10) === day && m[1]! >= "1990" ? day : null;
}

/**
 * The day a photo is filed under, worked out so nobody has to type it: the day the
 * picture says it was taken, else the day of its file, else today. `from` says which.
 * A day in the future is not believed.
 */
export function photoDay(known: { taken?: unknown; fileDay?: string | null; today: string }): { day: string; from: "picture" | "file" | "today" } {
  const taken = exifDay(known.taken);
  if (taken && taken <= known.today) return { day: taken, from: "picture" };
  if (typeof known.fileDay === "string" && DAY.test(known.fileDay) && known.fileDay <= known.today) return { day: known.fileDay, from: "file" };
  return { day: known.today, from: "today" };
}

/** What an event file says, as the fields of the form that edits it. */
export function eventFields(data: Record<string, any>): EventInput {
  const day = (v: any) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v));
  const stamp = (v: any) => (v instanceof Date ? v.toISOString().replace(".000Z", "Z") : String(v));
  const e: EventInput = { title: String(data.title ?? "") };
  if (data.name) e.name = String(data.name);
  if (data.start || data.end) { e.start = stamp(data.start ?? ""); e.end = stamp(data.end ?? ""); }
  else {
    if (Array.isArray(data.dates)) e.dates = data.dates.map(day).sort();
    if (data.every) e.every = String(data.every);
    if (data.date) e.date = day(data.date);
    if (data.until) e.until = day(data.until);
    if (data.from) e.from = String(data.from);
    if (data.to) e.to = String(data.to);
  }
  if (data.text && typeof data.text === "object") e.text = Object.fromEntries(Object.entries(data.text).filter(([k, v]) => LANG.test(k) && v != null).map(([k, v]) => [k, String(v)])) as Partial<Texts>;
  if (data.image) e.image = String(data.image);
  e.ticket_url = String(data.ticket_url ?? "");
  e.price_chf = typeof data.price_chf === "number" ? data.price_chf : null;
  if (["comedy", "music", "other"].includes(data.category)) e.category = data.category;
  if (data.organiser) e.organiser = String(data.organiser);
  if (data.source_url) e.source_url = String(data.source_url);
  return e;
}

/** The notes (lines starting with #) in the head of an event file, put back into its rewritten text so an edit does not lose them. */
export function keepComments(oldText: string, newText: string): string {
  const head = /^---\n([\s\S]*?)\n---/.exec(oldText)?.[1] ?? "";
  const notes = head.split("\n").filter((line) => line.startsWith("#"));
  if (!notes.length) return newText;
  const lines = newText.split("\n");
  let at = 1;
  while (/^(title|name): /.test(lines[at] ?? "")) at++;
  lines.splice(at, 0, ...notes);
  return lines.join("\n");
}
