// The opening hours form of the Studio: hours.yml to one entry per day and back. Pure:
// no DOM, no network, so every rule here is tested with `bun test`.
import { parse as parseYaml } from "yaml";

export const DAYS = ["mo", "tu", "we", "th", "fr", "sa", "su"] as const;
export type Day = (typeof DAYS)[number];
/** One day of the week. `close: null` means "until late". */
export type DayHours = { closed: boolean; open: string; close: string | null };
export type Week = Record<Day, DayHours>;

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** hours.yml to one entry per day. A day no rule names is closed. */
export function weekFromYaml(text: string): Week {
  const rules: any[] = parseYaml(text)?.regular ?? [];
  return Object.fromEntries(DAYS.map((d) => {
    const r = rules.find((x) => (x.days ?? []).includes(d));
    return [d, !r || r.closed ? { closed: true, open: "16:00", close: "00:00" } : { closed: false, open: String(r.open), close: r.close == null ? null : String(r.close) }];
  })) as Week;
}

/**
 * Can the form keep everything this hours.yml says? It cannot when the file was written
 * by hand in a shape the form has no fields for: two rules for one day, an extra key, a
 * time like 24:00. Then the form refuses, and nothing is lost by a silent rewrite.
 */
export function hoursEditable(text: string): boolean {
  try {
    const before = parseYaml(text);
    const week = weekFromYaml(text);
    if (validateWeek(week).length) return false;
    const after = parseYaml(weekToYaml(text, week));
    const perDay = (data: any) => DAYS.map((d) => (data.regular ?? []).filter((r: any) => (r.days ?? []).includes(d)).map((r: any) => (r.closed ? { closed: true } : { open: String(r.open), close: r.close == null ? null : String(r.close) })));
    const keys = (data: any) => (data.regular ?? []).flatMap((r: any) => Object.keys(r)).filter((k: string) => !["days", "open", "close", "closed"].includes(k));
    const rest = (data: any) => JSON.stringify({ ...data, regular: null });
    return keys(before).length === 0 && perDay(before).every((rules) => rules.length <= 1) && JSON.stringify(perDay(before).map((r) => r[0] ?? { closed: true })) === JSON.stringify(perDay(after).map((r) => r[0] ?? { closed: true })) && rest(before) === rest(after) && (after.regular ?? []).flatMap((r: any) => r.days).length === 7;
  } catch {
    return false;
  }
}

/** What is wrong with a week, one line per problem, in English (the Studio's language). */
export function validateWeek(week: Week): string[] {
  const problems: string[] = [];
  for (const d of DAYS) {
    const h = week[d];
    if (h.closed) continue;
    if (!TIME.test(h.open)) problems.push(`${d}: the opening time must look like 16:00`);
    if (h.close !== null && !TIME.test(h.close)) problems.push(`${d}: the closing time must look like 23:30, or be left empty for "until late"`);
    if (h.close !== null && h.close === h.open) problems.push(`${d}: opening and closing time are the same`);
  }
  return problems;
}

/**
 * The week written back into hours.yml. Only the `regular:` block is replaced, so the
 * comments and the dated exceptions stay as they are. Neighbouring days with the same
 * hours share one rule, as a person would write it.
 */
export function weekToYaml(text: string, week: Week): string {
  const same = (a: DayHours, b: DayHours) => a.closed === b.closed && (a.closed || (a.open === b.open && a.close === b.close));
  const groups: { days: Day[]; h: DayHours }[] = [];
  for (const d of DAYS) (groups.length && same(groups.at(-1)!.h, week[d]) ? groups.at(-1)! : groups[groups.push({ days: [], h: week[d] }) - 1]!).days.push(d);
  const block = groups.map(({ days, h }) => `  - days: [${days.join(", ")}]\n` + (h.closed ? "    closed: true\n" : `    open: "${h.open}"\n    close: ${h.close === null ? "null" : `"${h.close}"`}\n`)).join("");
  const found = /^regular:[^\n]*\n(?:[ \t]+[^\n]*\n|\n(?=[ \t]))*/m.exec(text);
  if (!found) throw new Error("hours.yml has no regular: block");
  return text.slice(0, found.index) + "regular:\n" + block + text.slice(found.index + found[0].length);
}
