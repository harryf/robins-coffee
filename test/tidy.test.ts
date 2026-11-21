import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, cpSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { parse as parseYaml } from "yaml";
import { renameAlbum } from "../src/content";
import { contentApi } from "../src/studio/content-api";
import { inEditScope } from "../src/scope";
import { STRINGS } from "../src/studio/strings";
import { fakeTranslator } from "./fake-translate";

import { FROZEN_SITE, LIVE_SITE } from "./frozen";
const SITE = FROZEN_SITE;

function studio() {
  const root = mkdtempSync(join(tmpdir(), "studio-tidy-"));
  for (const d of ["data", "events", "photos", "moments", "content/en"]) mkdirSync(join(root, "site", d), { recursive: true });
  for (const f of ["albums.yml", "menu.yml", "focus.yml", "home.yml", "site.yml"]) cpSync(join(SITE, "data", f), join(root, "site", "data", f));
  for (const f of ["menu-lazy-monkey.jpg", "menu-toffee-crush.jpg", "event-beer-pong.jpg", "latte-art-pour.jpg"]) cpSync(join(SITE, "photos", f), join(root, "site", "photos", f));
  cpSync(join(SITE, "events", "beer-pong.md"), join(root, "site", "events", "beer-pong.md"));
  const written: string[] = [];
  const api = contentApi({
    root,
    write: async (path, data) => { written.push(path); mkdirSync(join(root, path, ".."), { recursive: true }); await Bun.write(join(root, path), data); },
    changed: () => undefined,
    readKey: async () => null,
    look: async () => ({ labels: [], text: [], faces: [] }),
    translate: fakeTranslator(),
  });
  const call = async (route: string, body: any = {}) => { const res = await api(route, async () => body); return res ? { status: res.status, data: await res.json() } : null; };
  const has = (p: string) => existsSync(join(root, "site", p));
  const picture = async () => ({ base64: (await sharp({ create: { width: 60, height: 60, channels: 3, background: "#402010" } }).jpeg().toBuffer()).toString("base64"), focus: [0.5, 0.5] });
  return { root, call, has, picture, written, read: (p: string) => readFileSync(join(root, "site", p), "utf8") };
}

describe("studio: an album can be renamed", () => {
  test("the name changes in every language given, the short name and the file's comments stay", async () => {
    const before = await Bun.file(join(SITE, "data", "albums.yml")).text();
    const after = renameAlbum(before, "drinks", { en: "Drinks & Cocktails", de: "Drinks und Cocktails, groß" });
    expect(after.startsWith("# Gallery albums.")).toBe(true);
    const was = parseYaml(before).albums, now = parseYaml(after).albums;
    expect(now.map((a: any) => a.slug)).toEqual(was.map((a: any) => a.slug));
    expect(now.find((a: any) => a.slug === "drinks").title).toEqual({ en: "Drinks & Cocktails", de: "Drinks und Cocktails, gross" });
    expect(now.filter((a: any) => a.slug !== "drinks")).toEqual(was.filter((a: any) => a.slug !== "drinks"));
    expect(() => renameAlbum(before, "nope", { en: "A", de: "B" })).toThrow("album_unknown");
    expect(() => renameAlbum(before, "drinks", { en: " ", de: "A" })).toThrow("english_needed");
    expect(() => renameAlbum(before, "drinks", { en: 1, de: 2 } as any)).toThrow("english_needed");
    expect(parseYaml(renameAlbum(before, "drinks", { en: "Only English" })).albums.find((a: any) => a.slug === "drinks").title).toEqual({ en: "Only English" });
  });
  test("through the route, and its words exist", async () => {
    const s = studio();
    expect((await s.call("PUT album", { slug: "drinks", title: { en: "Cocktails", de: "Cocktails" } }))!.status).toBe(200);
    expect(parseYaml(s.read("data/albums.yml")).albums.find((a: any) => a.slug === "drinks").title.en).toBe("Cocktails");
    expect((await s.call("PUT album", { slug: "../x", title: { en: "A", de: "B" } }))!.data.error).toBe("album_unknown");
    for (const key of ["album_rename", "album_rename_title", "album_renamed"] as const) expect(STRINGS[key]).toBeTruthy();
  });
});

