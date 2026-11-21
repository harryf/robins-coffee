// The Studio's routes for content: photos and albums, the menu, events, Eventfrog, the
// calendar, restoring an old version, tools, translations. A form sends its texts in
// English; on save every other language of site.yml is translated on this Mac (see
// planTexts in src/content.ts for what is kept), and a language it cannot do is left out. Every path written or removed here is made
// from checked parts under a fixed folder and is inside the edit scope, so a request
// cannot name a file of its own. The rules of each file live in src/content.ts.
import { existsSync, realpathSync } from "node:fs";
import { mkdir, unlink, readdir } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml, parseDocument } from "yaml";
import { cleanPhoto } from "../../scripts/add-photo";
import { inEditScope } from "../editor/scope";
import { momentMarkdown } from "../moment";
import { parseFrontMatter } from "../render";
import { eventFile, eventProblems, eventFields, keepComments, addAlbum, setDrink, changeDrink, hasDrink, removeDrink, drinkProblems, editMoment, dropCover, photoDay, slugify, type EventInput, renameAlbum, planTexts, hasEnglish, textsShape, cleanTexts, LANG, type Texts } from "../content";
import { importFromPage, listOrganiserEvents, eventfrogImage, eventfrogUrl, fetchChecked, type Imported } from "../eventfrog";
import { draftAlt, type Focus } from "../focus";
import { look as realLook, toolReport, type Seen } from "../vision";
import { appleTranslator, type Translator } from "../translate";
import { calendarMonths, zonedDay } from "./calendar";
import { RestoreRefused } from "./git";

export type ContentDeps = {
  root: string;
  /** Write one file of the working copy (path from the repository root) and rebuild. */
  write: (path: string, data: string | Uint8Array) => Promise<void>;
  /** Tell the screen and the preview that a file went away. */
  changed: () => void;
  readKey: (name: "eventfrog") => Promise<string | null>;
  fetchFn?: typeof fetch;
  /** Apple Vision on a cleaned copy; `original` is the file as it came, for the day it was taken. */
  look?: (root: string, file: string, original?: string) => Promise<Seen>;
  /** The folder the preview was built into; its events.json feeds the calendar. */
  previewDir?: string;
  /** Git of the working copy, for restoring an old version. */
  git?: { restoreContent: (sha: string) => Promise<{ changed: number; back: number; removed: number }> };
  /** True while a publish runs: nothing is restored under it. */
  busy?: () => boolean;
  now?: () => Date;
  /** Translates English texts on this Mac; tests hand in a fake. */
  translate?: Translator;
  /** Opens an address with the Mac's own opener; used only for the Translation Languages settings. */
  open?: (url: string) => void;
};

/** System Settings at Language and Region, where Translation Languages are added. */
export const TRANSLATION_SETTINGS = "x-apple.systempreferences:com.apple.Localization-Settings.extension";
/** What a save tells the screen about translating: the languages whose pack is missing, or why nothing could be translated. */
export type Told = { missing: string[]; note: string | null };

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const refuse = (status: number, error: string, more: Record<string, unknown> = {}) => json({ error, ...more }, status);
const DAY = /^\d{4}-\d{2}-\d{2}$/, NAME = /^[a-z0-9-]{1,90}$/;
const EVENT_PATH = /^site\/events\/([a-z0-9-]+)\.md$/;
const validFocus = (f: any): f is Focus => Array.isArray(f) && f.length === 2 && f.every((n) => typeof n === "number" && n >= 0 && n <= 1);
const MAX_PHOTO = 40 * 1024 * 1024;
const MAX_TEXT = 2000;
/** A text as a moment file gets it: trimmed, empty languages out, German without the sharp s. */
const cleanFor = (v: Texts) => cleanTexts(v) as Texts;
/** A text map out of a file, as strings by language; null when the file had none. */
const textsOf = (v: unknown): Record<string, string> | null => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).filter(([k, x]) => LANG.test(k) && typeof x === "string")) as Record<string, string> : null);
/** Adds what a save has to say about translating to its answer, only when there is something to say. */
const withTold = (data: Record<string, unknown>, told: Told) => (told.missing.length || told.note ? { ...data, translated: told } : data);
const reason = (error: unknown, fallback: string) => (error instanceof Error && /^[a-z_]+$/.test(error.message.split(", ")[0]!) ? error.message.split(", ")[0]! : fallback);

