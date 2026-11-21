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
import { contrast } from "./tokens";

/** Text files keyed by path relative to site/, for example "content/en/index.md". */
export type Files = Record<string, string>;
export type Variant = { w: number; path: string };
export type Photo = { width: number; height: number; jpg: Variant[]; webp: Variant[]; /** The link preview picture (OG_SIZE), when the build made one. */ og?: string; /** Square cuts around the photo's focus, for small cards. */ sq?: { jpg: Variant[]; webp: Variant[] } };
/** The square cut of a photo as a photo of its own; the whole photo when the build made no cut. */
export const squareOf = (p: Photo | undefined | null): Photo | null => (!p ? null : p.sq ? { width: p.sq.jpg.at(-1)!.w, height: p.sq.jpg.at(-1)!.w, jpg: p.sq.jpg, webp: p.sq.webp } : p);
export const OG_SIZE = { width: 1200, height: 630 };
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

type WallClock = { year: number; month: number; day: number; weekday: string; time: string };

/**
 * The date and time a clock on the wall shows in a time zone. Only numbers come from
 * Intl; every word comes from i18n.yml, so the labels are the same on every machine
 * (Intl's own German abbreviations differ between the Mac and the build server).
 */
export function wallClock(d: Date, timeZone: string): WallClock {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d).map((x) => [x.type, x.value]));
  const [year, month, day] = [Number(parts.year), Number(parts.month), Number(parts.day)];
  const weekday = ["su", "mo", "tu", "we", "th", "fr", "sa"][new Date(Date.UTC(year, month - 1, day)).getUTCDay()]!;
  return { year, month, day, weekday, time: `${parts.hour}:${parts.minute}` };
}

/** "novembre" as a heading: "Novembre". French and Italian write month names small inside a date. */
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const fillDate = (pattern: string, p: WallClock, t: any) =>
  pattern.replace("{weekday}", t.days_short[p.weekday]).replace("{day}", String(p.day)).replace("{month}", t.months_short[p.month - 1]).replace("{year}", String(p.year));

function eventLd(e: SiteEvent, site: any) {
  return {
    "@type": e.category === "comedy" ? "ComedyEvent" : "Event", name: e.title, ...(e.all_day ? { startDate: e.start.slice(0, 10) } : { startDate: e.start, endDate: e.end }),
    eventStatus: "https://schema.org/EventScheduled", eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    location: { "@type": "Place", name: site.legal_name, address: { "@type": "PostalAddress", streetAddress: site.street, postalCode: site.postal_code, addressLocality: site.city, addressCountry: site.country } },
    ...(e.organiser ? { organizer: { "@type": "Organization", name: e.organiser } } : {}),
    ...(e.ticket_url ? { offers: { "@type": "Offer", url: e.ticket_url, ...(e.price_chf === null ? {} : { price: e.price_chf, priceCurrency: "CHF" }), availability: "https://schema.org/InStock" } } : {}),
  };
}

export type Album = { slug: string; title: Record<string, string>; cover?: string };

/**
 * The gallery's sections. Moments arrive newest first; albums come out newest first by
 * their newest photo, each with its cover (a moment id, optional) in front, then the
 * photos that belong to no album. An album without photos is left out.
 */
export function groupGallery<M extends { id: string; album?: string }>(moments: M[], albums: Album[]) {
  for (const m of moments) if (m.album && !albums.some((a) => a.slug === m.album)) throw new Error(`moment ${m.id}: album "${m.album}" is not in data/albums.yml`);
  const sections = albums.map((a) => ({ ...a, moments: moments.filter((m) => m.album === a.slug) })).filter((a) => a.moments.length);
  sections.sort((a, b) => moments.indexOf(a.moments[0]!) - moments.indexOf(b.moments[0]!));
  for (const a of sections) {
    if (!a.cover) continue;
    const cover = a.moments.find((m) => m.id === a.cover);
    if (!cover) throw new Error(`album ${a.slug}: cover "${a.cover}" is not a moment of this album`);
    a.moments = [cover, ...a.moments.filter((m) => m !== cover)];
  }
  return { albums: sections, loose: moments.filter((m) => !m.album) };
}

/**
 * The output file a page's `permalink` names: plain lower case folders and a name
 * ending in .html, nothing else. A page text is content that anyone with the editor can
 * change, and it must never choose a file outside the built site ("../../x").
 */
