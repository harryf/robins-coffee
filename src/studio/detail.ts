// What exactly changed, one line per thing, for the commit and the pull request: "Photo
// added: `2026-11-07-x.jpg`, "Elias at the taps", album Comedy". Pure: the texts come in,
// before and after. English only, like every commit here. A file this cannot read gives
// no line, and the caller falls back to the path.
import { parse as parseYaml } from "yaml";

export type FileTexts = { path: string; status: "added" | "modified" | "removed"; before: string | null; after: string | null };

const DID = { added: "added", modified: "updated", removed: "removed" } as const;
/** One line, no line breaks, no backticks, not longer than a person reads. */
const clean = (s: unknown, max = 160) => {
  // "@name" in a pull request would call a stranger on GitHub: the space keeps it a plain word.
  const one = String(s ?? "").replace(/[\s`]+/g, " ").replace(/@(?=\w)/g, "@ ").trim();
  return one.length > max ? one.slice(0, max - 1).trimEnd() + "…" : one;
};
const quote = (s: unknown) => `"${clean(s).replace(/"/g, "'")}"`;
const yaml = (text: string | null): any => {
  try {
    return parseYaml(text ?? "") ?? {};
  } catch {
    return {};
  }
};
/** The block between the first two `---` lines of a moment or an event. */
const front = (text: string | null): any => yaml(/^---\n([\s\S]*?)\n---/.exec(text ?? "")?.[1] ?? "");
const en = (v: any): string => (typeof v === "string" ? v : v?.en ?? "");
const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : v == null || v === "" ? [] : [String(v)]);
const day = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? "").slice(0, 10));

function albums(before: string | null, after: string | null): string[] {
  const read = (text: string | null) => new Map<string, string>((yaml(text).albums ?? []).map((a: any) => [String(a.slug), en(a.title) || String(a.slug)]));
  const was = read(before);
  const now = read(after);
  const lines: string[] = [];
  for (const [slug, title] of now) {
    if (!was.has(slug)) lines.push(`Album added: ${quote(title)} (\`${clean(slug)}\`)`);
    else if (was.get(slug) !== title) lines.push(`Album renamed: ${quote(was.get(slug))} is now ${quote(title)}`);
  }
  for (const [slug, title] of was) if (!now.has(slug)) lines.push(`Album removed: ${quote(title)} (\`${clean(slug)}\`)`);
  return lines.length ? lines : ["Albums updated"];
}

function menu(before: string | null, after: string | null): string[] {
  // Seasons and drinks, each known by its slug (a renamed one is the same entry).
  const read = (text: string | null, key: "seasons" | "drinks") => {
    const list = yaml(text)[key];
    return new Map<string, any>((Array.isArray(list) ? list : []).filter((x: any) => x && x.slug != null).map((x: any) => [String(x.slug), x]));
  };
  const lines: string[] = [];
  const compare = (key: "seasons" | "drinks", label: string, more: (x: any) => string) => {
    const was = read(before, key), now = read(after, key);
    for (const [slug, x] of now) {
      const name = en(x.name) || slug;
      if (!was.has(slug)) lines.push(`${label} added: ${quote(name)}${more(x)}`);
      else if (JSON.stringify(was.get(slug)) !== JSON.stringify(x)) lines.push(`${label} updated: ${quote(name)}${more(x)}`);
    }
    for (const [slug, x] of was) if (!now.has(slug)) lines.push(`${label} removed: ${quote(en(x.name) || slug)}`);
  };
  compare("seasons", "Season", (s) => (s.start && s.end ? `, ${day(s.start)} to ${day(s.end)}` : ""));
  compare("drinks", "Drink", (d) => (d.price_chf == null ? "" : `, CHF ${clean(d.price_chf)}`));
  return lines.length ? lines : ["Menu updated"];
}

function hours(after: string | null): string[] {
  const h = yaml(after);
  const week = (h.regular ?? []).map((r: any) => `${list(r.days).join(" ")} ${r.closed ? "closed" : `${clean(r.open)} to ${r.close == null ? "late" : clean(r.close)}`}`);
  const lines = week.length ? [`Opening hours now: ${week.join("; ")}`] : ["Opening hours updated"];
  for (const x of h.exceptions ?? []) lines.push(`Exception on ${day(x.date)}: ${x.closed ? "closed" : `${clean(x.open)} to ${x.close == null ? "late" : clean(x.close)}`}`);
  return lines;
}

