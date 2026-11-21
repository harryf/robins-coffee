// The drinks menu: reading menu.yml, the season shown on a day, the order of the menu page,
// the drink pages, and the Studio's writers for seasons and drinks. Runs on the frozen copy.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { readMenu, currentSeason, seasonOrder, seasonState, amountWords, type Season } from "../src/menu";
import { saveDrink, removeDrink, saveSeason, removeSeason, drinkProblems, seasonProblems, type DrinkInput } from "../src/content";
import { renderSite, sitemapXml, type Files, type Photo } from "../src/render";
import { detailLines } from "../src/studio/detail";
import { FROZEN_SITE } from "./frozen";

const files: Files = {};
for (const p of new Bun.Glob("**/*.{md,yml,json,liquid}").scanSync({ cwd: FROZEN_SITE })) files[p] = await Bun.file(join(FROZEN_SITE, p)).text();
const photoPaths = [...new Bun.Glob("{moments,photos}/*.jpg").scanSync({ cwd: FROZEN_SITE })];
const photos: Record<string, Photo> = Object.fromEntries(photoPaths.map((p) => [p, { width: 400, height: 500, jpg: [{ w: 400, path: `photos/${p.split("/")[1]!.slice(0, -4)}-400.jpg` }], webp: [{ w: 400, path: "photos/x-400.webp" }] }]));
const MENU = files["data/menu.yml"]!;
const menu = readMenu(parseYaml(MENU));
const AT = new Date("2026-11-21T20:00:00+01:00");
const render = (f: Files = files, now = AT) => renderSite(f, { base: "/", photos, now, origin: "https://example.org" });
const page = async (out: string, f: Files = files, now = AT) => (await render(f, now)).find((p) => p.out === out)!.html;
const season = (slug: string, start: string, end: string, drinks: string[] = []): Season => ({ slug, name: { en: slug }, start, end, drinks, draft: [] });

describe("menu.yml: seasons and drinks", () => {
  test("the frozen menu reads as seasons that name drinks by slug, each drink with its texts, recipe and pictures", () => {
    expect(menu.seasons.length).toBeGreaterThan(0);
    for (const s of menu.seasons) for (const slug of s.drinks) expect(menu.drinks.some((d) => d.slug === slug)).toBe(true);
    for (const d of menu.drinks) {
      expect(d.slug).toMatch(/^[a-z0-9-]+$/);
      expect(typeof d.price_chf).toBe("number");
      expect(d.text.en).toBeTruthy();
      expect(Array.isArray(d.ingredients) && Array.isArray(d.method) && Array.isArray(d.pictures)).toBe(true);
      for (const p of d.pictures) { expect(photos[p.photo]).toBeDefined(); expect(p.alt.en).toBeTruthy(); }
    }
  });

  test("ANTI: a bad file stops the build with a sentence that names the entry", () => {
    const bad = (from: string, to: string) => () => readMenu(parseYaml(MENU.replace(from, to)));
    expect(bad("drinks: [ pineapple-express", "drinks: [ nope")).toThrow('menu.yml: season autumn-winter-2026: drinks: "nope" is not the slug of a drink in drinks:');
    expect(bad('end: "2027-02-28"', 'end: "2026-01-01"')).toThrow("menu.yml: season autumn-winter-2026: end comes before start");
    expect(bad('start: "2026-09-01"', 'start: "September"')).toThrow("start must be a day like 2026-09-01");
    expect(bad("price_chf: 18", "price_chf: lots")).toThrow("menu.yml: drink pineapple-express: price_chf must be a number");
    expect(bad("ingredients: []", "ingredients: [{ amount: 4, unit: pint, item: { en: rum } }]")).toThrow("unit must be one of cl, ml, g, dash, drop, barspoon, piece or left out");
    expect(bad("ingredients: []", "ingredients: [{ unit: cl, item: { en: rum } }]")).toThrow("a unit needs an amount");
    expect(bad("draft: [ experience ]", "draft: [ name ]")).toThrow('"name" is not a text that can be a draft');
    expect(() => readMenu({ sections: [] })).toThrow("`sections:` is the old shape");
    expect(() => readMenu(parseYaml(MENU.replace("- slug: lazy-monkey", "- slug: pineapple-express")))).toThrow("two drinks have this slug");
    expect(readMenu(null)).toEqual({ seasons: [], drinks: [] });
  });

  test("the season shown on a day: the running one; between seasons the one that ended last; before the first, the first to come", () => {
    const past = season("summer-2026", "2026-06-01", "2026-08-31"), now = season("autumn-2026", "2026-09-01", "2026-11-30"), next = season("winter-2026", "2026-12-01", "2027-02-28");
    expect(currentSeason([past, now, next], "2026-11-21")).toBe(now);
    expect(currentSeason([past, next], "2026-11-21")).toBe(past);
    expect(currentSeason([next], "2026-11-21")).toBe(next);
    expect(currentSeason([], "2026-11-21")).toBeNull();
    // Overlap: the one that started last.
    expect(currentSeason([now, season("christmas", "2026-11-15", "2026-12-31")], "2026-11-21")!.slug).toBe("christmas");
    // First and last day both count.
    expect(seasonState(now, "2026-09-01")).toBe("now");
    expect(seasonState(now, "2026-11-30")).toBe("now");
    expect(seasonState(now, "2026-12-01")).toBe("past");
    expect(seasonOrder([past, now, next, season("spring-2027", "2027-03-01", "2027-05-31")], "2026-11-21").map((s) => s.slug)).toEqual(["autumn-2026", "winter-2026", "spring-2027", "summer-2026"]);
  });

  test("amounts use the page's decimal sign and lose trailing zeros", () => {
    expect(amountWords(1.5, ",")).toBe("1,5");
    expect(amountWords(4, ".")).toBe("4");
    expect(amountWords(0.75, ".")).toBe("0.75");
  });
});

