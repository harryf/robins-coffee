// Writers for the content files the Studio changes: events, albums, the drinks menu.
// Pure and browser-safe: text in, text out. The Studio and the scripts share them, so a
// form and a hand edit produce the same file.
import { parse as parseYaml, parseDocument } from "yaml";
import { readMenu, dayOf, UNITS } from "./menu";

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

// --- the drinks menu: seasons, and drinks that seasons name by slug (src/menu.ts reads the file) ---

/** One line of a recipe as a form sends it: an amount, a unit from UNITS (or none), what it is. */
export type IngredientInput = { amount?: number | null; unit?: string | null; item: Partial<Texts> };
/** A picture of a drink as it is written: a photo of the site and its alt text. */
export type PictureInput = { photo: string; alt: Partial<Texts> };
export type DrinkInput = {
  name: string; price_chf: number; text: Partial<Texts>; experience?: Partial<Texts> | null;
  ingredients?: IngredientInput[]; method?: Partial<Texts>[]; pictures?: PictureInput[];
};
export type SeasonInput = { name: Partial<Texts>; start: string; end: string; description?: Partial<Texts> | null };

const hasWords = (v: unknown) => textsShape(v) && Object.values(v as object).some((x) => typeof x === "string" && x.trim());

/** What is wrong with a drink, as message keys the screen translates; empty when it is fine. */
export function drinkProblems(d: DrinkInput): string[] {
  if (!d || typeof d !== "object") return ["drink_name_missing"];
  if (d.name != null && typeof d.name !== "string") return ["drink_name_missing"];
  for (const v of [d.text, d.experience]) if (v != null && !textsShape(v)) return ["english_needed"];
  for (const k of ["ingredients", "method", "pictures"] as const) if (d[k] != null && !Array.isArray(d[k])) return ["drink_shape_wrong"];
  const out: string[] = [];
  if (!d.name?.trim()) out.push("drink_name_missing");
  if (!(typeof d.price_chf === "number" && Number.isFinite(d.price_chf) && d.price_chf >= 0)) out.push("drink_price_wrong");
  if (!hasEnglish(d.text)) out.push("english_needed");
  if (d.experience != null && hasWords(d.experience) && !hasEnglish(d.experience)) out.push("english_needed");
  for (const x of d.ingredients ?? []) {
    if (!x || typeof x !== "object" || !textsShape(x.item)) { out.push("drink_shape_wrong"); continue; }
    if (!hasEnglish(x.item)) out.push("ingredient_item_missing");
    if (x.amount != null && !(typeof x.amount === "number" && Number.isFinite(x.amount) && x.amount > 0)) out.push("ingredient_amount_wrong");
    if (x.unit != null && x.unit !== "" && !(UNITS as readonly string[]).includes(String(x.unit))) out.push("ingredient_unit_wrong");
    if (x.unit && x.amount == null) out.push("ingredient_amount_wrong");
  }
  for (const s of d.method ?? []) if (!textsShape(s) || !hasEnglish(s)) out.push("english_needed");
  for (const p of d.pictures ?? []) {
    if (!p || typeof p.photo !== "string" || !/^photos\/[a-z0-9-]+\.jpg$/.test(p.photo)) out.push("event_image_wrong");
    else if (!hasEnglish(p.alt)) out.push("alt_missing");
  }
  return [...new Set(out)];
}

/** What is wrong with a season, as message keys; empty when it is fine. */
export function seasonProblems(s: SeasonInput): string[] {
  if (!s || typeof s !== "object") return ["english_needed"];
  if (s.name != null && !textsShape(s.name)) return ["english_needed"];
  if (s.description != null && !textsShape(s.description)) return ["english_needed"];
  const out: string[] = [];
  if (!hasEnglish(s.name)) out.push("season_name_missing");
  if (s.description != null && hasWords(s.description) && !hasEnglish(s.description)) out.push("english_needed");
  const start = dayOf(s.start), end = dayOf(s.end);
  if (!start || !end) out.push("season_date_wrong");
  else if (end < start) out.push("season_dates_order");
  return out;
}

const menuDoc = (yamlText: string) => parseDocument(yamlText?.trim() ? yamlText : "seasons: []\ndrinks: []\n");
const seqOf = (doc: any, key: "seasons" | "drinks") => { if (!doc.has(key)) doc.set(key, []); return doc.get(key) as any; };
const findAt = (seq: any, slug: string): number => seq.items.findIndex((x: any) => x.get?.("slug") === slug);
/** A slug from a name that no entry of the list has yet: the name, or with -2, -3 behind it. */
const freeSlug = (seq: any, name: string) => {
  const base = slugify(name);
  let slug = base;
  for (let n = 2; findAt(seq, slug) >= 0; n++) slug = `${base}-${n}`;
  return slug;
};
/** The file as text, refused when the result would not build (src/menu.ts says why). */
const menuText = (doc: any): string => {
  const text = doc.toString({ lineWidth: 0 });
  readMenu(parseYaml(text));
  return text;
};
const flowTexts = (doc: any, v: Partial<Texts>) => { const n = doc.createNode(cleanTexts(v)); n.flow = true; return n; };
const flowList = (doc: any, list: string[]) => { const n = doc.createNode(list); n.flow = true; return n; };

