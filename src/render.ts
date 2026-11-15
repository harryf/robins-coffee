// The renderer: content + data + templates in, HTML pages out.
//
// This module is PURE and BROWSER-SAFE on purpose: no file system, no Node APIs.
// The build (src/build.ts) feeds it files read from disk; the editor PWA will feed
// it the same files fetched from GitHub plus the editor's unsaved changes, so the
// preview an editor sees is the real build, not an imitation. Keep it that way:
// anything that needs disk, sharp or the network belongs in the caller.
import { Liquid } from "liquidjs";
import { marked } from "marked";
import { parse as parseYaml } from "yaml";
import { upcoming, type SiteEvent } from "./events";

/** Text files keyed by path relative to site/, for example "content/en/index.md". */
export type Files = Record<string, string>;
export type Variant = { w: number; path: string };
export type Photo = { width: number; height: number; jpg: Variant[]; webp: Variant[] };
export type RenderOptions = {
  /** "/" on the domain, "/robins-coffee/" on GitHub Pages, or "relative" for file:// and the editor preview. */
  base: string;
  photos: Record<string, Photo>;
  /** Scheme and host the build is served from, for absolute URLs (hreflang, canonical). Defaults to site.url. */
  origin?: string;
  /** The moment the build runs; decides which events are still ahead. Defaults to now. */
  now?: Date;
  /** Appended to asset URLs so a deploy busts caches. */
  version?: string;
};
export type Page = { lang: string; slug: string; url: string; out: string; depth: number; data: Record<string, any>; html: string };

const DAYS = ["mo", "tu", "we", "th", "fr", "sa", "su"] as const;

export function parseFrontMatter(text: string): { data: Record<string, any>; body: string } {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  if (!m) return { data: {}, body: text };
  return { data: (parseYaml(m[1]!) as Record<string, any>) ?? {}, body: m[2]! };
}

