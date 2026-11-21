// Where a picture is cut when a shape does not fit it. Pure and browser-safe.
// A focus is a point from 0 to 1 across and down the picture (0.5, 0.5 is the middle);
// site/data/focus.yml keeps one per photo that needs it, found by Apple Vision in the
// Studio or typed by hand.

export type Focus = [number, number];
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The largest box of a given shape (width / height) inside a picture, as close around the focus as the edges allow. */
export function cropBox(width: number, height: number, aspect: number, focus: Focus = [0.5, 0.5]) {
  let w = width, h = Math.round(width / aspect);
  if (h > height) { h = height; w = Math.round(height * aspect); }
  const left = clamp(Math.round(focus[0] * width - w / 2), 0, width - w);
  const top = clamp(Math.round(focus[1] * height - h / 2), 0, height - h);
  return { left, top, width: w, height: h };
}

/** focus.yml as a map; anything that is not two numbers from 0 to 1 is refused. */
export function readFocus(data: unknown): Record<string, Focus> {
  const out: Record<string, Focus> = {};
  for (const [path, v] of Object.entries((data as Record<string, unknown>) ?? {})) {
    if (!Array.isArray(v) || v.length !== 2 || v.some((n) => typeof n !== "number" || n < 0 || n > 1)) throw new Error(`focus.yml: ${path} needs two numbers from 0 to 1`);
    out[path] = [v[0], v[1]];
  }
  return out;
}

const GENERIC = new Set(["liquid", "structure", "tableware", "utensil", "adult", "material", "wood_processed", "indoor", "outdoor", "machine", "consumer_electronics", "art", "textile", "housewares", "container", "conveyance"]);
/**
 * A first alt text from what Vision saw, in English. It is a draft on purpose: a list of
 * things and read words, for a person to turn into a sentence. The other languages are
 * translated from the finished English when it is saved.
 */
export function draftAlt(seen: { labels?: { name: string; confidence: number }[]; text?: string[]; faces?: unknown[] }): { en: string } {
  const words = (seen.text ?? []).map((t) => t.trim()).filter((t) => t.length > 1).slice(0, 5);
  const labels = (seen.labels ?? []).map((l) => l.name).filter((n) => !GENERIC.has(n)).slice(0, 4);
  const people = (seen.faces ?? []).length;
  const en: string[] = [];
  if (people) en.push(people === 1 ? "One person" : `${people} people`);
  const named = labels.filter((n) => n !== "people");
  if (named.length) en.push(named.map((n) => n.replace(/_/g, " ")).join(", "));
  if (words.length) en.push(`text: "${words.join(" / ")}"`);
  const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) + "." : "");
  return { en: cap(en.join("; ")) };
}