/**
 * menu.yml with a drink added (no `was`) or changed (`was` is its slug). Its slug is made
 * once from its first name and stays, so its page keeps its address under a new name.
 * `seasons` lists every season it is in after the save: it is added at the end of a season
 * it joins and taken out of one it leaves. A save is a person's own check of every text on
 * the form, so the drafted mark goes. Returns the file and the drink's slug.
 */
export function saveDrink(yamlText: string, d: DrinkInput, opts: { was?: string | null; seasons: string[] }): { text: string; slug: string } {
  const problems = drinkProblems(d);
  if (problems.length) throw new Error(problems.join(", "));
  const doc = menuDoc(yamlText);
  const drinks = seqOf(doc, "drinks"), seasons = seqOf(doc, "seasons");
  const known = new Set<string>(seasons.items.map((s: any) => String(s.get("slug"))));
  if (!Array.isArray(opts.seasons) || opts.seasons.some((s) => !known.has(s))) throw new Error("season_unknown");
  const name = d.name.trim();
  const at = opts.was ? findAt(drinks, opts.was) : -1;
  if (opts.was && at < 0) throw new Error("drink_not_found");
  if (drinks.items.some((x: any, i: number) => i !== at && String(x.get("name") ?? "").trim().toLowerCase() === name.toLowerCase())) throw new Error("drink_exists");
  const slug = at >= 0 ? opts.was! : freeSlug(drinks, name);
  const node = doc.createNode({ slug, name, price_chf: d.price_chf }) as any;
  node.set("text", flowTexts(doc, d.text));
  if (d.experience && hasEnglish(d.experience)) node.set("experience", flowTexts(doc, d.experience));
  const rows = (d.ingredients ?? []).map((x) => {
    const row = doc.createNode({ ...(x.amount != null ? { amount: x.amount } : {}), ...(x.unit ? { unit: x.unit } : {}) }) as any;
    row.set("item", flowTexts(doc, x.item));
    row.flow = true;
    return row;
  });
  node.set("ingredients", doc.createNode(rows));
  node.set("method", doc.createNode((d.method ?? []).map((s) => flowTexts(doc, s))));
  node.set("pictures", doc.createNode((d.pictures ?? []).map((p) => { const n = doc.createNode({ photo: p.photo }) as any; n.set("alt", flowTexts(doc, p.alt)); return n; })));
  if (at >= 0) drinks.items[at] = node; else drinks.add(node);
  for (const s of seasons.items) {
    const list: string[] = (s.get("drinks")?.toJSON?.() ?? []).map(String);
    const wanted = opts.seasons.includes(String(s.get("slug")));
    const next = wanted ? (list.includes(slug) ? list : [...list, slug]) : list.filter((x) => x !== slug);
    if (next.join() !== list.join()) s.set("drinks", flowList(doc, next));
  }
  return { text: menuText(doc), slug };
}

/** menu.yml without a drink: it leaves the drinks and every season that named it. */
export function removeDrink(yamlText: string, slug: string): string {
  const doc = menuDoc(yamlText);
  const drinks = seqOf(doc, "drinks");
  const at = findAt(drinks, slug);
  if (at < 0) throw new Error("drink_not_found");
  drinks.items.splice(at, 1);
  for (const s of seqOf(doc, "seasons").items) {
    const list: string[] = (s.get("drinks")?.toJSON?.() ?? []).map(String);
    if (list.includes(slug)) s.set("drinks", flowList(doc, list.filter((x) => x !== slug)));
  }
  return menuText(doc);
}

/**
 * menu.yml with a season added (no `was`) or changed (`was` is its slug): name, first and
 * last day, description. Its drinks stay; its slug is made once and stays, so a link to it
 * keeps working. Saving drops the drafted mark. Returns the file and the season's slug.
 */
export function saveSeason(yamlText: string, s: SeasonInput, was?: string | null): { text: string; slug: string } {
  const problems = seasonProblems(s);
  if (problems.length) throw new Error(problems.join(", "));
  const doc = menuDoc(yamlText);
  const seasons = seqOf(doc, "seasons");
  const at = was ? findAt(seasons, was) : -1;
  if (was && at < 0) throw new Error("season_not_found");
  const slug = at >= 0 ? was! : freeSlug(seasons, cleanTexts(s.name).en!);
  const kept: string[] = at >= 0 ? (seasons.items[at].get("drinks")?.toJSON?.() ?? []).map(String) : [];
  const node = doc.createNode({ slug }) as any;
  node.set("name", flowTexts(doc, s.name));
  // Quoted, so the day stays a plain text and never turns into a timestamp.
  for (const [k, v] of [["start", dayOf(s.start)], ["end", dayOf(s.end)]] as const) { const day = doc.createNode(v) as any; day.type = "QUOTE_DOUBLE"; node.set(k, day); }
  if (s.description && hasEnglish(s.description)) node.set("description", flowTexts(doc, s.description));
  node.set("drinks", flowList(doc, kept));
  if (at >= 0) seasons.items[at] = node; else seasons.add(node);
  return { text: menuText(doc), slug };
}

/** menu.yml without a season. Only an empty season goes: its drinks would otherwise vanish from the menu unasked. */
export function removeSeason(yamlText: string, slug: string): string {
  const doc = menuDoc(yamlText);
  const seasons = seqOf(doc, "seasons");
  const at = findAt(seasons, slug);
  if (at < 0) throw new Error("season_not_found");
  if ((seasons.items[at].get("drinks")?.toJSON?.() ?? []).length) throw new Error("season_not_empty");
  seasons.items.splice(at, 1);
  return menuText(doc);
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
