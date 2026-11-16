// What the editor may change and how a change becomes file text. Pure: no DOM, no
// network, so every rule here is tested with `bun test`.
import { parse as parseYaml } from "yaml";
import { momentMarkdown, type MomentText } from "../moment";
import { STRINGS, type Strings } from "./strings";

export const DAYS = ["mo", "tu", "we", "th", "fr", "sa", "su"] as const;
export type Day = (typeof DAYS)[number];
/** One day of the week. `close: null` means "until late". */
export type DayHours = { closed: boolean; open: string; close: string | null };
export type Week = Record<Day, DayHours>;
/**
 * One file of a change, by its path under site/. A photo carries bytes, everything else text.
 * `base` is the file's text on the site when the change was written (null: the file is new).
 * The send compares it with GitHub, so a draft kept for days never overwrites newer work.
 */
export type Change = { path: string; label: string; text?: string; bytes?: Uint8Array; base?: string | null };

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
 * time like 24:00. Then the editor refuses, and nothing is lost by a silent rewrite.
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

export function validateWeek(week: Week, t: Strings = STRINGS.en): string[] {
  const problems: string[] = [];
  for (const d of DAYS) {
    const h = week[d];
    if (h.closed) continue;
    if (!TIME.test(h.open)) problems.push(`${d}: ${t.v_open}`);
    if (h.close !== null && !TIME.test(h.close)) problems.push(`${d}: ${t.v_close}`);
    if (h.close !== null && h.close === h.open) problems.push(`${d}: ${t.v_same}`);
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

/** "Über die Bar!" to "ueber-die-bar": lower case ASCII, at most 40 characters. */
export function slugify(s: string): string {
  const plain = s.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss").normalize("NFD").replace(/[̀-ͯ]/g, "");
  return plain.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");
}

export type NewMoment = MomentText & { slug: string };
export const momentId = (m: NewMoment) => `${m.date}-${m.slug}`;

/** Everything that would fail the build or break a house rule, said in plain words. */
export function validateMoment(m: NewMoment, existingIds: string[], albums: string[], t: Strings = STRINGS.en): string[] {
  const problems: string[] = [];
  const day = new Date(m.date + "T12:00:00Z");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(m.date) || Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== m.date) problems.push(t.v_date);
  if (!m.slug) problems.push(t.v_slug);
  else if (existingIds.includes(momentId(m))) problems.push(t.v_exists);
  for (const [name, value] of [[t.f_cap_en, m.caption.en], [t.f_cap_de, m.caption.de], [t.f_alt_en, m.alt.en], [t.f_alt_de, m.alt.de]] as const) {
    if (!value.trim()) problems.push(t.v_missing(name));
    if (/TODO/.test(value)) problems.push(t.v_todo(name));
    if (value.includes("\u2014")) problems.push(t.v_dash(name));
  }
  if (/ß/.test(m.caption.de + m.alt.de)) problems.push(t.v_sharp_s);
  if (m.album && !albums.includes(m.album)) problems.push(t.v_album(m.album));
  return problems;
}

/** The two files of a new moment. */
export function momentChanges(m: NewMoment, photo: Uint8Array): Change[] {
  const base = `moments/${momentId(m)}`;
  return [
    { path: `${base}.jpg`, label: `Photo: ${m.caption.en}`, bytes: photo, base: null },
    { path: `${base}.md`, label: `Photo: ${m.caption.en}`, text: momentMarkdown(m), base: null },
  ];
}

export { inEditScope } from "./scope";

/** edit/<login>/<slug>-<date>-<time>: the time, to the second, keeps two changes apart. */
export function branchName(login: string, slug: string, now: Date): string {
  const stamp = now.toISOString().slice(0, 19).replace(/[T:]/g, "-");
  return `edit/${slugify(login) || "editor"}/${slug || "change"}-${stamp}`;
}

/** A title and a plain summary for the pull request. */
export function describe(changes: Change[], login: string): { title: string; body: string } {
  const labels = [...new Set(changes.filter((c) => !c.path.endsWith(".md") || !changes.some((o) => o.path === c.path.replace(/\.md$/, ".jpg"))).map((c) => c.label))];
  const title = labels.length === 1 ? labels[0]! : `${labels[0]} and ${labels.length - 1} more`;
  return { title: title.slice(0, 100), body: `Sent from the editor by @${login}.\n\n${labels.map((l) => `- ${l}`).join("\n")}\n\nFiles:\n${changes.map((c) => `- \`site/${c.path}\``).join("\n")}\n` };
}

/**
 * The files of a kept draft that no longer sit on what the site has now: the site's file
 * changed after the draft was written, or a file the draft would add is already there.
 */
export function staleChanges(draft: Change[], siteFiles: Record<string, string>): Change[] {
  return draft.filter((c) => c.text !== undefined && c.base !== undefined && (siteFiles[c.path] ?? null) !== c.base);
}

/** A change's English label or pull request title, in the language of the screen. */
export const localLabel = (label: string, t: Strings) => label.replace(/^Photo: /, `${t.photo}: `).replace(/^Opening hours\b/, t.hours_title);

/** The files of a pull request in plain words: one line for the hours, one for photos, the path for anything else. */
export function whatChanged(repoPaths: string[], t: Strings): string[] {
  const out = new Set<string>();
  for (const p of repoPaths) {
    if (p === "site/data/hours.yml") out.add(t.hours_title);
    else if (/^site\/moments\//.test(p)) out.add(t.photo);
    else out.add(t.other_file(p));
  }
  return [...out];
}

export type Review = { user: { login: string } | null; state: string; body?: string | null; commit_id?: string | null };
export type Verdict = { state: "waiting" } | { state: "approved"; by: string } | { state: "rejected"; by: string; reason: string };

/**
 * Where a change stands, from GitHub's list of reviews (oldest first). Each person's
 * last yes or no counts; the author's own never does. One standing no is "rejected".
 * A yes counts only for the commit the branch is at now.
 */
export function verdict(reviews: Review[], author: string, headSha: string): Verdict {
  const last = new Map<string, Review>();
  for (const r of reviews) if (r.user && r.user.login !== author && (r.state === "APPROVED" || r.state === "CHANGES_REQUESTED")) last.set(r.user.login, r);
  const no = [...last.values()].find((r) => r.state === "CHANGES_REQUESTED");
  if (no) return { state: "rejected", by: no.user!.login, reason: (no.body ?? "").trim() };
  const yes = [...last.values()].find((r) => r.commit_id === headSha);
  return yes ? { state: "approved", by: yes.user!.login } : { state: "waiting" };
}