function event(f: FileTexts): string[] {
  const e = front(f.status === "removed" ? f.before : f.after);
  const name = clean(e.name || e.title) || f.path.slice(f.path.lastIndexOf("/") + 1);
  const when = e.every ? `every ${list(e.every).join(", ")}${e.until ? ` until ${day(e.until)}` : ""}` : e.dates ? list(e.dates.map?.((d: any) => day(d?.date ?? d)) ?? e.dates).join(", ") : e.date ? `${day(e.date)}${e.from ? ` at ${clean(e.from)}` : ""}` : "";
  return [`Event ${DID[f.status]}: ${quote(name)}${when ? `, ${clean(when)}` : ""}${e.ticket_url ? `, tickets at ${clean(e.ticket_url)}` : ""}`];
}

/** The top level keys of a data file whose value is not what it was. */
function keys(label: string, before: string | null, after: string | null, skip: (key: string) => boolean = () => false): string[] {
  const was = yaml(before);
  const now = yaml(after);
  const all = [...new Set([...Object.keys(was), ...Object.keys(now)])].filter((k) => JSON.stringify(was[k]) !== JSON.stringify(now[k]));
  const changed = all.filter((k) => !skip(k));
  // Everything that changed is told by another line already.
  if (all.length && !changed.length) return [];
  return [changed.length ? `${label} updated: ${changed.map((k) => clean(k)).join(", ")}` : `${label} updated`];
}

/**
 * The lines for a set of changed files. `albumTitles` names an album by its title; a
 * photo is its two files told once. The order is the order of `files`.
 */
export function detailLines(files: FileTexts[], albumTitles: Record<string, string> = {}): string[] {
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const f of files) {
    const moment = /^site\/moments\/(.+)\.(jpg|md)$/.exec(f.path);
    if (moment) {
      const id = moment[1]!;
      if (seen.has(id)) continue;
      seen.add(id);
      const both = files.filter((x) => x.path === `site/moments/${id}.jpg` || x.path === `site/moments/${id}.md`);
      const status = both.find((x) => x.status !== "modified")?.status ?? "modified";
      const md = both.find((x) => x.path.endsWith(".md"));
      const m = front(status === "removed" ? md?.before ?? null : md?.after ?? null);
      const parts = [`\`${clean(id)}.jpg\``];
      if (en(m.caption)) parts.push(quote(en(m.caption)));
      if (m.album) parts.push(`album ${quote(albumTitles[String(m.album)] ?? m.album)}`);
      if (m.feed === false) parts.push("gallery only");
      lines.push(`Photo ${DID[status]}: ${parts.join(", ")}${status !== "removed" && en(m.alt) ? `. Shows: ${quote(en(m.alt))}` : ""}`);
    } else if (f.path === "site/data/albums.yml") lines.push(...albums(f.before, f.after));
    else if (f.path === "site/data/menu.yml") lines.push(...menu(f.before, f.after));
    else if (f.path === "site/data/hours.yml") lines.push(...hours(f.after));
    else if (/^site\/events\/.+\.md$/.test(f.path) && !/\/README\.md$/i.test(f.path)) lines.push(...event(f));
    else if (f.path === "site/data/site.yml") lines.push(...keys("Venue details", f.before, f.after));
    else if (f.path === "site/data/home.yml") lines.push(...keys("Home page", f.before, f.after));
    // The cut of a picture that comes or goes in the same change is part of that picture's own line.
    else if (f.path === "site/data/focus.yml") lines.push(...keys("Where a picture is cut", f.before, f.after, (k) => files.some((x) => x.path === `site/${k}` && x.status !== "modified")));
    else if (/^site\/photos\/.+\.jpg$/.test(f.path)) lines.push(`Picture ${DID[f.status]}: \`${clean(f.path.slice("site/photos/".length))}\``);
    else lines.push(`\`${clean(f.path)}\` (${f.status})`);
  }
  return lines;
}
