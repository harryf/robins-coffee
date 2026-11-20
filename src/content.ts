// Writers for the content files an editor changes: events, albums, the drinks menu.
// Pure and browser-safe: text in, text out. The Studio and the scripts share them, so a
// form and a hand edit produce the same file.
import { parse as parseYaml, parseDocument } from "yaml";

const q = (s: string) => JSON.stringify(String(s));
export const slugify = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "event";
const DAY = /^\d{4}-\d{2}-\d{2}$/, TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
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
  if (!e.title?.trim()) out.push("event_title_missing");
  const whens = [e.start ? 1 : 0, e.date ? 1 : 0, e.dates?.length ? 1 : 0, e.every ? 1 : 0].reduce((a, b) => a + b, 0);
  if (e.start) { if (!e.end || Number.isNaN(Date.parse(e.start)) || Number.isNaN(Date.parse(e.end)) || Date.parse(e.end) < Date.parse(e.start)) out.push("event_time_wrong"); }
  else if (!e.date && !e.dates?.length && !e.every) out.push("event_date_missing");
  if (whens > 1 && !(e.every && e.date && whens === 2)) out.push("event_date_twice");
  for (const d of [e.date, e.until, ...(e.dates ?? [])]) if (d && !DAY.test(d)) out.push("event_date_wrong");
  if (e.every && !["mo", "tu", "we", "th", "fr", "sa", "su"].includes(e.every)) out.push("event_date_wrong");
  for (const t of [e.from, e.to]) if (t && !TIME.test(t)) out.push("event_time_wrong");
  if (e.to && !e.from) out.push("event_time_wrong");
  if (e.ticket_url && !/^https:\/\/[^\s]+$/.test(e.ticket_url)) out.push("event_link_wrong");
  if (!!e.text?.en?.trim() !== !!e.text?.de?.trim()) out.push("both_languages");
  if (e.image && !/^photos\/[a-z0-9-]+\.jpg$/.test(e.image)) out.push("event_image_wrong");
  if (e.price_chf != null && !(e.price_chf >= 0)) out.push("event_price_wrong");
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
