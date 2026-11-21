import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, cpSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { parse as parseYaml } from "yaml";
import { renameAlbum } from "../src/content";
import { contentApi } from "../src/studio/content-api";
import { inEditScope } from "../src/editor/scope";
import { STRINGS } from "../src/studio/strings";

import { FROZEN_SITE, LIVE_SITE } from "./frozen";
const SITE = FROZEN_SITE;

function studio() {
  const root = mkdtempSync(join(tmpdir(), "studio-tidy-"));
  for (const d of ["data", "events", "photos", "moments", "content/en"]) mkdirSync(join(root, "site", d), { recursive: true });
  for (const f of ["albums.yml", "menu.yml", "focus.yml", "home.yml"]) cpSync(join(SITE, "data", f), join(root, "site", "data", f));
  for (const f of ["menu-lazy-monkey.jpg", "menu-toffee-crush.jpg", "event-beer-pong.jpg", "latte-art-pour.jpg"]) cpSync(join(SITE, "photos", f), join(root, "site", "photos", f));
  cpSync(join(SITE, "events", "beer-pong.md"), join(root, "site", "events", "beer-pong.md"));
  const written: string[] = [];
  const api = contentApi({
    root,
    write: async (path, data) => { written.push(path); mkdirSync(join(root, path, ".."), { recursive: true }); await Bun.write(join(root, path), data); },
    changed: () => undefined,
    readKey: async () => null,
    look: async () => ({ labels: [], text: [], faces: [] }),
  });
  const call = async (route: string, body: any = {}) => { const res = await api(route, async () => body); return res ? { status: res.status, data: await res.json() } : null; };
  const has = (p: string) => existsSync(join(root, "site", p));
  const picture = async () => ({ base64: (await sharp({ create: { width: 60, height: 60, channels: 3, background: "#402010" } }).jpeg().toBuffer()).toString("base64"), focus: [0.5, 0.5] });
  return { root, call, has, picture, written, read: (p: string) => readFileSync(join(root, "site", p), "utf8") };
}

describe("studio: an album can be renamed", () => {
  test("the name changes in both languages, the short name and the file's comments stay", async () => {
    const before = await Bun.file(join(SITE, "data", "albums.yml")).text();
    const after = renameAlbum(before, "drinks", { en: "Drinks & Cocktails", de: "Drinks und Cocktails, groß" });
    expect(after.startsWith("# Gallery albums.")).toBe(true);
    const was = parseYaml(before).albums, now = parseYaml(after).albums;
    expect(now.map((a: any) => a.slug)).toEqual(was.map((a: any) => a.slug));
    expect(now.find((a: any) => a.slug === "drinks").title).toEqual({ en: "Drinks & Cocktails", de: "Drinks und Cocktails, gross" });
    expect(now.filter((a: any) => a.slug !== "drinks")).toEqual(was.filter((a: any) => a.slug !== "drinks"));
    expect(() => renameAlbum(before, "nope", { en: "A", de: "B" })).toThrow("album_unknown");
    expect(() => renameAlbum(before, "drinks", { en: "A", de: " " })).toThrow("both_languages");
    expect(() => renameAlbum(before, "drinks", { en: 1, de: 2 } as any)).toThrow("both_languages");
  });
  test("through the route, and its words exist in both languages", async () => {
    const s = studio();
    expect((await s.call("PUT album", { slug: "drinks", title: { en: "Cocktails", de: "Cocktails" } }))!.status).toBe(200);
    expect(parseYaml(s.read("data/albums.yml")).albums.find((a: any) => a.slug === "drinks").title.en).toBe("Cocktails");
    expect((await s.call("PUT album", { slug: "../x", title: { en: "A", de: "B" } }))!.data.error).toBe("album_unknown");
    for (const lang of ["en", "de"] as const) for (const key of ["album_rename", "album_rename_title", "album_renamed"] as const) expect(STRINGS[lang][key]).toBeTruthy();
  });
});

describe("studio: a picture nothing uses any more is deleted", () => {
  test("a drink's old picture goes when a new one replaces it, and its focus line with it", async () => {
    const s = studio();
    writeFileSync(join(s.root, "site", "data", "focus.yml"), s.read("data/focus.yml") + '"photos/menu-lazy-monkey.jpg": [0.4, 0.6]\n');
    const drink = parseYaml(s.read("data/menu.yml")).sections[0].drinks.find((d: any) => d.name === "Lazy Monkey");
    const res = (await s.call("POST drink", { was: { part: "signatures", name: "Lazy Monkey" }, part: "signatures", drink, picture: await s.picture() }))!;
    expect(res.status).toBe(200);
    expect(res.data.photo).not.toBe("photos/menu-lazy-monkey.jpg");
    expect(s.has(res.data.photo)).toBe(true);
    expect(s.has("photos/menu-lazy-monkey.jpg")).toBe(false);
    expect(parseYaml(s.read("data/focus.yml"))["photos/menu-lazy-monkey.jpg"]).toBeUndefined();
    expect(parseYaml(s.read("data/focus.yml"))[res.data.photo]).toEqual([0.5, 0.5]);
    for (const p of s.written) expect([p, inEditScope(p)]).toEqual([p, true]);
  });
  test("removing a drink removes its picture; an edit that keeps the picture keeps it", async () => {
    const s = studio();
    const drink = parseYaml(s.read("data/menu.yml")).sections[0].drinks.find((d: any) => d.name === "Toffee Crush");
    expect((await s.call("POST drink", { was: { part: "signatures", name: "Toffee Crush" }, part: "signatures", drink: { ...drink, price_chf: 19 } }))!.status).toBe(200);
    expect(s.has("photos/menu-toffee-crush.jpg")).toBe(true);
    expect((await s.call("DELETE drink", { part: "signatures", name: "Toffee Crush" }))!.status).toBe(200);
    expect(s.has("photos/menu-toffee-crush.jpg")).toBe(false);
  });
  test("ANTI: a picture that something else still names stays, and so does any picture the Studio did not make", async () => {
    const s = studio();
    // A second drink uses the same picture.
    const menu = parseYaml(s.read("data/menu.yml"));
    const twin = { ...menu.sections[0].drinks.find((d: any) => d.name === "Lazy Monkey"), name: "Lazy Monkey Twin" };
    expect((await s.call("POST drink", { part: "signatures", drink: twin }))!.status).toBe(200);
    expect((await s.call("DELETE drink", { part: "signatures", name: "Lazy Monkey" }))!.status).toBe(200);
    expect(s.has("photos/menu-lazy-monkey.jpg")).toBe(true);
    // A page photo put there by hand, given to a drink and taken away again: it is not the Studio's to delete.
    expect((await s.call("POST drink", { part: "signatures", drink: { name: "House Latte", text: { en: "Milk", de: "Milch" }, price_chf: 6, photo: "photos/latte-art-pour.jpg", alt: { en: "A", de: "B" } } }))!.status).toBe(200);
    writeFileSync(join(s.root, "site", "data", "home.yml"), "sections: [hero]\n");
    expect((await s.call("DELETE drink", { part: "signatures", name: "House Latte" }))!.status).toBe(200);
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
