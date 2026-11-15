// Events: several sources in, one clean list out. Pure and browser-safe, like the
// renderer; fetching and writing files is the build's job (src/build.ts).
import { parseFrontMatter, type Files } from "./render";

export type SiteEvent = {
  id: string;
  source: "iyf" | "eventfrog" | "manual";
  /** Short name for cards ("Comedy Brew"). */
  name: string;
  /** Full title for search engines and calendars. */
  title: string;
  start: string; // ISO 8601 with offset
  end: string;
  price_chf: number | null;
  ticket_url: string;
  more_url: string | null;
  image: string | null;
  category: "comedy" | "music" | "other";
  organiser: string | null;
  language: string;
  featured?: boolean;
};
export type Override = { id: string; hide?: boolean; featured?: boolean; name?: string; image?: string };

const TRACK = "utm_source=robins&utm_medium=referral&utm_campaign=website";
const tracked = (url: string) => url + (url.includes("?") ? "&" : "?") + TRACK;

/** The comedy site's /events.json, kept to one venue. Ticket links go through its /go/ tracker. */
export function fromIyfFeed(feed: any, venue = "robins"): SiteEvent[] {
  return (feed?.events ?? [])
    .filter((e: any) => e.venue === venue && e.status !== "EventCancelled")
    .map((e: any): SiteEvent => ({
      id: `iyf-${e.id}`, source: "iyf", name: e.name, title: e.title, start: e.start, end: e.end,
      price_chf: typeof e.price_chf === "number" ? e.price_chf : null,
      ticket_url: tracked(e.go_url ?? e.ticket_url), more_url: e.url ? tracked(e.url) : null,
      image: e.thumbnail ?? e.image ?? null, category: "comedy", organiser: "IN YOUR FACE Comedy", language: e.language ?? "en",
    }));
}

/** Hand-written events: site/events/<date>-<slug>.md with front matter. */
export function fromManual(files: Files): SiteEvent[] {
  return Object.entries(files).filter(([p]) => /^events\/.+\.md$/.test(p) && !p.endsWith("README.md")).map(([p, text]): SiteEvent => {
    const { data } = parseFrontMatter(text);
    for (const k of ["title", "start", "end"]) if (!data[k]) throw new Error(`${p}: "${k}" is missing`);
    const iso = (v: any) => (v instanceof Date ? v.toISOString() : String(v));
    return {
      id: `manual-${p.slice(7, -3)}`, source: "manual", name: data.name ?? data.title, title: data.title, start: iso(data.start), end: iso(data.end),
      price_chf: typeof data.price_chf === "number" ? data.price_chf : null, ticket_url: data.ticket_url ?? "", more_url: data.more_url ?? null,
      image: data.image ?? null, category: data.category ?? "other", organiser: data.organiser ?? null, language: data.language ?? "en",
    };
  });
}

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();
const instant = (iso: string) => new Date(iso).getTime();

/**
 * One list from many: earlier lists win. Two records are the same event when they
 * share a ticket link and a start, or a start and a normalised name. Overrides are
 * applied last; the result is sorted by start.
 */
export function mergeEvents(lists: SiteEvent[][], overrides: Override[] = []): SiteEvent[] {
  const seen = new Set<string>();
  const out: SiteEvent[] = [];
  for (const e of lists.flat()) {
    const keys = [`${instant(e.start)}|${norm(e.name)}`, ...(e.ticket_url ? [`${instant(e.start)}|${e.ticket_url.split("?")[0]}|${e.ticket_url.match(/show=[^&]+/)?.[0] ?? ""}`] : [])];
    if (keys.some((k) => seen.has(k))) continue;
    keys.forEach((k) => seen.add(k));
    out.push(e);
  }
  const by = new Map(overrides.map((o) => [o.id, o]));
  return out
    .filter((e) => !by.get(e.id)?.hide)
    .map((e) => { const o = by.get(e.id); return o ? { ...e, name: o.name ?? e.name, image: o.image ?? e.image, featured: o.featured ?? e.featured } : e; })
    .sort((a, b) => instant(a.start) - instant(b.start) || a.id.localeCompare(b.id));
}

/** Events that have not ended yet, optionally only those starting within `days`. */
export function upcoming(events: SiteEvent[], now: Date, days?: number): SiteEvent[] {
  const limit = days ? now.getTime() + days * 864e5 : Infinity;
  return events.filter((e) => instant(e.end) > now.getTime() && instant(e.start) <= limit);
}

const icsTime = (iso: string) => new Date(iso).toISOString().replace(/[-:]|\.\d{3}/g, "");
const icsText = (s: string) => s.replace(/\\/g, "\\\\").replace(/([,;])/g, "\\$1").replace(/\n/g, "\\n");

/** A calendar feed people can subscribe to. */
export function toIcs(events: SiteEvent[], site: { legal_name: string; street: string; postal_code: string; city: string }, stamp: Date): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//robins-coffee.ch//events//EN", "CALSCALE:GREGORIAN", `X-WR-CALNAME:${icsText(site.legal_name)}`];
  for (const e of events) lines.push("BEGIN:VEVENT", `UID:${e.id}@robins-coffee.ch`, `DTSTAMP:${icsTime(stamp.toISOString())}`, `DTSTART:${icsTime(e.start)}`, `DTEND:${icsTime(e.end)}`,
    `SUMMARY:${icsText(e.title)}`, `LOCATION:${icsText(`${site.legal_name}, ${site.street}, ${site.postal_code} ${site.city}`)}`, ...(e.ticket_url ? [`URL:${e.ticket_url}`] : []), "END:VEVENT");
  return lines.concat("END:VCALENDAR").join("\r\n") + "\r\n";
}
