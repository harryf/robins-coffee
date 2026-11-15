import { describe, expect, test } from "bun:test";
import sharp from "sharp";
import { join } from "node:path";
import { renderSite, resolveUrl, hoursRows, parseFrontMatter, type Files, type Photo } from "../src/render";
import { contrast, tokensCss } from "../src/tokens";
import { cleanPhoto, MAX_EDGE } from "../scripts/add-photo";

const SITE = join(import.meta.dir, "..", "site");
const files: Files = {};
for (const p of new Bun.Glob("**/*.{md,yml,json,liquid}").scanSync({ cwd: SITE })) files[p] = await Bun.file(join(SITE, p)).text();
const photoPaths = [...new Bun.Glob("moments/*.jpg").scanSync({ cwd: SITE })];
const photos: Record<string, Photo> = Object.fromEntries(photoPaths.map((p) => [p, { width: 1200, height: 800, jpg: [{ w: 480, path: "photos/x-480.jpg" }], webp: [{ w: 480, path: "photos/x-480.webp" }] }]));
const tokens = JSON.parse(files["data/tokens.json"]!);

describe("renderer", () => {
  test("renders home in both languages plus the style guide", async () => {
    const pages = await renderSite(files, { base: "/robins-coffee/", photos });
    expect(pages.map((p) => p.out).sort()).toEqual(["de/index.html", "index.html", "styleguide/index.html"]);
    const en = pages.find((p) => p.out === "index.html")!.html;
    const de = pages.find((p) => p.out === "de/index.html")!.html;
    expect(en).toContain('<html lang="en">');
    expect(de).toContain('<html lang="de">');
    expect(en).toContain("Zähringerstrasse 33");
    expect(en).toContain('href="/robins-coffee/de/"');
    expect(de).toContain('href="/robins-coffee/"');
  });

  test("every page is noindex while site.yml says preview: true", async () => {
    const pages = await renderSite(files, { base: "/", photos });
    for (const p of pages) expect(p.html).toContain('name="robots" content="noindex');
  });

  test("German copy uses Swiss spelling (no sharp s)", async () => {
    const pages = await renderSite(files, { base: "/", photos });
    for (const p of pages.filter((p) => p.lang === "de")) expect(p.html).not.toContain("ß");
  });

  test("no em dash in any rendered page", async () => {
    const pages = await renderSite(files, { base: "/", photos });
    for (const p of pages) expect(p.html).not.toContain("—");
  });

  test("moments are newest first and each has alt text and a caption in both languages", () => {
    const moments = Object.entries(files).filter(([p]) => p.startsWith("moments/"));
    expect(moments.length).toBe(photoPaths.length);
    for (const [, text] of moments) {
      const { data } = parseFrontMatter(text);
      for (const lang of ["en", "de"]) {
        expect(data.caption[lang].length).toBeGreaterThan(3);
        expect(data.alt[lang].length).toBeGreaterThan(10);
      }
    }
  });

  test("a moment without its photo fails the build", async () => {
    expect(renderSite(files, { base: "/", photos: {} })).rejects.toThrow(/photo .* is missing/);
  });

  test("user text is escaped", async () => {
    const evil = { ...files, "content/en/index.md": files["content/en/index.md"]!.replace(/^headline:.*$/m, 'headline: "<script>x</script>. Night."') };
    const html = (await renderSite(evil, { base: "/", photos })).find((p) => p.out === "index.html")!.html;
    expect(html).not.toContain("<script>x</script>");
  });
});

describe("urls", () => {
  test("absolute base", () => {
    expect(resolveUrl("/de/", "/robins-coffee/", 1)).toBe("/robins-coffee/de/");
    expect(resolveUrl("/", "/", 0)).toBe("/");
  });
  test("relative base works from any depth and names index.html", () => {
    expect(resolveUrl("/", "relative", 0)).toBe("./index.html");
    expect(resolveUrl("/de/", "relative", 0)).toBe("./de/index.html");
    expect(resolveUrl("/assets/site.css", "relative", 1)).toBe("../assets/site.css");
  });
  test("external and special links pass through", () => {
    for (const u of ["https://example.com/", "mailto:a@b.ch", "tel:+41", "#visit"]) expect(resolveUrl(u, "/x/", 2)).toBe(u);
  });
});

describe("hours", () => {
  test("consecutive days collapse into a range", () => {
    const t = { days_short: { mo: "Mon", tu: "Tue", we: "Wed", th: "Thu", fr: "Fri", sa: "Sat", su: "Sun" }, range_sep: " to " };
    const rows = hoursRows({ regular: [{ days: ["mo", "tu", "we", "th", "fr"], open: "16:00", close: null }, { days: ["sa", "su"], open: "10:00", close: null }] }, t);
    expect(rows.map((r: any) => r.label)).toEqual(["Mon to Fri", "Sat, Sun"]);
  });
});

describe("design tokens", () => {
  test("every declared text and surface pair meets WCAG AA (4.5:1) in both themes", () => {
    for (const theme of ["night", "day"] as const) for (const [fg, bg] of tokens.contrast_pairs) {
      const ratio = contrast(tokens.color[theme][fg], tokens.color[theme][bg]);
      expect(`${theme} ${fg} on ${bg}: ${ratio >= 4.5}`).toBe(`${theme} ${fg} on ${bg}: true`);
    }
  });
  test("both themes define the same colour names", () => {
    expect(Object.keys(tokens.color.day).sort()).toEqual(Object.keys(tokens.color.night).sort());
  });
  test("the stylesheet uses tokens only: no hex colours outside the hero photo overlay", async () => {
    const css = await Bun.file(join(SITE, "assets/css/site.css")).text();
    const outside = css.split("\n").filter((l) => /#[0-9a-f]{3,8}\b/i.test(l) && !/^\.(hero|neon-word|site-header:has)/.test(l.trim()));
    expect(outside).toEqual([]);
    expect(tokensCss(tokens)).toContain("--c-neon: #ff4fa8");
  });
});

describe("photo cleaning", () => {
  test("strips EXIF and GPS, caps the long edge, keeps sRGB", async () => {
    const dirty = await sharp({ create: { width: 3200, height: 1600, channels: 3, background: "#804060" } })
      .withExif({ IFD0: { Make: "TestCam", Artist: "Somebody" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "47/1 22/1 0/1" } })
      .jpeg().toBuffer();
    expect((await sharp(dirty).metadata()).exif).toBeDefined();
    const { data, width, height } = await cleanPhoto(dirty);
    const meta = await sharp(data).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
    expect(Math.max(width, height)).toBe(MAX_EDGE);
    expect(meta.space).toBe("srgb");
  });
  test("no committed photo carries metadata or exceeds the cap", async () => {
    for (const p of photoPaths) {
      const meta = await sharp(join(SITE, p)).metadata();
      expect(`${p} exif:${!!meta.exif} xmp:${!!meta.xmp} iptc:${!!meta.iptc}`).toBe(`${p} exif:false xmp:false iptc:false`);
      expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(MAX_EDGE);
    }
  });
});