describe("the menu on the site", () => {
  test("the home page shows the season of today with every drink linked to its own page; a drink picture is the whole drawing, not a square cut", async () => {
    const html = await page("index.html");
    const shown = currentSeason(menu.seasons, "2026-11-21")!;
    expect(html).toContain(shown.name.en);
    for (const slug of shown.drinks) expect(html).toContain(`href="/menu/${slug}/"`);
    expect(html).toContain('href="/menu/"');
    expect(html).not.toMatch(/drink__art[\s\S]{0,400}-sq\d/);
  });

  test("between seasons the home page shows the season that ended last, never an empty menu", async () => {
    const after = new Date("2028-06-01T12:00:00Z");
    const html = await page("index.html", files, after);
    expect(html).toContain('id="menu"');
    expect(html).toContain(menu.seasons.at(-1)!.name.en);
  });

  test("the menu page exists in four languages, lists the season of today first, and every other season with its days and words", async () => {
    const two = { ...files, "data/menu.yml": MENU.replace("drinks:\n  - slug: pineapple-express", '  - slug: summer-2026\n    name: { en: "Summer 2026", de: "Sommer 2026" }\n    start: "2026-06-01"\n    end: "2026-08-31"\n    description: { en: "Long light evenings." }\n    drinks: [ lazy-monkey ]\ndrinks:\n  - slug: pineapple-express') };
    const pages = await render(two);
    for (const out of ["menu/index.html", "de/menu/index.html", "fr/menu/index.html", "it/menu/index.html"]) expect(pages.map((p) => p.out)).toContain(out);
    const en = pages.find((p) => p.out === "menu/index.html")!.html;
    expect(en.indexOf("Autumn/Winter 2026")).toBeLessThan(en.indexOf("Summer 2026"));
    expect(en).toContain("<p class=\"season__dates\">June to August</p>");
    expect(en).toContain("Long light evenings.");
    expect(en).toContain('id="summer-2026"');
    const de = pages.find((p) => p.out === "de/menu/index.html")!.html;
    expect(de).toContain("Sommer 2026");
    expect(de).toContain("War auf der Karte");
  });

  test("every drink has its own page in four languages: name, season, price, the parts that exist, the drawing whole, a link back", async () => {
    const pages = await render();
    for (const d of menu.drinks) for (const lang of ["", "de/", "fr/", "it/"]) expect(pages.map((p) => p.out)).toContain(`${lang}menu/${d.slug}/index.html`);
    const d = menu.drinks[0]!;
    const html = pages.find((p) => p.out === `menu/${d.slug}/index.html`)!.html;
    expect(html).toContain(`<h1 class="menu-card__name">${d.name}</h1>`);
    expect(html).toContain(`CHF ${d.price_chf}`);
    expect(html).toContain('href="/menu/"');
    expect(html).toContain('<link rel="alternate" hreflang="de" href="https://example.org/de/menu/' + d.slug + '/">');
    expect(html).toContain(`<meta property="og:title" content="${d.name}, a cocktail at`);
    // No ingredients typed: no ingredient list, no method, and no Recipe data.
    expect(html).not.toContain('class="recipe"');
    expect(html).not.toContain('class="method"');
    expect(html).not.toContain('"@type":"Recipe"');
    // Drafted texts are shown on the site without any mark.
    expect(html).not.toMatch(/draft/i);
  });

  test("with ingredients and steps the page lists them with measures in the page language, and carries Recipe data", async () => {
    const recipe = MENU.replace("ingredients: []\n    method: []", 'ingredients:\n      - { amount: 4.5, unit: cl, item: { en: "Rum", de: "Rum" } }\n      - { amount: 2, unit: dash, item: { en: "Bitters" } }\n      - { item: { en: "Orange peel" } }\n    method:\n      - { en: "Shake with ice.", de: "Auf Eis schütteln." }');
    const f = { ...files, "data/menu.yml": recipe };
    const d = menu.drinks[0]!;
    const en = await page(`menu/${d.slug}/index.html`, f);
    expect(en).toContain('<span class="recipe__amount">4.5 cl</span> <span class="recipe__item">Rum</span>');
    expect(en).toContain('<span class="recipe__amount">2 dashes</span>');
    expect(en).toContain('<span class="recipe__amount"></span> <span class="recipe__item">Orange peel</span>');
    expect(en).toContain("<li>Shake with ice.</li>");
    const ld = JSON.parse(/<script type="application\/ld\+json">(\{"@context":"https:\/\/schema.org","@type":"Recipe"[\s\S]*?)<\/script>/.exec(en)![1]!);
    expect(ld).toMatchObject({ name: d.name, recipeCategory: "Cocktail", recipeIngredient: ["4.5 cl Rum", "2 dashes Bitters", "Orange peel"], recipeInstructions: [{ "@type": "HowToStep", text: "Shake with ice." }] });
    expect(ld.image[0]).toMatch(/^https:\/\/example\.org\/photos\//);
    const fr = await page(`fr/menu/${d.slug}/index.html`, f);
    expect(fr).toContain('<span class="recipe__amount">4,5 cl</span>');
    expect(fr).toContain('<span class="recipe__amount">2 traits</span>');
  });

  test("more pictures of a drink are photos that open in the gallery lightbox", async () => {
    const more = MENU.replace('alt: { en: "Drawing of an amber drink', 'alt: { en: "Two glasses on the bar." }\n      - photo: "photos/menu-pineapple-express.jpg"\n        alt: { en: "Drawing of an amber drink');
    const html = await page(`menu/${menu.drinks[0]!.slug}/index.html`, { ...files, "data/menu.yml": more });
    expect(html).toContain("data-lightbox-group");
    expect(html).toContain('<span class="moment__caption">Drawing of an amber drink');
  });

  test("ANTI: a missing drink picture stops the build", async () => {
    const broken = { ...files, "data/menu.yml": MENU.replace("photos/menu-lazy-monkey.jpg", "photos/nope.jpg") };
    expect(render(broken)).rejects.toThrow(/photo photos\/nope.jpg of "Lazy Monkey" is missing/);
  });

  test("the sitemap lists the menu page and every drink page with their languages", async () => {
    const xml = sitemapXml(await render(), "en", (p) => "https://example.org" + p);
    expect(xml).toContain("<loc>https://example.org/menu/</loc>");
    for (const d of menu.drinks) expect(xml).toContain(`<loc>https://example.org/de/menu/${d.slug}/</loc>`);
  });
});

describe("the Studio's menu writers", () => {
  const drink: DrinkInput = { name: "Hot Toddy", price_chf: 14, text: { en: "Whisky, honey and lemon" }, experience: { en: "Warm." }, ingredients: [{ amount: 4, unit: "cl", item: { en: "Whisky" } }], method: [{ en: "Stir." }], pictures: [] };
  const read = (text: string) => readMenu(parseYaml(text));
  const first = menu.seasons[0]!.slug;

  test("a new drink gets a slug from its name, joins the seasons ticked, and the file keeps its notes", () => {
    const { text, slug } = saveDrink(MENU, drink, { seasons: [first] });
    expect(slug).toBe("hot-toddy");
    expect(text.startsWith("# The drinks menu")).toBe(true);
    const now = read(text);
    expect(now.drinks.at(-1)).toMatchObject({ slug, name: "Hot Toddy", ingredients: [{ amount: 4, unit: "cl", item: { en: "Whisky" } }], method: [{ en: "Stir." }] });
    expect(now.seasons[0]!.drinks.at(-1)).toBe(slug);
    expect(() => saveDrink(text, drink, { seasons: [] })).toThrow("drink_exists");
  });

  test("a changed drink keeps its slug and place under a new name, moves between seasons, and loses its draft mark", () => {
    const d = menu.drinks[1]!;
    const before = read(MENU);
    expect(before.drinks[1]!.draft).toContain("experience");
    const { text, slug } = saveDrink(MENU, { ...drink, name: "Sleepy Monkey", pictures: d.pictures }, { was: d.slug, seasons: [] });
    expect(slug).toBe(d.slug);
    const now = read(text);
    expect(now.drinks[1]).toMatchObject({ slug: d.slug, name: "Sleepy Monkey", draft: [] });
    expect(now.seasons[0]!.drinks).not.toContain(d.slug);
    expect(now.drinks.map((x) => x.slug)).toEqual(before.drinks.map((x) => x.slug));
    const back = read(saveDrink(text, { ...drink, name: "Sleepy Monkey" }, { was: d.slug, seasons: [first] }).text);
    expect(back.seasons[0]!.drinks.at(-1)).toBe(d.slug);
  });

  test("removing a drink takes it out of every season", () => {
    const d = menu.drinks[0]!;
    const now = read(removeDrink(MENU, d.slug));
    expect(now.drinks.some((x) => x.slug === d.slug)).toBe(false);
    for (const s of now.seasons) expect(s.drinks).not.toContain(d.slug);
    expect(() => removeDrink(MENU, "nope")).toThrow("drink_not_found");
  });

  test("ANTI: a drink with a wrong recipe row, a picture without alt text or an unknown season is refused", () => {
    expect(drinkProblems({ ...drink, ingredients: [{ amount: 4, unit: "pint", item: { en: "Ale" } }] })).toEqual(["ingredient_unit_wrong"]);
    expect(drinkProblems({ ...drink, ingredients: [{ amount: -1, item: { en: "Ice" } }] })).toEqual(["ingredient_amount_wrong"]);
    expect(drinkProblems({ ...drink, ingredients: [{ unit: "cl", item: { en: "Rum" } }] })).toEqual(["ingredient_amount_wrong"]);
    expect(drinkProblems({ ...drink, ingredients: [{ amount: 2, item: { en: "" } }] })).toEqual(["ingredient_item_missing"]);
    expect(drinkProblems({ ...drink, pictures: [{ photo: "photos/menu-x.jpg", alt: { en: "" } }] })).toEqual(["alt_missing"]);
    expect(drinkProblems({ ...drink, pictures: [{ photo: "../x.jpg", alt: { en: "A" } }] })).toEqual(["event_image_wrong"]);
    expect(drinkProblems({ ...drink, text: { en: "", de: "Nur Deutsch" } })).toEqual(["english_needed"]);
    expect(drinkProblems({ ...drink, experience: { en: "", de: "Warm" } })).toEqual(["english_needed"]);
    expect(drinkProblems({ ...drink, experience: { en: "" } })).toEqual([]);
    expect(() => saveDrink(MENU, drink, { seasons: ["nope"] })).toThrow("season_unknown");
  });

  test("a season is added with its days and words, changed without losing its drinks, and only an empty one can go", () => {
    const made = saveSeason(MENU, { name: { en: "Summer 2027", de: "Sommer 2027" }, start: "2027-06-01", end: "2027-08-31", description: { en: "Spritz weather." } });
    expect(made.slug).toBe("summer-2027");
    expect(read(made.text).seasons.at(-1)).toMatchObject({ slug: "summer-2027", start: "2027-06-01", end: "2027-08-31", drinks: [], description: { en: "Spritz weather." } });
    const s = menu.seasons[0]!;
    const changed = read(saveSeason(MENU, { name: { en: "Cold Months" }, start: s.start, end: "2027-03-15", description: s.description }, s.slug).text).seasons[0]!;
    expect(changed).toMatchObject({ slug: s.slug, end: "2027-03-15", drinks: s.drinks, draft: [] });
    expect(() => removeSeason(MENU, s.slug)).toThrow("season_not_empty");
    expect(read(removeSeason(made.text, "summer-2027")).seasons.map((x) => x.slug)).toEqual(menu.seasons.map((x) => x.slug));
    expect(seasonProblems({ name: { en: "" }, start: "2027-06-01", end: "2027-05-01" })).toEqual(["season_name_missing", "season_dates_order"]);
    expect(seasonProblems({ name: { en: "X" }, start: "June", end: "" })).toEqual(["season_date_wrong"]);
  });

  test("the commit lines name the seasons and drinks that came, changed and went", () => {
    const added = saveDrink(MENU, drink, { seasons: [first] }).text;
    const lines = detailLines([{ path: "site/data/menu.yml", status: "modified", before: MENU, after: added }]);
    expect(lines).toContain(`Season updated: "${menu.seasons[0]!.name.en}", ${menu.seasons[0]!.start} to ${menu.seasons[0]!.end}`);
    expect(lines).toContain('Drink added: "Hot Toddy", CHF 14');
    expect(detailLines([{ path: "site/data/menu.yml", status: "modified", before: added, after: MENU }])).toContain('Drink removed: "Hot Toddy"');
  });
});