/** Site path ("/de/") to a URL that works for the chosen base. */
export function resolveUrl(path: string, base: string, depth: number): string {
  if (/^(https?:|mailto:|tel:|#)/.test(path)) return path;
  const rest = path.replace(/^\//, "");
  if (base !== "relative") return base + rest;
  const up = depth === 0 ? "./" : "../".repeat(depth);
  return up + rest + (rest === "" || rest.endsWith("/") ? "index.html" : "");
}

/** Rows like "Mon to Fri 16:00 until late" from hours.yml, in the page language. */
export function hoursRows(hours: any, t: any) {
  return (hours.regular ?? []).map((r: any) => {
    const idx = (r.days as string[]).map((d) => DAYS.indexOf(d as any)).sort((a, b) => a - b);
    const consecutive = idx.every((v, i) => i === 0 || v === idx[i - 1]! + 1);
    const name = (i: number) => t.days_short[DAYS[i]!];
    const label = idx.length > 2 && consecutive ? `${name(idx[0]!)}${t.range_sep}${name(idx.at(-1)!)}` : idx.map(name).join(", ");
    // Midnight reads better as 24:00 at the end of a range ("16:00 to 24:00").
    return { label, open: r.open, close: r.close === "00:00" ? "24:00" : (r.close ?? null), closed: !!r.closed };
  });
}

const SCHEMA_DAYS: Record<string, string> = { mo: "Monday", tu: "Tuesday", we: "Wednesday", th: "Thursday", fr: "Friday", sa: "Saturday", su: "Sunday" };

function jsonLd(site: any, hours: any, lang: string, pageUrl: string) {
  // No Review or AggregateRating, ever: Google calls a business's own reviews self-serving.
  const spec = (hours.regular ?? []).filter((r: any) => r.close && !r.closed).map((r: any) => ({
    "@type": "OpeningHoursSpecification", dayOfWeek: r.days.map((d: string) => SCHEMA_DAYS[d]), opens: r.open, closes: r.close,
  }));
  return {
    "@context": "https://schema.org",
    "@type": ["CafeOrCoffeeShop", "BarOrPub"],
    name: site.legal_name,
    url: pageUrl,
    telephone: site.phone,
    email: site.email,
    foundingDate: String(site.founded),
    address: { "@type": "PostalAddress", streetAddress: site.street, postalCode: site.postal_code, addressLocality: site.city, addressCountry: site.country },
    geo: { "@type": "GeoCoordinates", latitude: site.latitude, longitude: site.longitude },
    hasMap: site.maps_url,
    sameAs: [`https://www.instagram.com/${site.instagram}/`],
    inLanguage: lang,
    ...(spec.length ? { openingHoursSpecification: spec } : {}),
  };
}

function eventLd(e: SiteEvent, site: any) {
  return {
    "@type": e.category === "comedy" ? "ComedyEvent" : "Event", name: e.title, startDate: e.start, endDate: e.end,
    eventStatus: "https://schema.org/EventScheduled", eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    location: { "@type": "Place", name: site.legal_name, address: { "@type": "PostalAddress", streetAddress: site.street, postalCode: site.postal_code, addressLocality: site.city, addressCountry: site.country } },
    ...(e.organiser ? { organizer: { "@type": "Organization", name: e.organiser } } : {}),
    ...(e.ticket_url ? { offers: { "@type": "Offer", url: e.ticket_url, ...(e.price_chf === null ? {} : { price: e.price_chf, priceCurrency: "CHF" }), availability: "https://schema.org/InStock" } } : {}),
  };
}

export async function renderSite(files: Files, opts: RenderOptions): Promise<Page[]> {
  const data: Record<string, any> = {};
  const templates: Record<string, string> = {};
  for (const [path, text] of Object.entries(files)) {
    let m;
    if ((m = /^data\/(.+)\.(yml|json)$/.exec(path))) data[m[1]!] = m[2] === "json" ? JSON.parse(text) : parseYaml(text);
    else if ((m = /^templates\/(.+)\.liquid$/.exec(path))) templates[m[1]!] = text;
  }
  const site = data.site;
  const langs: string[] = site.languages;
  const defaultLang = langs[0]!;

  const moments = Object.entries(files)
    .filter(([p]) => /^moments\/.+\.md$/.test(p))
    .map(([p, text]) => {
      const { data: fm } = parseFrontMatter(text);
      const date = fm.date instanceof Date ? fm.date.toISOString().slice(0, 10) : String(fm.date);
      return { ...fm, date, id: p.slice(8, -3), photo: p.replace(/\.md$/, ".jpg") };
    })
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id < b.id ? -1 : 1));
  for (const m of moments) if (!opts.photos[m.photo]) throw new Error(`moment ${m.id}: photo ${m.photo} is missing`);
  for (const p of data.home?.about_photos ?? []) if (!opts.photos[p.photo]) throw new Error(`home.yml about_photos: photo ${p.photo} is missing`);

  let current = { depth: 0 };
  const engine = new Liquid({ templates, extname: "", strictFilters: true, strictVariables: false, outputEscape: "escape" });
  const url = (p: string) => resolveUrl(String(p), opts.base, current.depth);
  engine.registerFilter("url", url);
  engine.registerFilter("asset", (p: string) => url(p) + (opts.version && opts.base !== "relative" ? `?v=${opts.version}` : ""));
  // hreflang and canonical must be absolute; in a relative build there is no address, so the path is kept.
  const origin = (opts.origin ?? site.url).replace(/\/$/, "");
  engine.registerFilter("absolute", (p: string) => (opts.base === "relative" ? url(p) : origin + url(p)));
  engine.registerFilter("srcset", (vs: Variant[]) => (vs ?? []).map((v) => `${url("/" + v.path)} ${v.w}w`).join(", "));
  engine.registerFilter("largest", (vs: Variant[]) => url("/" + vs.at(-1)!.path));
  engine.registerFilter("json", (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c"));
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[c]!);
  // "Coffee by day. Cocktails by night." -> the last sentence becomes the neon sign.
  engine.registerFilter("neon_last", (s: string) => {
    const i = String(s).indexOf(". ");
    return i < 0 ? esc(String(s)) : `${esc(s.slice(0, i + 1))} <span class="neon-word">${esc(s.slice(i + 2))}</span>`;
  });
  engine.registerFilter("tel", (s: string) => "tel:" + String(s).replace(/[^+\d]/g, ""));

  // Events: the merged list arrives as data/events.json (written by the build, never committed).
  const now = opts.now ?? new Date();
  const allEvents: SiteEvent[] = data.events?.events ?? [];
  const ahead = upcoming(allEvents, now, 60);
  const zurich = (lang: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(lang === "de" ? "de-CH" : "en-GB", { timeZone: site.timezone, ...o });
  const eventView = (e: SiteEvent, lang: string, t: any) => {
    const d = new Date(e.start);
    const day = zurich(lang, { weekday: "short", day: "numeric", month: "short" }).format(d);
    const time = zurich(lang, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
    return {
      ...e, when_label: `${day}, ${time}`, month_label: zurich(lang, { month: "long", year: "numeric" }).format(d),
      price_label: e.price_chf === null ? "" : e.price_chf === 0 ? t.free_entry : `CHF ${e.price_chf}`,
      language_label: t.event_languages?.[e.language] ?? "", img: e.image ? (opts.photos[e.image] ?? null) : null,
    };
  };

  const pages: Page[] = [];
  const sources = Object.entries(files).filter(([p]) => /^content\/[a-z]{2}\/.+\.md$/.test(p));
  for (const [path, text] of sources) {
    const [, lang, name] = /^content\/([a-z]{2})\/(.+)\.md$/.exec(path)!;
    const slug = name === "index" ? "" : name!;
    const dir = (lang === defaultLang ? "" : `${lang}/`) + (slug ? `${slug}/` : "");
    const { data: fm, body } = parseFrontMatter(text);
    pages.push({ lang: lang!, slug, url: "/" + dir, out: dir + "index.html", depth: dir.split("/").length - 1, data: fm, html: marked.parse(body, { async: false }) as string });
  }

  const out: Page[] = [];
  for (const page of pages) {
    current = { depth: page.depth };
    const t = data.i18n[page.lang];
    const alternates = pages.filter((p) => p.slug === page.slug).map((p) => ({ lang: p.lang, url: p.url }));
    const other = alternates.find((a) => a.lang !== page.lang);
    const views = ahead.map((e) => eventView(e, page.lang, t));
    const months: { label: string; events: typeof views }[] = [];
    for (const v of views) (months.at(-1)?.label === v.month_label ? months.at(-1)! : months[months.push({ label: v.month_label, events: [] }) - 1]!).events.push(v);
    const fmtDate = new Intl.DateTimeFormat(page.lang === "de" ? "de-CH" : "en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
    const scope = {
      site, t, page: { ...page.data, lang: page.lang, url: page.url, slug: page.slug, content: page.html },
      home: data.home, tokens: data.tokens, hours: data.hours,
      hours_rows: hoursRows(data.hours, t),
      home_url: page.lang === defaultLang ? "/" : `/${page.lang}/`,
      alternates, other,
      photos: opts.photos,
      // The hero photo is not repeated as the first card of the feed.
      moments: moments.filter((m: any) => m.photo !== data.home?.hero_photo).map((m: any) => ({ ...m, caption: m.caption?.[page.lang] ?? m.caption?.[defaultLang], alt: m.alt?.[page.lang] ?? m.alt?.[defaultLang], date_label: fmtDate.format(new Date(m.date + "T00:00:00Z")), img: opts.photos[m.photo] })),
      events_url: page.lang === defaultLang ? "/events/" : `/${page.lang}/events/`,
      events_next: views.slice(0, data.home?.events_count ?? 4),
      events_months: months,
      events_json_ld: { "@context": "https://schema.org", "@graph": ahead.map((e) => eventLd(e, site)) },
      noindex: site.preview || page.data.noindex,
      json_ld: jsonLd(site, data.hours, page.lang, site.url + page.url),
    };
    const html = await engine.renderFile(`layouts/${page.data.layout ?? "page"}`, scope);
    out.push({ ...page, html });
  }
  return out;
}
