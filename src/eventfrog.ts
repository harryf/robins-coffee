// Eventfrog as a source of events. Two ways in: the public page of an event or a series
// (anyone can paste its address), and the organiser's own list through the API with a
// read key. Pure and testable: every request goes through a `fetch` that is handed in.
// The key travels in the Authorization header only and never appears in an error.

/** What an import knows about one evening. */
export type Imported = {
  title: string;
  start: string; // ISO 8601 with offset
  end: string;
  url: string; // the public ticket page
  image: string | null;
  organiser: string | null;
  price_chf: number | null;
  text: string; // one or two plain sentences, may be empty
  /** The short text in each language Eventfrog has it in, by language code ("de", "en"); empty when the language is not known. */
  texts: Record<string, string>;
};

/** "de", "de-CH" or "DE" as "de"; null for anything that is not a language code. */
const langOf = (locale: unknown): string | null => {
  const code = typeof locale === "string" ? locale.trim().slice(0, 2).toLowerCase() : "";
  return /^[a-z]{2}$/.test(code) && /^[a-zA-Z]{2}([-_][a-zA-Z0-9]+)?$/.test(String(locale).trim()) ? code : null;
};

const HOSTS = /^(www\.)?eventfrog\.(ch|de|at|net)$/;
const IMAGE_HOSTS = /^([a-z0-9-]+\.)?eventfrog\.(ch|de|at|net)$/;

/** Only https addresses on Eventfrog's own sites are ever fetched. */
export function eventfrogUrl(input: string): URL {
  let url: URL;
  try { url = new URL(input.trim()); } catch { throw new Error("That is not a web address."); }
  if (url.protocol !== "https:" || !HOSTS.test(url.hostname)) throw new Error("The address must be an https://eventfrog.ch page.");
  url.hash = "";
  url.search = "";
  return url;
}

/** A picture address is used only when it is on Eventfrog's own servers. */
export const eventfrogImage = (src: unknown): string | null => {
  try { const u = new URL(String(Array.isArray(src) ? src[0] : src)); return u.protocol === "https:" && IMAGE_HOSTS.test(u.hostname) ? u.href : null; } catch { return null; }
};

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", uuml: "ü", ouml: "ö", auml: "ä", Uuml: "Ü", Ouml: "Ö", Auml: "Ä", eacute: "é", egrave: "è", agrave: "à", ndash: "-", mdash: "-", hellip: "...", rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"' };
/** HTML to plain text: tags out, the common entities back to characters, spaces tidied. */
export function plainText(html: string): string {
  return String(html ?? "").replace(/<[^>]*>/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-zA-Z]+);/g, (m, name) => ENTITIES[name] ?? m).replace(/\s+/g, " ").trim();
}

/** The first sentence or two, at most `max` characters, never cut inside a word. */
export function shortText(text: string, max = 160): string {
  const plain = plainText(text);
  if (plain.length <= max) return plain;
  const sentences = plain.match(/[^.!?]+[.!?]+/g) ?? [];
  let out = "";
  for (const s of sentences) { if ((out + s).trim().length > max) break; out += s; }
  if (out.trim()) return out.trim();
  return plain.slice(0, max).replace(/\s+\S*$/, "") + "...";
}

function fromLd(node: any, parent?: any): Imported | null {
  if (!node || node["@type"] !== "Event" || !node.name || !node.startDate) return null;
  const offer = node.offers ?? parent?.offers;
  const low = offer?.lowPrice ?? offer?.price;
  const price = node.isAccessibleForFree === true ? 0 : low !== undefined && low !== "" && !Number.isNaN(Number(low)) ? Number(low) : null;
  const text = shortText(node.description ?? parent?.description ?? "");
  // A page says the language of its text only when its data names it; otherwise the Studio finds out.
  const lang = langOf(node.inLanguage ?? parent?.inLanguage);
  return {
    title: plainText(node.name), start: String(node.startDate), end: String(node.endDate ?? node.startDate), url: String(node.url ?? parent?.url ?? ""),
    image: eventfrogImage(node.image ?? parent?.image), organiser: node.organizer?.name ? plainText(node.organizer.name) : parent?.organizer?.name ? plainText(parent.organizer.name) : null,
    price_chf: price, text, texts: lang && text ? { [lang]: text } : {},
  };
}

/**
 * The evenings on a public Eventfrog page, read from its structured data. An event page
 * gives one; a series page gives every date it lists (`subEvent`). Past dates are kept:
 * the caller decides what to show.
 */
