// The drinks menu: seasons and drinks, as site/data/menu.yml holds them.
//
// A drink is written once, in `drinks:`, with its recipe and pictures. A season names
// its drinks by slug, so a drink that comes back next year is the same entry with the
// same page, and a change to its recipe is made in one place. The season running on a
// day is the one the home page shows.
//
// Pure and browser-safe: the renderer and the Studio's rules both read the file through
// readMenu(), so the build and a save refuse the same mistakes with the same words.

/** The measures an ingredient may use: metric bar measures, or none ("2 egg whites"). */
export const UNITS = ["cl", "ml", "g", "dash", "drop", "barspoon", "piece"] as const;
export type Unit = (typeof UNITS)[number];
/** The texts the Studio may mark as drafted for a person to check. */
export const DRAFTABLE = ["experience", "description"] as const;

export type Texts = { en: string; [lang: string]: string | undefined };
export type Ingredient = { amount?: number; unit?: Unit; item: Texts };
export type Picture = { photo: string; alt: Texts };
export type Drink = {
  slug: string; name: string; price_chf: number;
  /** The short line under the name on a card: what is in it. */
  text: Texts;
  /** What drinking it is like, in a few sentences. */
  experience?: Texts;
  ingredients: Ingredient[];
  /** Short steps, in order. */
  method: Texts[];
  /** The first is the drawing of the menu card; more can be real photos. */
  pictures: Picture[];
  draft: string[];
};
export type Season = { slug: string; name: Texts; start: string; end: string; description?: Texts; drinks: string[]; draft: string[] };
export type Menu = { seasons: Season[]; drinks: Drink[] };

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/, DAY = /^\d{4}-\d{2}-\d{2}$/, PHOTO = /^photos\/[a-z0-9-]+\.jpg$/, LANG = /^[a-z]{2}$/;

/** A date as the file may hold it (a YAML date or a string), as "2026-09-01"; "" when it is not one. */
export function dayOf(v: unknown): string {
  const s = v instanceof Date ? v.toISOString().slice(0, 10) : typeof v === "string" ? v.trim() : "";
  if (!DAY.test(s)) return "";
  const at = Date.parse(`${s}T00:00:00Z`);
  return !Number.isNaN(at) && new Date(at).toISOString().slice(0, 10) === s ? s : "";
}

const isTexts = (v: unknown): v is Texts =>
  !!v && typeof v === "object" && !Array.isArray(v) && Object.entries(v).every(([k, x]) => LANG.test(k) && (x == null || typeof x === "string")) && typeof (v as Texts).en === "string" && !!(v as Texts).en.trim();

/**
 * The menu file read and checked. Throws an Error whose message names the file, the
 * entry and what is wrong, so the build stops with a sentence a person can act on.
 * An empty or missing file is an empty menu.
 */