describe("studio: a picture nothing uses any more is deleted", () => {
  const drinkOf = (s: ReturnType<typeof studio>, slug: string) => parseYaml(s.read("data/menu.yml")).drinks.find((d: any) => d.slug === slug);
  const seasonsOf = (s: ReturnType<typeof studio>, slug: string) => parseYaml(s.read("data/menu.yml")).seasons.filter((x: any) => x.drinks.includes(slug)).map((x: any) => x.slug);
  test("a drink's old picture goes when a new one replaces it, and its focus line with it", async () => {
    const s = studio();
    writeFileSync(join(s.root, "site", "data", "focus.yml"), s.read("data/focus.yml") + '"photos/menu-lazy-monkey.jpg": [0.4, 0.6]\n');
    const drink = drinkOf(s, "lazy-monkey");
    const res = (await s.call("POST drink", { was: "lazy-monkey", drink, pictures: [{ picture: await s.picture(), alt: drink.pictures[0].alt }], seasons: seasonsOf(s, "lazy-monkey") }))!;
    expect(res.status).toBe(200);
    const photo = res.data.photos[0];
    expect(photo).not.toBe("photos/menu-lazy-monkey.jpg");
    expect(s.has(photo)).toBe(true);
    expect(s.has("photos/menu-lazy-monkey.jpg")).toBe(false);
    expect(parseYaml(s.read("data/focus.yml"))["photos/menu-lazy-monkey.jpg"]).toBeUndefined();
    expect(parseYaml(s.read("data/focus.yml"))[photo]).toEqual([0.5, 0.5]);
    for (const p of s.written) expect([p, inEditScope(p)]).toEqual([p, true]);
  });
  test("removing a drink removes its picture; an edit that keeps the picture keeps it", async () => {
    const s = studio();
    const drink = drinkOf(s, "toffee-crush");
    expect((await s.call("POST drink", { was: "toffee-crush", drink: { ...drink, price_chf: 19 }, pictures: drink.pictures, seasons: seasonsOf(s, "toffee-crush") }))!.status).toBe(200);
    expect(s.has("photos/menu-toffee-crush.jpg")).toBe(true);
    expect((await s.call("DELETE drink", { slug: "toffee-crush" }))!.status).toBe(200);
    expect(s.has("photos/menu-toffee-crush.jpg")).toBe(false);
  });
  test("ANTI: a picture that something else still names stays, and so does any picture the Studio did not make", async () => {
    const s = studio();
    // A second drink uses the same picture.
    const lazy = drinkOf(s, "lazy-monkey");
    expect((await s.call("POST drink", { drink: { ...lazy, name: "Lazy Monkey Twin" }, pictures: lazy.pictures, seasons: [] }))!.status).toBe(200);
    expect((await s.call("DELETE drink", { slug: "lazy-monkey" }))!.status).toBe(200);
    expect(s.has("photos/menu-lazy-monkey.jpg")).toBe(true);
    // A page photo put there by hand, given to a drink and taken away again: it is not the Studio's to delete.
    const made = (await s.call("POST drink", { drink: { name: "House Latte", text: { en: "Milk", de: "Milch" }, price_chf: 6 }, pictures: [{ photo: "photos/latte-art-pour.jpg", alt: { en: "A", de: "B" } }], seasons: [] }))!;
    expect(made.status).toBe(200);
    writeFileSync(join(s.root, "site", "data", "home.yml"), "sections: [hero]\n");
    expect((await s.call("DELETE drink", { slug: made.data.slug }))!.status).toBe(200);
    expect(s.has("photos/latte-art-pour.jpg")).toBe(true);
  });
  test("an event's picture goes with the event, and when an edit puts a new one in its place", async () => {
    const s = studio();
    const edited = (await s.call("PUT event", { path: "site/events/beer-pong.md", event: { title: "Beer Pong at ROBIN's", name: "Beer Pong", every: "we", category: "other" }, picture: await s.picture() }))!;
    expect(edited.status).toBe(200);
    expect(edited.data.image).not.toBe("photos/event-beer-pong.jpg");
    expect(s.has("photos/event-beer-pong.jpg")).toBe(false);
    expect(s.has(edited.data.image)).toBe(true);
    expect((await s.call("DELETE event", { path: edited.data.path }))!.status).toBe(200);
    expect(s.has(edited.data.image)).toBe(false);
    expect(existsSync(join(s.root, edited.data.path))).toBe(false);
  });
});

import { readConfig, saveFolder } from "../src/studio/config";
import { infoPlist } from "../scripts/build-app";

describe("studio: installing it on another Mac", () => {
  const ROOT = join(import.meta.dir, "..");
  const LINE = "curl -fsSL https://raw.githubusercontent.com/harryf/robins-coffee/main/scripts/install-studio.sh | bash";
  test("the install page shows, in both languages, exactly the line the script documents, and is kept out of search", async () => {
    const script = await Bun.file(join(ROOT, "scripts", "install-studio.sh")).text();
    expect(script).toContain(`#   ${LINE}`);
    for (const lang of ["en", "de"]) {
      const page = await Bun.file(join(LIVE_SITE, "content", lang, "studio.md")).text();
      expect(page).toContain("\n```\n" + LINE + "\n```\n");
      expect(page).toContain("noindex: true");
      expect(page).toContain("https://github.com/harryf/robins-coffee/blob/main/scripts/install-studio.sh");
      expect(page).not.toContain("ß");
    }
  });
  test("the script is valid shell, stops at the first error, asks for no password and reaches only its own places", async () => {
    const script = await Bun.file(join(ROOT, "scripts", "install-studio.sh")).text();
    expect(Bun.spawnSync(["bash", "-n", join(ROOT, "scripts", "install-studio.sh")]).exitCode).toBe(0);
    expect(script).toContain("set -euo pipefail");
    expect(script).not.toMatch(/\bsudo\b/);
    const hosts = [...script.matchAll(/https:\/\/([a-z0-9.-]+)/g)].map((m) => m[1]);
    expect([...new Set(hosts)].sort()).toEqual(["bun.sh", "github.com", "harryf.github.io", "raw.githubusercontent.com"]);
    expect(script).not.toMatch(/rm -rf/);
  });
  test("the place of the app is remembered beside the folder, and choosing another folder keeps it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "studio-install-"));
    const file = join(dir, "config.json");
    writeFileSync(file, JSON.stringify({ folder: "/old", app: "/Users/x/Applications/ROBINs Studio.app", other: 1 }));
    expect(await readConfig(file)).toEqual({ folder: "/old", app: "/Users/x/Applications/ROBINs Studio.app" });
    await saveFolder(ROOT, file);
    expect(await readConfig(file)).toEqual({ folder: ROOT, app: "/Users/x/Applications/ROBINs Studio.app" });
  });
  test("the app names its icon", () => {
    expect(infoPlist("/x", "0.9.3", "#150a17")).toContain("<key>CFBundleIconFile</key>\n  <string>AppIcon</string>");
  });
});