export function parseEventfrogPage(html: string): { kind: "event" | "series"; events: Imported[] } {
  const nodes: any[] = [];
  for (const m of html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    try { const j = JSON.parse(m[1]!); nodes.push(...(Array.isArray(j) ? j : j["@graph"] ?? [j])); } catch { /* a broken block is skipped */ }
  }
  const main = nodes.find((n) => n?.["@type"] === "Event");
  if (!main) throw new Error("No event was found on that page.");
  if (Array.isArray(main.subEvent) && main.subEvent.length) {
    const events = main.subEvent.map((s: any) => fromLd(s, main)).filter((e: Imported | null): e is Imported => !!e);
    if (!events.length) throw new Error("The series page lists no dates.");
    return { kind: "series", events: events.sort((a: Imported, b: Imported) => a.start.localeCompare(b.start)) };
  }
  const one = fromLd(main);
  if (!one) throw new Error("No event was found on that page.");
  return { kind: "event", events: [one] };
}

type Fetch = (url: string, init?: any) => Promise<{ ok: boolean; status: number; text(): Promise<string>; url?: string; headers?: { get(name: string): string | null }; arrayBuffer?: () => Promise<ArrayBuffer> }>;

/**
 * A GET that never asks an address before `check` has passed it: redirects are not
 * followed by the fetch itself but walked here, at most three, each hop checked first.
 * `check` returns the address to ask, or throws.
 */
export async function fetchChecked(address: string, check: (url: string) => string, fetchFn: Fetch, headers: Record<string, string> = {}) {
  let next = check(address);
  for (let hop = 0; hop < 4; hop++) {
    const res = await fetchFn(next, { headers, redirect: "manual", signal: AbortSignal.timeout(20_000) });
    const to = res.status >= 300 && res.status < 400 ? res.headers?.get("location") : null;
    if (!to) return res;
    next = check(new URL(to, next).href);
  }
  throw new Error("Too many redirects.");
}

/** Fetch a pasted address and read its evenings. */
export async function importFromPage(address: string, fetchFn: Fetch): Promise<{ kind: "event" | "series"; events: Imported[] }> {
  const res = await fetchChecked(address, (u) => eventfrogUrl(u).href, fetchFn, { Accept: "text/html", "User-Agent": "Mozilla/5.0 (site editor)" });
  if (!res.ok) throw new Error(`Eventfrog answered ${res.status} for that address.`);
  return parseEventfrogPage(await res.text());
}

export const EVENTFROG_API = "https://api.eventfrog.net";

/** One event of the organiser API's list, as far as its shape is known (docs/decisions has the source). */
export function fromApiEvent(e: any): Imported | null {
  if (!e || e.cancelled || e.visibility?.published === false || typeof e.beginDate !== "string") return null;
  const infos: any[] = Array.isArray(e.localizedInfo) ? e.localizedInfo : [];
  const info = infos.find((l: any) => l?.title) ?? {};
  if (!info.title) return null;
  // Every language the organiser wrote the event in; the first one of a language wins.
  const texts: Record<string, string> = {};
  for (const l of infos) {
    const lang = langOf(l?.locale), said = shortText(l?.shortDescription ?? l?.description ?? "");
    if (lang && said && !texts[lang]) texts[lang] = said;
  }
  return {
    title: plainText(info.title), start: e.beginDate, end: typeof e.endDate === "string" ? e.endDate : e.beginDate, url: typeof e.url === "string" ? e.url : "",
    image: eventfrogImage(e.emblemToShow?.url ?? e.emblem?.url ?? null), organiser: null, price_chf: null, text: shortText(info.shortDescription ?? info.description ?? ""), texts,
  };
}

/** The organiser's upcoming events. Read only: one GET per page, the key in the header. */
export async function listOrganiserEvents(key: string, fetchFn: Fetch, now = new Date()): Promise<Imported[]> {
  if (!key) throw new Error("No Eventfrog key is saved.");
  const out: Imported[] = [];
  for (let page = 1; page <= 5; page++) {
    const res = await fetchFn(`${EVENTFROG_API}/organizer/v1/events?page=${page}&perPage=1000`, { method: "GET", headers: { Authorization: `Bearer ${key}`, Accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
    if (res.status === 401 || res.status === 403) throw new Error("Eventfrog did not accept the key.");
    if (!res.ok) throw new Error(`Eventfrog answered ${res.status}.`);
    const body = JSON.parse(await res.text());
    const rows: any[] = body.data ?? [];
    out.push(...rows.map(fromApiEvent).filter((e): e is Imported => !!e));
    if (!rows.length || page * 1000 >= (body.totalNumberOfResources ?? 0)) break;
  }
  return out.filter((e) => new Date(e.end).getTime() > now.getTime()).sort((a, b) => a.start.localeCompare(b.start));
}
