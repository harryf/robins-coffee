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

/** Text files keyed by path relative to site/, for example "content/en/index.md". */
export type Files = Record<string, string>;
export type Variant = { w: number; path: string };
export type Photo = { width: number; height: number; jpg: Variant[]; webp: Variant[] };
export type RenderOptions = {
  /** "/" on the domain, "/robins-coffee/" on GitHub Pages, or "relative" for file:// and the editor preview. */
  base: string;
  photos: Record<string, Photo>;
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
    return { label, open: r.open, close: r.close ?? null, closed: !!r.closed };
  });
}

function jsonLd(site: any, lang: string, pageUrl: string) {
  // No openingHoursSpecification yet: schema.org needs a closing time and the venue
  // only publishes "until late". No Review or AggregateRating, ever (self-serving).
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
    const fmtDate = new Intl.DateTimeFormat(page.lang === "de" ? "de-CH" : "en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
    const scope = {
      site, t, page: { ...page.data, lang: page.lang, url: page.url, slug: page.slug, content: page.html },
      home: data.home, tokens: data.tokens, hours: data.hours,
      hours_rows: hoursRows(data.hours, t),
      home_url: page.lang === defaultLang ? "/" : `/${page.lang}/`,
      alternates, other,
      photos: opts.photos,
      moments: moments.map((m: any) => ({ ...m, caption: m.caption?.[page.lang] ?? m.caption?.[defaultLang], alt: m.alt?.[page.lang] ?? m.alt?.[defaultLang], date_label: fmtDate.format(new Date(m.date + "T00:00:00Z")), img: opts.photos[m.photo] })),
      noindex: site.preview || page.data.noindex,
      json_ld: jsonLd(site, page.lang, site.url + page.url),
    };
    const html = await engine.renderFile(`layouts/${page.data.layout ?? "page"}`, scope);
    out.push({ ...page, html });
  }
  return out;
}