export function pageFile(permalink: unknown, source = "a page"): string {
  const out = String(permalink).replace(/^\//, "");
  if (typeof permalink !== "string" || !/^[a-z0-9-]+(\/[a-z0-9-]+)*\.html$/.test(out)) throw new Error(`${source}: permalink must be a plain file name like /404.html`);
  return out;
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
      return { ...fm, date, id: p.slice(8, -3), photo: p.replace(/\.md$/, ".jpg") } as { id: string; date: string; photo: string; album?: string; feed?: boolean; caption?: Record<string, string>; alt?: Record<string, string> };
    })
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id < b.id ? -1 : 1));
  for (const m of moments) if (!opts.photos[m.photo]) throw new Error(`moment ${m.id}: photo ${m.photo} is missing`);
  const gallery = groupGallery(moments, data.albums?.albums ?? []);
  for (const p of data.home?.about_photos ?? []) if (!opts.photos[p.photo]) throw new Error(`home.yml about_photos: photo ${p.photo} is missing`);
  // The day order is the same sections as the night order, moved about: none added, none lost.
  if (data.home?.sections_day) {
    const same = (a: string[], b: string[]) => [...a].sort().join() === [...b].sort().join();
    if (!same(data.home.sections_day, data.home.sections ?? [])) throw new Error("home.yml: sections_day must name the same sections as sections");
  }

  let current = { depth: 0 };
  const engine = new Liquid({ templates, extname: "", strictFilters: true, strictVariables: false, outputEscape: "escape" });
  const url = (p: string) => resolveUrl(String(p), opts.base, current.depth);
  engine.registerFilter("url", url);
  engine.registerFilter("asset", (p: string) => url(p) + (opts.version && opts.base !== "relative" ? `?v=${opts.version}` : ""));
  // hreflang and canonical must be absolute; in a relative build there is no address, so the path is kept.
  const origin = (opts.origin ?? site.url).replace(/\/$/, "");
  engine.registerFilter("absolute", (p: string) => (opts.base === "relative" ? url(p) : origin + url(p)));
  // A photo the editor has not sent yet has no file on the site: its path is a blob: address, used as it is.
  const photoUrl = (path: string) => (/^(blob|data|https?):/.test(path) ? path : url("/" + path));
  engine.registerFilter("srcset", (vs: Variant[]) => (vs ?? []).map((v) => `${photoUrl(v.path)} ${v.w}w`).join(", "));
  engine.registerFilter("largest", (vs: Variant[]) => photoUrl(vs.at(-1)!.path));
  engine.registerFilter("json", (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c"));
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[c]!);
  // "Nothing to do in Zürich tonight? Now there is." -> what follows the first sentence becomes the neon sign.
  engine.registerFilter("neon_last", (s: string) => {
    const m = /[.?!] /.exec(String(s));
    return !m ? esc(String(s)) : `${esc(s.slice(0, m.index + 1))} <span class="neon-word">${esc(s.slice(m.index + 2))}</span>`;
  });
  engine.registerFilter("tel", (s: string) => "tel:" + String(s).replace(/[^+\d]/g, ""));

  // Events: the merged list arrives as data/events.json (written by the build, never committed).
  const now = opts.now ?? new Date();
  const allEvents: SiteEvent[] = data.events?.events ?? [];
  const ahead = upcoming(allEvents, now, 60);
  for (const e of ahead) if (e.image && !/^https?:/.test(e.image) && !opts.photos[e.image]) throw new Error(`event ${e.id}: photo ${e.image} is missing`);
  for (const s of data.menu?.sections ?? []) for (const d of s.drinks ?? []) if (d.photo && !opts.photos[d.photo]) throw new Error(`menu.yml: photo ${d.photo} of "${d.name}" is missing`);
  /** What the shows ahead cost, in words: "Tickets from CHF 5. Some shows are free." Empty when no event says. */
  const priceNote = (t: any) => {
    const prices = ahead.map((e) => e.price_chf).filter((p): p is number => typeof p === "number");
    const paid = prices.filter((p) => p > 0);
    return [paid.length ? t.price_from.replace("{price}", String(Math.min(...paid))) : "", prices.includes(0) ? t.price_some_free : ""].filter(Boolean).join(" ");
  };
  const eventView = (e: SiteEvent, lang: string, t: any) => {
    const p = wallClock(new Date(e.start), site.timezone);
    const price = e.price_chf === null ? "" : e.price_chf === 0 ? t.free_entry : `CHF ${e.price_chf}`;
    // Price, organiser (unless it is the event's own name) and language, whichever are known.
    const meta = [price, e.organiser && e.organiser !== e.name ? e.organiser : "", t.event_languages?.[e.language] ?? ""].filter(Boolean).join(" · ");
    return {
      meta_label: meta,
      ...e, when_label: e.all_day ? fillDate(t.date_event, p, t) : `${fillDate(t.date_event, p, t)}, ${p.time}`, text: e.text?.[lang] ?? e.text?.[defaultLang] ?? "", month_label: `${capital(t.months[p.month - 1])} ${p.year}`,
      price_label: e.price_chf === null ? "" : e.price_chf === 0 ? t.free_entry : `CHF ${e.price_chf}`,
      language_label: t.event_languages?.[e.language] ?? "", img: e.image ? squareOf(opts.photos[e.image]) : null,
    };
  };

  // For the style guide: what each template says about itself, and the contrast of every declared pair.
  const docs = Object.fromEntries(Object.entries(templates).map(([name, text]) => [name, /\{%-? comment %\}\s*([\s\S]*?)\s*\{% endcomment -?%\}/.exec(text)?.[1] ?? ""]));
  const parts = (kind: string) => Object.keys(templates).filter((n) => n.startsWith(kind + "/")).sort().map((n) => ({ path: n, name: n.slice(kind.length + 1), doc: docs[n] }));
  const ratio = (theme: any, fg: string, bg: string) => contrast(theme[fg], theme[bg]).toFixed(1);
  const contrastRows = (data.tokens?.contrast_pairs ?? []).map(([fg, bg]: [string, string]) => ({ fg, bg, night: ratio(data.tokens.color.night, fg, bg), day: ratio(data.tokens.color.day, fg, bg) }));

  const pages: Page[] = [];
  const sources = Object.entries(files).filter(([p]) => /^content\/[a-z]{2}\/.+\.md$/.test(p));
  for (const [path, text] of sources) {
    const [, lang, name] = /^content\/([a-z]{2})\/(.+)\.md$/.exec(path)!;
    const slug = name === "index" ? "" : name!;
    const dir = (lang === defaultLang ? "" : `${lang}/`) + (slug ? `${slug}/` : "");
    const { data: fm, body } = parseFrontMatter(text);
    // `permalink` names the output file itself (404.html must sit at the root for GitHub Pages).
    const out = fm.permalink ? pageFile(fm.permalink, path) : dir + "index.html";
    pages.push({ lang: lang!, slug, url: fm.permalink ? "/" + out : "/" + dir, out, depth: out.split("/").length - 1, data: fm, html: marked.parse(body, { async: false }) as string });
  }

  for (const page of pages.filter((p) => p.slug === "" && Array.isArray(p.data.guests))) {
    const keys = page.data.guests.map((g: any) => g.key);
    if (data.home?.guests_day && [...keys].sort().join() !== [...data.home.guests_day].sort().join()) throw new Error(`content/${page.lang}/index.md: guests must have the keys of home.yml guests_day`);
  }

  const out: Page[] = [];
  for (const page of pages) {
    current = { depth: page.depth };
    const t = data.i18n[page.lang];
    const alternates = pages.filter((p) => p.slug === page.slug).map((p) => ({ lang: p.lang, url: p.url }));
    // The language menu: this page in every language it exists in, each named in its own words.
    const langsMenu = langs.flatMap((l) => alternates.filter((a) => a.lang === l).map((a) => ({ lang: l, url: a.url, name: data.i18n[l].lang_name, current: l === page.lang })));
    // The link preview picture: the page's own `og_photo`, or the hero photo. Its alt text is the moment's.
    const ogKey: string | undefined = page.data.og_photo ?? data.home?.hero_photo;
    const ogMoment = moments.find((m) => m.photo === ogKey);
    const og = ogKey && opts.photos[ogKey]?.og ? { path: "/" + opts.photos[ogKey]!.og, ...OG_SIZE, alt: ogMoment?.alt?.[page.lang] ?? ogMoment?.alt?.[defaultLang] ?? site.legal_name } : null;
    const langUrl = (l: string, path: string) => (l === defaultLang ? "" : `/${l}`) + path;
    const views = ahead.map((e) => eventView(e, page.lang, t));
    const months: { label: string; events: typeof views }[] = [];
    for (const v of views) (months.at(-1)?.label === v.month_label ? months.at(-1)! : months[months.push({ label: v.month_label, events: [] }) - 1]!).events.push(v);
    const momentView = (m: (typeof moments)[number]) => ({ ...m, caption: m.caption?.[page.lang] ?? m.caption?.[defaultLang], alt: m.alt?.[page.lang] ?? m.alt?.[defaultLang], date_label: fillDate(t.date_short, wallClock(new Date(m.date + "T12:00:00Z"), "UTC"), t), img: opts.photos[m.photo] });
    const scope = {
      site, t, page: { ...page.data, lang: page.lang, url: page.url, slug: page.slug, content: page.html },
      home: data.home, tokens: data.tokens, hours: data.hours,
      hours_rows: hoursRows(data.hours, t),
      home_url: page.lang === defaultLang ? "/" : `/${page.lang}/`,
      alternates, langs_menu: langsMenu, default_lang: defaultLang, og,
      x_default: alternates.find((a) => a.lang === defaultLang)?.url,
      og_locales_other: alternates.filter((a) => a.lang !== page.lang).map((a) => data.i18n[a.lang].og_locale),
      // Every language at once, for the one page that speaks them all (404).
      all_langs: langs.map((l) => ({ lang: l, t: data.i18n[l], home_url: langUrl(l, "/"), events_url: langUrl(l, "/events/"), gallery_url: langUrl(l, "/gallery/") })),
      photos: opts.photos,
      // The hero photo is not repeated as the first card of the feed.
      // Nor is a moment marked `feed: false`, which lives in the gallery only.
      moments: moments.filter((m) => m.photo !== data.home?.hero_photo && m.feed !== false).map(momentView),
      // Every moment, hero included: albums as sections, then the photos with no album.
      gallery: {
        albums: gallery.albums.map((a) => ({ slug: a.slug, title: a.title[page.lang] ?? a.title[defaultLang], moments: a.moments.map(momentView) })),
        loose: gallery.loose.map(momentView),
      },
      gallery_url: page.lang === defaultLang ? "/gallery/" : `/${page.lang}/gallery/`,
      events_url: page.lang === defaultLang ? "/events/" : `/${page.lang}/events/`,
      events_next: views.slice(0, data.home?.events_count ?? 4),
      price_note: priceNote(t),
      events_months: months,
      // The drinks menu in the page language; a drink without a picture is a card with words only.
      menu: (data.menu?.sections ?? []).map((s: any) => ({
        slug: s.slug, title: s.title?.[page.lang] ?? s.title?.[defaultLang], note: s.note?.[page.lang] ?? s.note?.[defaultLang] ?? "",
        drinks: (s.drinks ?? []).map((d: any) => ({
          name: d.name, text: d.text?.[page.lang] ?? d.text?.[defaultLang] ?? "", price_label: typeof d.price_chf === "number" ? `CHF ${d.price_chf}` : "",
          img: d.photo ? squareOf(opts.photos[d.photo]) : null, alt: d.alt?.[page.lang] ?? d.alt?.[defaultLang] ?? "",
        })),
      })),
      events_json_ld: { "@context": "https://schema.org", "@graph": ahead.map((e) => eventLd(e, site)) },
      noindex: site.preview || page.data.noindex,
      guide: { components: parts("components"), sections: parts("sections"), layouts: parts("layouts"), contrast: contrastRows, sample: (() => { const h = pages.find((p) => p.lang === page.lang && p.slug === ""); return h ? { ...h.data, lang: h.lang, content: h.html } : null; })() },
      json_ld: jsonLd(site, data.hours, page.lang, site.url + page.url),
    };
    const html = await engine.renderFile(`layouts/${page.data.layout ?? "page"}`, scope);
    out.push({ ...page, html });
  }
  return out;
}

/**
 * sitemap.xml: every page a search engine may list, each with its language versions.
 * `abs` turns a site path ("/de/") into the full address the build is served from.
 */
export function sitemapXml(pages: Page[], defaultLang: string, abs: (path: string) => string): string {
  const x = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const listed = pages.filter((p) => !p.data.noindex).sort((a, b) => (a.url < b.url ? -1 : 1));
  const entries = listed.map((p) => {
    const versions = listed.filter((o) => o.slug === p.slug);
    const links = versions.map((o) => `    <xhtml:link rel="alternate" hreflang="${o.lang}" href="${x(abs(o.url))}"/>`);
    const main = versions.find((o) => o.lang === defaultLang);
    if (main) links.push(`    <xhtml:link rel="alternate" hreflang="x-default" href="${x(abs(main.url))}"/>`);
    return `  <url>\n    <loc>${x(abs(p.url))}</loc>\n${links.join("\n")}\n  </url>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${entries.join("\n")}\n</urlset>\n`;
}