/** focus.yml with one photo's focus set; the file's comments are kept. */
export function setFocus(yamlText: string, photo: string, focus: Focus): string {
  const doc = parseDocument(yamlText || "{}\n");
  const node = doc.createNode([Math.round(focus[0] * 100) / 100, Math.round(focus[1] * 100) / 100]) as any;
  node.flow = true;
  doc.set(photo, node);
  return doc.toString({ lineWidth: 0 });
}

/** focus.yml without one photo: the build refuses a focus for a photo that is not there. */
export function dropFocus(yamlText: string, photo: string): string {
  const doc = parseDocument(yamlText || "{}\n");
  if (!doc.has(photo)) return yamlText;
  doc.delete(photo);
  // An emptied map would print as "{}", which reads oddly under the file's notes.
  return doc.toString({ lineWidth: 0 }).replace(/^\{\}\n$/m, "");
}

/** The words of a caption as a file name: at most six of them. */
export function photoName(caption: string): string {
  const slug = slugify(caption).split("-").slice(0, 6).join("-");
  return slug === "event" && !/event/i.test(caption) ? "photo" : slug;
}

/**
 * A picture of the working copy for the editing screen's thumbnails:
 * /_studio/photo/moments/<name>.jpg or /_studio/photo/photos/<name>.jpg and nothing
 * else. The name is checked letter by letter, so nothing climbs out of the two folders,
 * and a link that leads out of site/ is not followed. The server has checked the Host.
 */
