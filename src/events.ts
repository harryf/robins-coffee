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
  /** A date without a time: the card shows the day only. */
  all_day?: boolean;
  /** One or two sentences under the name, per language. */
  text?: Record<string, string> | null;
  /** The Eventfrog number of the evening, when a link carries one: the same evening from two sources is shown once. */
  ref?: string | null;
};
/** The long number at the end of an Eventfrog event address. */
export const eventfrogRef = (...urls: (string | null | undefined)[]): string | null => {
  for (const u of urls) { const m = /eventfrog\.[a-z]+\/.*-(\d{12,})\.html/.exec(u ?? ""); if (m) return m[1]!; }
  return null;
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
      image: e.thumbnail ?? e.image ?? null, category: "comedy", organiser: "IN YOUR FACE Comedy", language: e.language ?? "en", ref: eventfrogRef(e.ticket_url, e.go_url),
    }));
}

const pad = (n: number) => String(n).padStart(2, "0");
const dayString = (v: any) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v));
const addDays = (day: string, n: number) => new Date(Date.parse(day + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const WEEKDAYS = ["su", "mo", "tu", "we", "th", "fr", "sa"];

/** "2026-12-11" and "19:30" on a wall clock in a time zone, as ISO 8601 with that day's offset (summer time included). */
export function zonedIso(day: string, time: string, timeZone: string): string {
  const wall = Date.parse(`${day}T${time}:00Z`);
  const offset = (t: number) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(t)).map((x) => [x.type, Number(x.value)]));
    return Math.round((Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!) - t) / 60000);
  };
  const min = offset(wall - offset(wall) * 60000);
  return `${day}T${time}:00${min < 0 ? "-" : "+"}${pad(Math.floor(Math.abs(min) / 60))}:${pad(Math.abs(min) % 60)}`;
}

/** How far ahead a weekly event is laid out. */
export const REPEAT_DAYS = 70;

/**
 * Hand-written events: site/events/<name>.md with front matter. Two ways to say when:
 * `start` and `end` as full times, or `date` with optional `from` and `to` ("19:00");
 * without `from` the event has a day but no time. One file can hold many dates:
 * `dates: [..]` lists them, `every: we` repeats weekly (from `date`, up to `until`).
 */
export function fromManual(files: Files, opts: { now?: Date; timeZone?: string } = {}): SiteEvent[] {
  const timeZone = opts.timeZone ?? "Europe/Zurich";
  const now = opts.now ?? new Date();
  return Object.entries(files).filter(([p]) => /^events\/.+\.md$/.test(p) && !p.endsWith("README.md")).flatMap(([p, text]): SiteEvent[] => {
    const { data } = parseFrontMatter(text);
    const name = p.slice(7, -3);
    if (!data.title) throw new Error(`${p}: "title" is missing`);
    const iso = (v: any) => (v instanceof Date ? v.toISOString() : String(v));
    const base = {
      source: "manual" as const, name: data.name ?? data.title, title: data.title,
      price_chf: typeof data.price_chf === "number" ? data.price_chf : null, ticket_url: data.ticket_url ?? "", more_url: data.more_url ?? null,
      image: data.image ?? null, category: data.category ?? "other", organiser: data.organiser ?? null, language: data.language ?? "",
      text: data.text && typeof data.text === "object" ? data.text : null,
      ref: eventfrogRef(data.source_url, data.ticket_url),
    };
    if (data.start || data.end) {
      for (const k of ["start", "end"]) if (!data[k]) throw new Error(`${p}: "${k}" is missing`);
      return [{ ...base, id: `manual-${name}`, start: iso(data.start), end: iso(data.end) }];
    }
    let days: string[];
    if (Array.isArray(data.dates)) days = data.dates.map(dayString);
    else if (data.every) {
      const want = WEEKDAYS.indexOf(String(data.every));
      if (want < 0) throw new Error(`${p}: "every" must be one of mo, tu, we, th, fr, sa, su`);
      const today = zonedDay(now, timeZone);
      let day = data.date && dayString(data.date) > today ? dayString(data.date) : today;
      while (new Date(day + "T00:00:00Z").getUTCDay() !== want) day = addDays(day, 1);
      const last = [addDays(today, REPEAT_DAYS), ...(data.until ? [dayString(data.until)] : [])].sort()[0]!;
      for (days = []; day <= last; day = addDays(day, 7)) days.push(day);
    } else if (data.date) days = [dayString(data.date)];
    else throw new Error(`${p}: "start" is missing`);
    for (const d of days) if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error(`${p}: "${d}" is not a date like 2026-12-31`);
    const many = days.length > 1 || Array.isArray(data.dates) || !!data.every;
    return days.map((day): SiteEvent => {
      const id = `manual-${name}${many ? "-" + day : ""}`;
      if (!data.from) return { ...base, id, all_day: true, start: zonedIso(day, "00:00", timeZone), end: zonedIso(addDays(day, 1), "00:00", timeZone) };
      const from = String(data.from), to = data.to ? String(data.to) : null;
      const start = zonedIso(day, from, timeZone);
      // An end before the start is after midnight; no end means "until the day is over".
      const end = to ? zonedIso(to <= from ? addDays(day, 1) : day, to, timeZone) : zonedIso(addDays(day, 1), "00:00", timeZone);
      return { ...base, id, start, end };
    });
  });
}

/** The calendar day in a time zone, "2026-11-20". */
export function zonedDay(d: Date, timeZone: string): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric", day: "numeric" }).formatToParts(d).map((x) => [x.type, Number(x.value)]));
  return `${p.year}-${pad(p.month!)}-${pad(p.day!)}`;
}

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();
const instant = (iso: string) => new Date(iso).getTime();

/**
 * One list from many: earlier lists win. Two records are the same event when they
 * share a ticket link and a start, a start and a normalised name, or an Eventfrog number. Overrides are
 * applied last; the result is sorted by start.
 */
export function mergeEvents(lists: SiteEvent[][], overrides: Override[] = []): SiteEvent[] {
  const seen = new Set<string>();
  const out: SiteEvent[] = [];
  for (const e of lists.flat()) {
    const keys = [`${instant(e.start)}|${norm(e.name)}`, ...(e.ref ? [`ef|${e.ref}`] : []), ...(e.ticket_url ? [`${instant(e.start)}|${e.ticket_url.split("?")[0]}|${e.ticket_url.match(/show=[^&]+/)?.[0] ?? ""}`] : [])];
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
  const icsDay = (iso: string) => iso.slice(0, 10).replace(/-/g, "");
  for (const e of events) lines.push("BEGIN:VEVENT", `UID:${e.id}@robins-coffee.ch`, `DTSTAMP:${icsTime(stamp.toISOString())}`,
    ...(e.all_day ? [`DTSTART;VALUE=DATE:${icsDay(e.start)}`, `DTEND;VALUE=DATE:${icsDay(e.end)}`] : [`DTSTART:${icsTime(e.start)}`, `DTEND:${icsTime(e.end)}`]),
    `SUMMARY:${icsText(e.title)}`, `LOCATION:${icsText(`${site.legal_name}, ${site.street}, ${site.postal_code} ${site.city}`)}`, ...(e.ticket_url ? [`URL:${e.ticket_url}`] : []), "END:VEVENT");
  return lines.concat("END:VCALENDAR").join("\r\n") + "\r\n";
}
