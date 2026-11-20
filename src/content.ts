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

export type EventInput = {
  title: string; name?: string;
  /** One day, a list of days, or a weekday code for a weekly evening. */
  date?: string; dates?: string[]; every?: string; until?: string;
  from?: string; to?: string;
  /** Full times instead of date/from/to (an import knows them exactly). */
  start?: string; end?: string;
  text?: { en?: string; de?: string };
  image?: string; ticket_url?: string; price_chf?: number | null;
  category?: "comedy" | "music" | "other"; organiser?: string; source_url?: string;
};

/** What is wrong with an event, as message keys the screen translates; empty when it is fine. */
export function eventProblems(e: EventInput): string[] {
  const out: string[] = [];
  // Shape first: everything below may then treat a field as the text it should be.
  if (!e || typeof e !== "object") return ["event_shape_wrong"];
  for (const v of [e.title, e.name, e.organiser, e.ticket_url, e.source_url, e.image, e.date, e.until, e.from, e.to, e.every, e.start, e.end, e.text?.en, e.text?.de]) if (v != null && typeof v !== "string") return ["event_shape_wrong"];
  if (e.dates !== undefined && (!Array.isArray(e.dates) || e.dates.some((d) => typeof d !== "string"))) return ["event_shape_wrong"];
  if (e.text !== undefined && (e.text === null || typeof e.text !== "object")) return ["event_shape_wrong"];
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
  if (!!e.text?.en?.trim() !== !!e.text?.de?.trim()) out.push("both_languages");
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
  if (e.text?.en?.trim()) lines.push("text:", `  en: ${q(e.text.en.trim())}`, `  de: ${q(noSharpS(e.text.de!.trim()))}`);
  lines.push(`ticket_url: ${q(e.ticket_url ?? "")}`);
  if (e.source_url) lines.push(`source_url: ${q(e.source_url)}`);
  lines.push("---", "");
  const slug = slugify(e.name?.trim() || e.title);
  return { path: `events/${single ? first + "-" : ""}${slug}.md`, text: lines.join("\n") };
}

export type AlbumInput = { slug?: string; title: { en: string; de: string }; cover?: string };

/** albums.yml with one more album; comments and order of the file are kept. */
export function addAlbum(yamlText: string, a: AlbumInput): { text: string; slug: string } {
  if (!a.title?.en?.trim() || !a.title?.de?.trim()) throw new Error("both_languages");
  const slug = a.slug?.trim() || slugify(a.title.en);
  if (!/^[a-z0-9-]+$/.test(slug)) throw new Error("album_slug_wrong");
  const doc = parseDocument(yamlText);
  const list: any[] = (parseYaml(yamlText)?.albums ?? []) as any[];
  if (list.some((x) => x.slug === slug)) throw new Error("album_exists");
  const entry: any = { slug, title: { en: a.title.en.trim(), de: noSharpS(a.title.de.trim()) } };
  if (a.cover) entry.cover = a.cover;
  if (!doc.has("albums")) doc.set("albums", []);
  const node = doc.createNode(entry) as any;
  node.get("title", true).flow = true;
  (doc.get("albums") as any).add(node);
  return { text: doc.toString({ lineWidth: 0 }), slug };
}

export type DrinkInput = { name: string; text: { en: string; de: string }; price_chf: number; photo?: string; alt?: { en: string; de: string } };

export function drinkProblems(d: DrinkInput): string[] {
  const out: string[] = [];
  if (!d || typeof d !== "object") return ["drink_name_missing"];
  for (const v of [d.name, d.photo, d.text?.en, d.text?.de, d.alt?.en, d.alt?.de]) if (v != null && typeof v !== "string") return ["both_languages"];
  if (!d.name?.trim()) out.push("drink_name_missing");
  if (!d.text?.en?.trim() || !d.text?.de?.trim()) out.push("both_languages");
  if (!(typeof d.price_chf === "number" && d.price_chf >= 0)) out.push("drink_price_wrong");
  if (d.photo && !/^photos\/[a-z0-9-]+\.jpg$/.test(d.photo)) out.push("event_image_wrong");
  if (d.photo && (!d.alt?.en?.trim() || !d.alt?.de?.trim())) out.push("alt_missing");
  return out;
}

/**
 * menu.yml with a drink added to a part of the menu, or replaced when the part already
 * has one of that name. A part that does not exist yet is created from `partTitle`.
 */
export function setDrink(yamlText: string, part: string, d: DrinkInput, partTitle?: { en: string; de: string }): string {
  const problems = drinkProblems(d);
  if (problems.length) throw new Error(problems.join(", "));
  if (!/^[a-z0-9-]+$/.test(part)) throw new Error("menu_part_wrong");
  const doc = parseDocument(yamlText || "sections: []\n");
  if (!doc.has("sections")) doc.set("sections", []);
  const sections = doc.get("sections") as any;
  let section = sections.items.find((s: any) => s.get("slug") === part);
  if (!section) {
    if (!partTitle?.en?.trim() || !partTitle?.de?.trim()) throw new Error("both_languages");
    section = doc.createNode({ slug: part, title: { en: partTitle.en.trim(), de: noSharpS(partTitle.de.trim()) }, drinks: [] });
    (section.get("title", true) as any).flow = true;
    sections.add(section);
  }
  const entry: any = { name: d.name.trim(), text: { en: d.text.en.trim(), de: noSharpS(d.text.de.trim()) }, price_chf: d.price_chf };
  if (d.photo) { entry.photo = d.photo; entry.alt = { en: d.alt!.en.trim(), de: noSharpS(d.alt!.de.trim()) }; }
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
export function changeDrink(yamlText: string, was: { part: string; name: string }, part: string, d: DrinkInput, partTitle?: { en: string; de: string }): string {
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

export type MomentEdit = { caption: { en: string; de: string }; alt: { en: string; de: string }; album?: string | null; feed?: boolean };

/**
 * The text file of a photo with a new caption, alt text, album and home page switch.
 * Its date, its notes and any line this form does not know stay as they are.
 */
export function editMoment(mdText: string, m: MomentEdit): string {
  const found = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(mdText);
  if (!found) throw new Error("photo_not_found");
  for (const v of [m?.caption?.en, m?.caption?.de, m?.alt?.en, m?.alt?.de]) if (typeof v !== "string" || !v.trim()) throw new Error("both_languages");
  if (m.album != null && m.album !== "" && (typeof m.album !== "string" || !/^[a-z0-9-]+$/.test(m.album))) throw new Error("album_unknown");
  const doc = parseDocument(found[1]!);
  const texts = (v: { en: string; de: string }) => doc.createNode({ en: v.en.trim(), de: noSharpS(v.de.trim()) });
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
  if (data.text && typeof data.text === "object") e.text = { en: String(data.text.en ?? ""), de: String(data.text.de ?? "") };
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