export function workingPhoto(root: string, pathname: string): Response {
  const found = /^\/_studio\/photo\/(moments|photos)\/([a-z0-9-]{1,90})\.jpg$/.exec(pathname);
  const none = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  if (!found) return none();
  const file = join(root, "site", found[1]!, `${found[2]}.jpg`);
  try {
    if (!(realpathSync(file) + "/").startsWith(realpathSync(join(root, "site")) + "/")) return none();
  } catch {
    return none();
  }
  return new Response(Bun.file(file), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

export function contentApi(deps: ContentDeps) {
  const { root } = deps;
  const fetchFn = deps.fetchFn ?? fetch;
  const look = deps.look ?? realLook;
  const now = deps.now ?? (() => new Date());
  const translator = deps.translate ?? appleTranslator(root);
  const openUrl = deps.open ?? ((url: string) => void Bun.spawn(["/usr/bin/open", url], { stdin: "ignore", stdout: "ignore", stderr: "ignore" }));
  const text = (path: string) => Bun.file(join(root, path)).text().catch(() => "");
  const there = (path: string) => existsSync(join(root, path));
  const photoBytes = (base64: unknown): Uint8Array | null => {
    if (typeof base64 !== "string" || !base64 || base64.length > MAX_PHOTO * 1.4) return null;
    try { const b = Buffer.from(base64, "base64"); return b.length ? new Uint8Array(b) : null; } catch { return null; }
  };
  /** Removes one content file. The path is built here, never taken from a request. */
  const remove = async (path: string) => {
    if (!inEditScope(path)) throw new Error("outside the content folders");
    if (there(path)) await unlink(join(root, path));
  };
  const albumList = async (): Promise<any[]> => parseYaml(await text("site/data/albums.yml"))?.albums ?? [];
  /** The site's languages from site.yml, English first; only English when the file says nothing. */
  const languages = async (): Promise<string[]> => {
    let list: unknown;
    try { list = parseYaml(await text("site/data/site.yml"))?.languages; } catch { list = null; }
    const codes = Array.isArray(list) ? list.filter((l): l is string => typeof l === "string" && LANG.test(l)) : [];
    return ["en", ...new Set(codes.filter((l) => l !== "en"))];
  };

  /**
   * The texts of one save in every language of the site. Each job is what the form sent
   * and what the file had; planTexts says what is kept and what is missing, and all that is
   * missing goes to the translator in one run. A language it could not do stays out.
   */
  async function fillTexts(jobs: { given: Partial<Texts>; old?: Record<string, string> | null }[]): Promise<{ texts: Texts[]; told: Told }> {
    const langs = await languages();
    const plans = jobs.map((j) => planTexts(j.given, j.old, langs));
    const english = [...new Set(plans.filter((p) => p.need.length && p.keep.en).map((p) => p.keep.en))];
    const targets = [...new Set(plans.flatMap((p) => p.need))];
    const told: Told = { missing: [], note: null };
    if (!english.length) return { texts: plans.map((p) => p.keep), told };
    let done: Awaited<ReturnType<Translator>> = { texts: {}, missing: [], failed: [] };
    try { done = await translator(english, targets); } catch (error) { told.note = error instanceof Error ? error.message : String(error); }
    for (const p of plans) for (const lang of p.need) {
      const made = done.texts[lang]?.[english.indexOf(p.keep.en)];
      if (typeof made === "string" && made.trim()) p.keep[lang] = made.trim();
    }
    told.missing = targets.filter((l) => done.missing.includes(l));
    told.note ??= done.note ?? (done.failed.length ? "failed" : null);
    return { texts: plans.map((p) => p.keep), told };
  }

  /**
   * The short text of an imported event in the site's languages. Eventfrog's own text of a
   * language is used as it is; the others are translated from English when Eventfrog has
   * it, else from the language it has. A text whose language is not known (a public page)
   * is recognised by the Mac. Without English in the end there is no text: the site falls
   * back to English for every language.
   */
  async function importTexts(e: any): Promise<{ text?: Texts; told: Told }> {
    const langs = await languages();
    const told: Told = { missing: [], note: null };
    const known: Record<string, string> = {};
    if (textsShape(e?.texts)) for (const [k, v] of Object.entries(e.texts as Record<string, unknown>)) if (typeof v === "string" && v.trim() && langs.includes(k)) known[k] = v.trim().slice(0, MAX_TEXT);
    const source = known.en ? "en" : langs.find((l) => known[l]) ?? null;
    const from = source ? known[source]! : typeof e?.text === "string" ? e.text.trim().slice(0, MAX_TEXT) : "";
    if (!from) return { told };
    const out: Record<string, string> = { ...known };
    const need = langs.filter((l) => !out[l]);
    if (need.length) {
      try {
        const done = await translator([from], need, source ?? "auto");
        for (const l of need) if (done.texts[l]?.[0]?.trim()) out[l] = done.texts[l]![0]!.trim();
        told.missing = need.filter((l) => done.missing.includes(l));
        told.note = done.note ?? null;
      } catch (error) { told.note = error instanceof Error ? error.message : String(error); }
    }
    return out.en ? { text: out as Texts, told } : { told };
  }
  /** Several saves' notes as one: every missing language once. */
  const joinTold = (all: Told[]): Told => ({ missing: [...new Set(all.flatMap((t) => t.missing))].sort(), note: all.find((t) => t.note)?.note ?? null });
  const names = async (folder: string, ending: string) => (there(`site/${folder}`) ? (await readdir(join(root, "site", folder))).filter((n) => n.endsWith(ending) && n !== "README.md").sort() : []);
  /** A name nothing in the folder has yet: the name itself, or with -2, -3 behind it. */
  const freeName = (folder: "moments" | "photos", base: string) => {
    let name = base;
    for (let n = 2; there(`site/${folder}/${name}.jpg`) || there(`site/${folder}/${name}.md`); n++) name = `${base}-${n}`;
    return name;
  };

  async function overview() {
    const events = await Promise.all((await names("events", ".md")).map(async (n) => {
      const { data } = parseFrontMatter(await text(`site/events/${n}`));
      const fields = eventFields(data);
      return { path: `site/events/${n}`, title: fields.title || n, fields, source: data.source_url ? "eventfrog" : "hand" };
    }));
    const moments = await Promise.all((await names("moments", ".md")).map(async (n) => {
      const id = n.slice(0, -3);
      const { data } = parseFrontMatter(await text(`site/moments/${n}`));
      const pair = (v: any) => ({ ...textsOf(v), en: String(v?.en ?? "") });
      return { id, date: data.date instanceof Date ? data.date.toISOString().slice(0, 10) : String(data.date ?? ""), album: data.album ? String(data.album) : null, feed: data.feed !== false, caption: pair(data.caption), alt: pair(data.alt), photo: there(`site/moments/${id}.jpg`) ? `moments/${id}.jpg` : null };
    }));
    moments.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id.localeCompare(b.id)));
    return {
      languages: await languages(),
      albums: (await albumList()).map((a: any) => ({ slug: a.slug, title: a.title })),
      moments,
      menu: (parseYaml(await text("site/data/menu.yml"))?.sections ?? []).map((s: any) => ({ slug: s.slug, title: s.title, drinks: (s.drinks ?? []).map((d: any) => ({ name: d.name, price_chf: d.price_chf, text: d.text, photo: d.photo ?? null, alt: d.alt ?? null })) })),
      events, tools: toolReport(),
    };
  }

  /**
   * Looks at a picture. Vision gets a cleaned copy (upright, as it will be published), the
   * helper reads the day it was taken from the file as it came. Both are temp files in
   * the cache and both are removed again, whatever happens. A Mac without the Swift
   * tools gets a note instead.
   */
  async function lookAt(bytes: Uint8Array, modified: unknown) {
    const { data, width, height } = await cleanPhoto(bytes);
    const dir = join(root, ".cache", "studio");
    await mkdir(dir, { recursive: true });
    const id = crypto.randomUUID();
    const file = join(dir, `look-${id}.jpg`), original = join(dir, `look-${id}-original`);
    let seen: Seen | null = null, note: string | null = null;
    try {
      await Bun.write(file, data);
      await Bun.write(original, bytes);
      seen = await look(root, file, original);
    } catch (error) {
      note = error instanceof Error ? error.message : String(error);
    } finally {
      await unlink(file).catch(() => {});
      await unlink(original).catch(() => {});
    }
    const fileDay = typeof modified === "number" && Number.isFinite(modified) && modified > 0 ? zonedDay(new Date(modified)) : null;
    const date = photoDay({ taken: seen?.taken, fileDay, today: zonedDay(now()) });
    return { width, height, focus: seen?.focus ? [seen.focus.x, seen.focus.y] : null, faces: seen?.faces.length ?? 0, words: seen?.text.slice(0, 12) ?? [], draft: seen ? draftAlt(seen) : { en: "" }, date: date.day, date_from: date.from, note };
  }

  async function saveFocus(photo: string, focus: unknown) {
    if (validFocus(focus)) await deps.write("site/data/focus.yml", setFocus(await text("site/data/focus.yml"), photo, focus));
  }

  /** The picture that came with a drink or an event form, cleaned; "none" when the form sent no picture, null when it cannot be read. */
  async function formPicture(picture: any): Promise<{ data: Buffer; focus: unknown } | "none" | null> {
    if (picture == null) return "none";
    const bytes = photoBytes(picture?.base64);
    if (!bytes) return null;
    try { return { data: (await cleanPhoto(bytes)).data, focus: picture.focus }; } catch { return null; }
  }
  /** Writes it to site/photos/<prefix>-<name>.jpg under a free name, with its focus. */
  async function writePicture(prefix: "menu" | "event", name: string, picture: { data: Buffer; focus: unknown }): Promise<string> {
    const path = `photos/${freeName("photos", `${prefix}-${slugify(name)}`)}.jpg`;
    await deps.write(`site/${path}`, picture.data);
    await saveFocus(path, picture.focus);
    return path;
  }

  /** The album a photo form names: an existing one, a new one made now, or none. A string is a refusal. */
  async function albumFor(b: any, newTitle?: Texts): Promise<{ slug: string | null } | string> {
    if (b.newAlbum != null) {
      try {
        const made = addAlbum(await text("site/data/albums.yml"), { title: newTitle ?? b.newAlbum });
        await deps.write("site/data/albums.yml", made.text);
        return { slug: made.slug };
      } catch (error) { return reason(error, "album_wrong"); }
    }
    if (b.album == null || b.album === "") return { slug: null };
    return typeof b.album === "string" && (await albumList()).some((a) => a.slug === b.album) ? { slug: b.album } : "album_unknown";
  }

  /** The picture of an import, cleaned into site/photos/ once; null when there is none or it cannot be used. */
  async function importPicture(src: string | null, slug: string): Promise<string | null> {
    const address = eventfrogImage(src);
    if (!address) return null;
    const path = `photos/event-${slug}.jpg`;
    if (there(`site/${path}`)) return path;
    try {
      const res = await fetchChecked(address, (u) => { const ok = eventfrogImage(u); if (!ok) throw new Error("not an Eventfrog picture"); return ok; }, fetchFn as any);
      if (!res.ok || !res.arrayBuffer) return null;
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (!bytes.length || bytes.length > MAX_PHOTO) return null;
      await deps.write(`site/${path}`, (await cleanPhoto(bytes)).data);
      return path;
    } catch {
      return null;
    }
  }

  const drinkOf = (menu: string, part: string, name: string): any => (parseYaml(menu)?.sections ?? []).find((s: any) => s?.slug === part)?.drinks?.find((d: any) => d?.name === name) ?? null;
  const drinkPhoto = (menu: string, part: string, name: string): string | null => {
    const drink = drinkOf(menu, part, name);
    return typeof drink?.photo === "string" ? drink.photo : null;
  };

  /**
   * A picture the Studio made for a drink or an event (photos/menu-*.jpg, photos/event-*.jpg)
   * goes when nothing names it any more: no data file, no event, no page text. Pictures of
   * any other name were put there by hand for a page and are never touched.
   */
  async function sweepPictures(candidates: (string | null | undefined)[]): Promise<string[]> {
    const gone: string[] = [];
    const mine = [...new Set(candidates)].filter((p): p is string => typeof p === "string" && /^photos\/(menu|event)-[a-z0-9-]+\.jpg$/.test(p) && there(`site/${p}`));
    if (!mine.length) return gone;
    let words = "";
    for (const glob of ["data/*.yml", "events/*.md", "content/*/*.md", "moments/*.md"]) for await (const p of new Bun.Glob(glob).scan({ cwd: join(root, "site") })) if (p !== "data/focus.yml") words += await text(`site/${p}`) + "\n";
    for (const p of mine) {
      if (words.includes(p)) continue;
      await remove(`site/${p}`);
      const focus = await text("site/data/focus.yml"), without = dropFocus(focus, p);
      if (without !== focus) await deps.write("site/data/focus.yml", without);
      gone.push(p);
    }
    if (gone.length) deps.changed();
    return gone;
  }

  /** Answers a content route, or null when the route is not one of these. */
  return async function handle(route: string, body: () => Promise<any>): Promise<Response | null> {
    switch (route) {
      case "GET content":
        return json(await overview());

      case "GET calendar": {
        // The preview's own list: exactly what the site will show, comedy feed included.
        const built = deps.previewDir ? await Bun.file(join(deps.previewDir, "events.json")).text().catch(() => null) : null;
        if (!built) return json({ built: null, months: [] });
        try {
          const feed = JSON.parse(built);
          return json({ built: String(feed.generated_at ?? ""), months: calendarMonths(Array.isArray(feed.events) ? feed.events : [], now(), (await names("events", ".md")).map((n) => n.slice(0, -3))) });
        } catch { return json({ built: null, months: [] }); }
      }

      case "POST look": {
        const b = await body();
        const bytes = photoBytes(b.base64);
        if (!bytes) return refuse(400, "photo_unreadable");
        try { return json(await lookAt(bytes, b.modified)); } catch { return refuse(422, "photo_unreadable"); }
      }

      case "POST photo": {
        const b = await body();
        const bytes = photoBytes(b.base64);
        if (!bytes) return refuse(400, "photo_unreadable");
        if (typeof b.date !== "string" || !DAY.test(b.date) || Number.isNaN(Date.parse(b.date))) return refuse(422, "event_date_wrong");
        if (!hasEnglish(b.caption) || !hasEnglish(b.alt)) return refuse(422, "english_needed");
        if (b.newAlbum != null && !hasEnglish(b.newAlbum)) return refuse(422, "english_needed");
        let cleaned;
        try { cleaned = await cleanPhoto(bytes); } catch { return refuse(422, "photo_unreadable"); }
        const filled = await fillTexts([{ given: b.caption }, { given: b.alt }, ...(b.newAlbum != null ? [{ given: b.newAlbum }] : [])]);
        const [caption, alt, newTitle] = filled.texts as [Texts, Texts, Texts?];
        const album = await albumFor(b, newTitle);
        if (typeof album === "string") return refuse(422, album);
        // The name is made here, from the English caption: nobody has to think of one.
        const id = freeName("moments", `${b.date}-${photoName(caption.en)}`);
        await deps.write(`site/moments/${id}.jpg`, cleaned.data);
        await deps.write(`site/moments/${id}.md`, momentMarkdown({ date: b.date, album: album.slug ?? undefined, feed: b.feed !== false, caption: cleanFor(caption), alt: cleanFor(alt) }));
        await saveFocus(`moments/${id}.jpg`, b.focus);
        return json(withTold({ ok: true, id, path: `moments/${id}.jpg`, album: album.slug }, filled.told));
      }

      case "PUT photo": {
        const b = await body();
        const id = typeof b.id === "string" && NAME.test(b.id) ? b.id : "";
        if (!id || !there(`site/moments/${id}.md`)) return refuse(404, "photo_not_found");
        if (!hasEnglish(b.caption) || !hasEnglish(b.alt)) return refuse(422, "english_needed");
        if (b.newAlbum != null && !hasEnglish(b.newAlbum)) return refuse(422, "english_needed");
        const before = parseFrontMatter(await text(`site/moments/${id}.md`)).data;
        const filled = await fillTexts([{ given: b.caption, old: textsOf(before.caption) }, { given: b.alt, old: textsOf(before.alt) }, ...(b.newAlbum != null ? [{ given: b.newAlbum }] : [])]);
        const [caption, alt, newTitle] = filled.texts as [Texts, Texts, Texts?];
        const album = await albumFor(b, newTitle);
        if (typeof album === "string") return refuse(422, album);
        try {
          await deps.write(`site/moments/${id}.md`, editMoment(await text(`site/moments/${id}.md`), { caption, alt, album: album.slug, feed: b.feed !== false }));
          return json(withTold({ ok: true, id, album: album.slug }, filled.told));
        } catch (error) { return refuse(422, reason(error, "photo_not_found")); }
      }

      case "DELETE photo": {
        const b = await body();
        const id = typeof b.id === "string" && NAME.test(b.id) ? b.id : "";
        if (!id || (!there(`site/moments/${id}.md`) && !there(`site/moments/${id}.jpg`))) return refuse(404, "photo_not_found");
        // What points at the photo goes first: a focus or an album cover for a missing photo stops the build.
        const focus = await text("site/data/focus.yml"), without = dropFocus(focus, `moments/${id}.jpg`);
        if (without !== focus) await deps.write("site/data/focus.yml", without);
        const albums = await text("site/data/albums.yml"), uncovered = dropCover(albums, id);
        if (uncovered !== albums) await deps.write("site/data/albums.yml", uncovered);
        await remove(`site/moments/${id}.jpg`);
        await remove(`site/moments/${id}.md`);
        deps.changed();
        return json({ ok: true });
      }

      case "POST album": {
        try {
          const b = await body();
          if (!hasEnglish(b.title)) return refuse(422, "english_needed");
          const filled = await fillTexts([{ given: b.title }]);
          const made = addAlbum(await text("site/data/albums.yml"), { title: filled.texts[0]! });
          await deps.write("site/data/albums.yml", made.text);
          return json(withTold({ ok: true, slug: made.slug }, filled.told));
        } catch (error) { return refuse(422, reason(error, "album_wrong")); }
      }

      case "PUT album": {
        const b = await body();
        try {
          if (!hasEnglish(b.title)) return refuse(422, "english_needed");
          const was = (await albumList()).find((a) => a?.slug === String(b.slug ?? ""));
          if (!was) return refuse(422, "album_unknown");
          const filled = await fillTexts([{ given: b.title, old: textsOf(was.title) }]);
          await deps.write("site/data/albums.yml", renameAlbum(await text("site/data/albums.yml"), String(b.slug ?? ""), filled.texts[0]!));
          return json(withTold({ ok: true }, filled.told));
        } catch (error) { return refuse(422, reason(error, "album_wrong")); }
      }

      case "POST drink": {
        const b = await body();
        const was = b.was == null ? null : { part: String(b.was.part ?? ""), name: String(b.was.name ?? "") };
        const picture = await formPicture(b.picture);
        if (!picture) return refuse(422, "photo_unreadable");
        // With a new picture the drink is checked as if it had one already, before anything is written.
        const drink = { ...(b.drink ?? {}), ...(picture === "none" ? {} : { photo: "photos/menu-new.jpg" }) };
        const problems = drinkProblems(drink);
        if (problems.length) return refuse(422, problems[0]!, { problems });
        if (picture === "none" && drink.photo && !there(`site/${drink.photo}`)) return refuse(422, "event_image_wrong");
        try {
          const menu = await text("site/data/menu.yml");
          const before = was ? drinkPhoto(menu, was.part, was.name) : null;
          const part = b.part ? String(b.part) : slugify(String(b.partTitle?.en ?? ""));
          if (!b.part && !hasEnglish(b.partTitle)) return refuse(422, "english_needed");
          if (!was && hasDrink(menu, part, String(drink.name))) return refuse(422, "drink_exists");
          const old = was ? drinkOf(menu, was.part, was.name) : null;
          const filled = await fillTexts([{ given: drink.text, old: textsOf(old?.text) }, ...(drink.alt ? [{ given: drink.alt, old: textsOf(old?.alt) }] : []), ...(b.part ? [] : [{ given: b.partTitle }])]);
          drink.text = filled.texts[0];
          if (drink.alt) drink.alt = filled.texts[1];
          const partTitle = b.part ? undefined : filled.texts.at(-1);
          // A dry run first: a refusal must not leave a picture behind.
          const change = (d: typeof drink) => (was ? changeDrink(menu, was, part, d, partTitle) : setDrink(menu, part, d, partTitle));
          change(drink);
          if (picture !== "none") drink.photo = await writePicture("menu", String(drink.name), picture);
          await deps.write("site/data/menu.yml", change(drink));
          await sweepPictures([before]);
          return json(withTold({ ok: true, photo: drink.photo ?? null }, filled.told));
        } catch (error) { return refuse(422, reason(error, "drink_wrong")); }
      }

      case "DELETE drink": {
        const b = await body();
        try {
          const menu = await text("site/data/menu.yml");
          const before = drinkPhoto(menu, String(b.part), String(b.name));
          await deps.write("site/data/menu.yml", removeDrink(menu, String(b.part), String(b.name)));
          await sweepPictures([before]);
          return json({ ok: true });
        } catch (error) { return refuse(422, reason(error, "drink_not_found")); }
      }

      case "POST event":
      case "PUT event": {
        const b = await body();
        const editing = route === "PUT event";
        const old = editing ? String(b.path ?? "") : "";
        if (editing && (!EVENT_PATH.test(old) || !there(old))) return refuse(404, "event_not_found");
        const oldText = editing ? await text(old) : "";
        const kept = editing ? eventFields(parseFrontMatter(oldText).data) : null;
        const picture = await formPicture(b.picture);
        if (!picture) return refuse(422, "photo_unreadable");
        // Who organises it and where it was imported from are not on the form: an edit keeps them.
        const event = { ...(kept?.organiser ? { organiser: kept.organiser } : {}), ...(kept?.source_url ? { source_url: kept.source_url } : {}), ...(b.event ?? {}) } as EventInput;
        if (picture !== "none") delete event.image;
        const problems = eventProblems(event);
        if (problems.length) return refuse(422, problems[0]!, { problems });
        if (event.image && !there(`site/${event.image}`)) return refuse(422, "event_image_wrong");
        let told: Told = { missing: [], note: null };
        if (event.text?.en?.trim()) {
          const filled = await fillTexts([{ given: event.text, old: kept?.text ? textsOf(kept.text) : null }]);
          event.text = filled.texts[0];
          told = filled.told;
        } else delete event.text;
        // The file keeps its place when the name and the day did not change, also when it was
        // named by hand ("queens-gambit" for "Queen's Gambit"); otherwise the old one goes.
        const made = `site/${eventFile(event).path}`;
        const path = kept && made === `site/${eventFile(kept).path}` ? old : made;
        if (path !== old && there(path)) return refuse(409, "event_exists");
        if (picture !== "none") event.image = await writePicture("event", event.name?.trim() || event.title, picture);
        const file = eventFile(event);
        await deps.write(path, editing ? keepComments(oldText, file.text) : file.text);
        if (editing && path !== old) { await remove(old); deps.changed(); }
        await sweepPictures([kept?.image ?? null]);
        return json(withTold({ ok: true, path, image: event.image ?? null }, told));
      }

      case "DELETE event": {
        const path = String((await body()).path ?? "");
        if (!EVENT_PATH.test(path) || !there(path)) return refuse(404, "event_not_found");
        const image = parseFrontMatter(await text(path)).data.image;
        await remove(path);
        await sweepPictures([typeof image === "string" ? image : null]);
        deps.changed();
        return json({ ok: true });
      }

      case "POST eventfrog/page": {
        try {
          const found = await importFromPage(String((await body()).address ?? ""), fetchFn as any);
          return json({ kind: found.kind, events: found.events });
        } catch (error) { return refuse(422, "eventfrog_failed", { detail: error instanceof Error ? error.message : String(error) }); }
      }

      case "GET eventfrog/list": {
        const key = await deps.readKey("eventfrog").catch(() => null);
        if (!key) return refuse(409, "no_eventfrog_key");
        try { return json({ kind: "series", events: await listOrganiserEvents(key, fetchFn as any) }); }
        catch (error) { return refuse(422, "eventfrog_failed", { detail: (error instanceof Error ? error.message : String(error)).split(key).join("<key>") }); }
      }

      case "POST eventfrog/add": {
        const b = await body();
        const list: Imported[] = Array.isArray(b.events) ? b.events.slice(0, 40) : [];
        const category = ["comedy", "music", "other"].includes(b.category) ? b.category : "other";
        let added = 0, skipped = 0;
        const notes: Told[] = [];
        for (const e of list) {
          try {
            if (typeof e?.title !== "string" || typeof e.start !== "string" || typeof e.end !== "string") throw new Error("shape");
            const url = e.url ? eventfrogUrl(e.url).href : "";
            const image = await importPicture(e.image, slugify(e.title));
            const fields: EventInput = { title: e.title.trim(), start: e.start, end: e.end, ticket_url: url, source_url: url || undefined, price_chf: typeof e.price_chf === "number" ? e.price_chf : null, category, organiser: typeof e.organiser === "string" ? e.organiser : undefined, image: image ?? undefined };
            if (there(`site/${eventFile(fields).path}`)) { skipped++; continue; }
            const said = await importTexts(e);
            notes.push(said.told);
            const file = eventFile(said.text ? { ...fields, text: said.text } : fields);
            await deps.write(`site/${file.path}`, file.text);
            added++;
          } catch { skipped++; }
        }
        return json(withTold({ ok: true, added, skipped }, joinTold(notes)));
      }

      case "POST translate": {
        // What the form shows under an English text right after it is typed. Nothing is written.
        const b = await body();
        const texts: unknown[] = Array.isArray(b.texts) ? b.texts : [];
        if (!texts.length || texts.length > 20 || texts.some((x) => typeof x !== "string" || !x.trim() || x.length > MAX_TEXT)) return refuse(422, "english_needed");
        const others = (await languages()).filter((l) => l !== "en");
        try {
          const done = await translator((texts as string[]).map((x) => x.trim()), others);
          return json({ languages: others, texts: done.texts, missing: done.missing, note: done.note ?? (done.failed.length ? "failed" : null) });
        } catch (error) { return json({ languages: others, texts: {}, missing: [], note: error instanceof Error ? error.message : String(error) }); }
      }

      case "GET translate/status": {
        // Which languages this Mac can translate into right now: asks the system, translates nothing.
        const others = (await languages()).filter((l) => l !== "en");
        try {
          const done = await translator([], others);
          return json({ languages: others, ready: others.filter((l) => done.texts[l]), missing: done.missing, note: done.note ?? null });
        } catch (error) { return json({ languages: others, ready: [], missing: [], note: error instanceof Error ? error.message : String(error) }); }
      }

      case "POST translate/settings": {
        // One fixed address: System Settings at Language and Region. Nothing from the request is opened.
        openUrl(TRANSLATION_SETTINGS);
        return json({ ok: true });
      }

      case "POST restore": {
        if (!deps.git) return null;
        if (deps.busy?.()) return refuse(409, "restore_busy");
        try {
          const done = await deps.git.restoreContent(String((await body()).sha ?? ""));
          deps.changed();
          return json({ ok: true, ...done });
        } catch (error) {
          if (error instanceof RestoreRefused) return refuse(409, error.message);
          throw error;
        }
      }
    }
    return null;
  };
}
