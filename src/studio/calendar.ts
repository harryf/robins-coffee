// Dates a person can read, and the calendar at the bottom of the Events screen.
// Pure: no disk, no clock of its own, and it imports only the type of the strings file,
// so the screen and the server can both use it. All days are Zürich days.
import type { Strings } from "./strings";

const pad = (n: number) => String(n).padStart(2, "0");
const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** Monday first, as the calendar is drawn. */
export const WEEK = ["mo", "tu", "we", "th", "fr", "sa", "su"] as const;
export const ZONE = "Europe/Zurich";

/** The numbers of a moment on a wall clock in a time zone. Only numbers come from Intl, never words. */
function wall(at: Date, timeZone: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at).map((x) => [x.type, Number(x.value)]));
  return { day: `${p.year}-${pad(p.month!)}-${pad(p.day!)}`, time: `${pad(p.hour!)}:${pad(p.minute!)}` };
}
export const zonedDay = (at: Date, timeZone = ZONE) => wall(at, timeZone).day;
const utc = (day: string) => new Date(`${day}T00:00:00Z`);
const addDays = (day: string, n: number) => new Date(utc(day).getTime() + n * 864e5).toISOString().slice(0, 10);
/** 0 for Monday to 6 for Sunday. */
const weekday = (day: string) => (utc(day).getUTCDay() + 6) % 7;

/** "Sunday 29 November 2026" in the screen's language; anything that is not a day comes back as it was. */
export function dayWords(day: string, t: Strings): string {
  if (!DAY.test(day)) return day;
  return t.date_long(t[`day_${WEEK[weekday(day)]!}`], Number(day.slice(8)), t.month(Number(day.slice(5, 7))), Number(day.slice(0, 4)));
}

/** "Sun 29 Nov 2026", for a list of many days. */
export function dayShort(day: string, t: Strings): string {
  if (!DAY.test(day)) return day;
  return t.date_short(t.day_short(WEEK[weekday(day)]!), Number(day.slice(8)), t.month_short(Number(day.slice(5, 7))), Number(day.slice(0, 4)));
}

export type When = { date?: string; dates?: string[]; every?: string; until?: string; from?: string; to?: string; start?: string; end?: string };

/**
 * When an event is on, in words: one day; every Wednesday until a day; or a count with
 * the list of its days in `days`. Times follow when the event has them.
 */
export function whenWords(e: When, t: Strings, timeZone = ZONE): { line: string; days: string[] } {
  const span = (from?: string, to?: string) => (from ? t.when_times(from, to ?? null) : "");
  const join = (what: string, times: string) => (times ? t.when_with_times(what, times) : what);
  if (e.start && e.end) {
    const a = wall(new Date(e.start), timeZone), b = wall(new Date(e.end), timeZone);
    return { line: join(dayWords(a.day, t), span(a.time, b.time)), days: [] };
  }
  const times = span(e.from, e.to);
  if (e.every) {
    const name = (WEEK as readonly string[]).includes(e.every) ? t[`day_${e.every as (typeof WEEK)[number]}`] : e.every;
    return { line: join(t.when_every(name, e.date ? dayWords(e.date, t) : null, e.until ? dayWords(e.until, t) : null), times), days: [] };
  }
  if (e.dates?.length) {
    const days = [...e.dates].sort();
    if (days.length === 1) return { line: join(dayWords(days[0]!, t), times), days: [] };
    return { line: join(t.when_days(days.length), times), days: days.map((d) => dayShort(d, t)) };
  }
  return { line: e.date ? join(dayWords(e.date, t), times) : "", days: [] };
}

/** One event of the built site's events.json, as far as the calendar needs it. */
export type FeedEvent = { id: string; name: string; start: string; end: string; all_day?: boolean; source?: string };
export type CalendarEvent = { id: string; name: string; time: string | null; mine: boolean; file: string | null };
export type CalendarDay = { day: string; number: number; inMonth: boolean; today: boolean; past: boolean; events: CalendarEvent[] };
export type CalendarMonth = { year: number; month: number; weeks: CalendarDay[][] };

/**
 * The event file an event of the site came from, or null. The build names a hand event
 * `manual-<file name>`, with `-<day>` behind it when the file holds many days.
 */
export function fileOfEvent(id: string, fileNames: string[]): string | null {
  if (!id.startsWith("manual-")) return null;
  const rest = id.slice("manual-".length);
  const hits = fileNames.filter((n) => rest === n || (rest.startsWith(n + "-") && DAY.test(rest.slice(n.length + 1))));
  return hits.sort((a, b) => b.length - a.length)[0] ?? null;
}

/**
 * Month grids, Monday first, for every event that has not ended: from this month to the
 * month of the last event, at most `maxMonths`, a month without any event left out.
 * `fileNames` are the event files of the working copy (without folder and ".md").
 */
export function calendarMonths(events: FeedEvent[], now: Date, fileNames: string[] = [], timeZone = ZONE, maxMonths = 12): CalendarMonth[] {
  const today = zonedDay(now, timeZone);
  const byDay = new Map<string, (CalendarEvent & { at: number })[]>();
  for (const e of events) {
    const start = new Date(e.start), end = new Date(e.end);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end.getTime() <= now.getTime()) continue;
    const at = wall(start, timeZone);
    const file = fileOfEvent(e.id, fileNames);
    const list = byDay.get(at.day) ?? [];
    list.push({ id: e.id, name: e.name, time: e.all_day ? null : at.time, mine: e.source === "manual", file, at: start.getTime() });
    byDay.set(at.day, list);
  }
  const days = [...byDay.keys()].sort();
  if (!days.length) return [];
  const months: CalendarMonth[] = [];
  let year = Number(today.slice(0, 4)), month = Number(today.slice(5, 7));
  const last = days.at(-1)!.slice(0, 7);
  for (let i = 0; i < maxMonths && `${year}-${pad(month)}` <= last; i++, month === 12 ? (year++, (month = 1)) : month++) {
    const key = `${year}-${pad(month)}`;
    if (!days.some((d) => d.startsWith(key))) continue;
    const first = `${key}-01`;
    let day = addDays(first, -weekday(first));
    const weeks: CalendarDay[][] = [];
    do {
      const week: CalendarDay[] = [];
      for (let k = 0; k < 7; k++, day = addDays(day, 1)) {
        const inMonth = day.startsWith(key);
        const list = inMonth ? (byDay.get(day) ?? []).sort((a, b) => a.at - b.at || a.name.localeCompare(b.name)) : [];
        week.push({ day, number: Number(day.slice(8)), inMonth, today: day === today, past: day < today, events: list.map(({ at: _at, ...event }) => event) });
      }
      weeks.push(week);
    } while (day.startsWith(key));
    months.push({ year, month, weeks });
  }
  return months;
}