export function readMenu(data: unknown): Menu {
  if (data == null) return { seasons: [], drinks: [] };
  const fail = (where: string, what: string): never => { throw new Error(`menu.yml: ${where}: ${what}`); };
  if (typeof data !== "object" || Array.isArray(data)) fail("the file", "must hold `seasons:` and `drinks:`");
  const raw = data as Record<string, unknown>;
  if ("sections" in raw) fail("the file", "`sections:` is the old shape; the menu is `seasons:` and `drinks:` now");
  const list = (v: unknown, where: string): any[] => (v == null ? [] : Array.isArray(v) ? v : fail(where, "must be a list"));
  const texts = (v: unknown, where: string, need: boolean): Texts | undefined => {
    if (v == null) return need ? fail(where, "needs an English text (en)") : undefined;
    if (!isTexts(v)) return fail(where, "must be texts by language with an English text (en)");
    return Object.fromEntries(Object.entries(v).filter(([, x]) => typeof x === "string" && x.trim()).map(([k, x]) => [k, (x as string).trim()])) as Texts;
  };
  const drafts = (v: unknown, where: string): string[] => list(v, where).map((x) => (DRAFTABLE.includes(x) ? String(x) : fail(where, `"${x}" is not a text that can be a draft (${DRAFTABLE.join(", ")})`)));

  const drinks: Drink[] = list(raw.drinks, "drinks").map((d: any, i: number) => {
    const at = `drink ${d?.slug ?? d?.name ?? i + 1}`;
    if (!d || typeof d !== "object") fail(at, "must be an entry with slug, name and price_chf");
    if (typeof d.slug !== "string" || !SLUG.test(d.slug)) fail(at, "slug must be lower case letters, digits and hyphens");
    if (typeof d.name !== "string" || !d.name.trim()) fail(at, "needs a name");
    if (typeof d.price_chf !== "number" || !Number.isFinite(d.price_chf) || d.price_chf < 0) fail(at, "price_chf must be a number");
    const ingredients: Ingredient[] = list(d.ingredients, `${at}: ingredients`).map((x: any, n: number) => {
      const where = `${at}: ingredient ${n + 1}`;
      if (!x || typeof x !== "object") fail(where, "must be an entry with an item");
      if (x.amount != null && !(typeof x.amount === "number" && Number.isFinite(x.amount) && x.amount > 0)) fail(where, "amount must be a number above 0");
      if (x.unit != null && x.unit !== "" && !UNITS.includes(x.unit)) fail(where, `unit must be one of ${UNITS.join(", ")} or left out`);
      if (x.unit && x.amount == null) fail(where, "a unit needs an amount");
      return { ...(x.amount != null ? { amount: x.amount } : {}), ...(x.unit ? { unit: x.unit } : {}), item: texts(x.item, `${where}: item`, true)! };
    });
    const method = list(d.method, `${at}: method`).map((x: unknown, n: number) => texts(x, `${at}: method step ${n + 1}`, true)!);
    const pictures: Picture[] = list(d.pictures, `${at}: pictures`).map((p: any, n: number) => {
      const where = `${at}: picture ${n + 1}`;
      if (!p || typeof p.photo !== "string" || !PHOTO.test(p.photo)) fail(where, "photo must be a path like photos/menu-name.jpg");
      return { photo: p.photo, alt: texts(p.alt, `${where}: alt`, true)! };
    });
    return {
      slug: d.slug, name: d.name.trim(), price_chf: d.price_chf,
      text: texts(d.text, `${at}: text`, true)!,
      ...(d.experience != null ? { experience: texts(d.experience, `${at}: experience`, false) } : {}),
      ingredients, method, pictures, draft: drafts(d.draft, `${at}: draft`),
    };
  });
  const bySlug = new Map<string, Drink>();
  for (const d of drinks) { if (bySlug.has(d.slug)) fail(`drink ${d.slug}`, "two drinks have this slug"); bySlug.set(d.slug, d); }

  const seasons: Season[] = list(raw.seasons, "seasons").map((s: any, i: number) => {
    const at = `season ${s?.slug ?? i + 1}`;
    if (!s || typeof s !== "object") fail(at, "must be an entry with slug, name, start and end");
    if (typeof s.slug !== "string" || !SLUG.test(s.slug)) fail(at, "slug must be lower case letters, digits and hyphens");
    const start = dayOf(s.start), end = dayOf(s.end);
    if (!start) fail(at, "start must be a day like 2026-09-01");
    if (!end) fail(at, "end must be a day like 2027-02-28");
    if (end < start) fail(at, "end comes before start");
    const names = list(s.drinks, `${at}: drinks`).map((x: unknown) => (typeof x === "string" && bySlug.has(x) ? x : fail(`${at}: drinks`, `"${x}" is not the slug of a drink in drinks:`)));
    if (new Set(names).size !== names.length) fail(`${at}: drinks`, "names a drink twice");
    return { slug: s.slug, name: texts(s.name, `${at}: name`, true)!, start, end, ...(s.description != null ? { description: texts(s.description, `${at}: description`, false) } : {}), drinks: names, draft: drafts(s.draft, `${at}: draft`) };
  });
  const seen = new Set<string>();
  for (const s of seasons) { if (seen.has(s.slug)) fail(`season ${s.slug}`, "two seasons have this slug"); seen.add(s.slug); }
  return { seasons, drinks };
}

/** Where a season stands on a day: running, over, or still to come. */
export const seasonState = (s: Season, today: string): "now" | "past" | "upcoming" => (today < s.start ? "upcoming" : today > s.end ? "past" : "now");

/**
 * The season the home page shows on a day: the running one (the latest to start when two
 * overlap); between seasons the one that ended last; before the first, the first to come.
 * Null only when there is no season at all, so the menu is never empty by the calendar.
 */
export function currentSeason(seasons: Season[], today: string): Season | null {
  const by = (key: "start" | "end", dir: 1 | -1) => (a: Season, b: Season) => (a[key] < b[key] ? -dir : a[key] > b[key] ? dir : 0);
  const running = seasons.filter((s) => seasonState(s, today) === "now").sort(by("start", -1));
  if (running.length) return running[0]!;
  const past = seasons.filter((s) => seasonState(s, today) === "past").sort(by("end", -1));
  if (past.length) return past[0]!;
  return [...seasons].sort(by("start", 1))[0] ?? null;
}

/**
 * The seasons in the order the menu page lists them: the one shown now first, then the
 * ones to come (soonest first), then the ones that are over (newest first).
 */
export function seasonOrder(seasons: Season[], today: string): Season[] {
  const first = currentSeason(seasons, today);
  const rest = seasons.filter((s) => s !== first);
  const upcoming = rest.filter((s) => seasonState(s, today) === "upcoming").sort((a, b) => a.start.localeCompare(b.start));
  const other = rest.filter((s) => seasonState(s, today) !== "upcoming").sort((a, b) => b.start.localeCompare(a.start));
  return [...(first ? [first] : []), ...upcoming, ...other];
}

/** "1.5" or "1,5": an amount with the page's decimal sign, without trailing zeros. */
export const amountWords = (n: number, decimal: string) => String(Math.round(n * 100) / 100).replace(".", decimal);
