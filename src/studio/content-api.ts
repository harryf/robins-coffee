// The Studio's routes for content: photos and albums, the menu, events, Eventfrog, the
// calendar, restoring an old version, tools. Every path written or removed here is made
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
import { eventFile, eventProblems, eventFields, keepComments, addAlbum, setDrink, changeDrink, hasDrink, removeDrink, drinkProblems, editMoment, dropCover, photoDay, slugify, type EventInput } from "../content";
import { importFromPage, listOrganiserEvents, eventfrogImage, eventfrogUrl, fetchChecked, type Imported } from "../eventfrog";
import { draftAlt, type Focus } from "../focus";
import { look as realLook, toolReport, type Seen } from "../vision";
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
};

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const refuse = (status: number, error: string, more: Record<string, unknown> = {}) => json({ error, ...more }, status);
const DAY = /^\d{4}-\d{2}-\d{2}$/, NAME = /^[a-z0-9-]{1,90}$/;
const EVENT_PATH = /^site\/events\/([a-z0-9-]+)\.md$/;
const both = (v: any) => typeof v?.en === "string" && typeof v?.de === "string" && v.en.trim() !== "" && v.de.trim() !== "";
const validFocus = (f: any): f is Focus => Array.isArray(f) && f.length === 2 && f.every((n) => typeof n === "number" && n >= 0 && n <= 1);
const MAX_PHOTO = 40 * 1024 * 1024;
const noSharpS = (s: string) => s.trim().replace(/ß/g, "ss");
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
      const pair = (v: any) => ({ en: String(v?.en ?? ""), de: String(v?.de ?? "") });
      return { id, date: data.date instanceof Date ? data.date.toISOString().slice(0, 10) : String(data.date ?? ""), album: data.album ? String(data.album) : null, feed: data.feed !== false, caption: pair(data.caption), alt: pair(data.alt), photo: there(`site/moments/${id}.jpg`) ? `moments/${id}.jpg` : null };
    }));
    moments.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id.localeCompare(b.id)));
    return {
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
    return { width, height, focus: seen?.focus ? [seen.focus.x, seen.focus.y] : null, faces: seen?.faces.length ?? 0, words: seen?.text.slice(0, 12) ?? [], draft: seen ? draftAlt(seen) : { en: "", de: "" }, date: date.day, date_from: date.from, note };
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
  async function albumFor(b: any): Promise<{ slug: string | null } | string> {
    if (b.newAlbum != null) {
      try {
        const made = addAlbum(await text("site/data/albums.yml"), { title: b.newAlbum });
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
        if (!both(b.caption) || !both(b.alt)) return refuse(422, "both_languages");
        if (b.newAlbum != null && !both(b.newAlbum)) return refuse(422, "both_languages");
        let cleaned;
        try { cleaned = await cleanPhoto(bytes); } catch { return refuse(422, "photo_unreadable"); }
        const album = await albumFor(b);
        if (typeof album === "string") return refuse(422, album);
        // The name is made here, from the English caption: nobody has to think of one.
        const id = freeName("moments", `${b.date}-${photoName(b.caption.en)}`);
        await deps.write(`site/moments/${id}.jpg`, cleaned.data);
        await deps.write(`site/moments/${id}.md`, momentMarkdown({ date: b.date, album: album.slug ?? undefined, feed: b.feed !== false, caption: { en: b.caption.en.trim(), de: noSharpS(b.caption.de) }, alt: { en: b.alt.en.trim(), de: noSharpS(b.alt.de) } }));
        await saveFocus(`moments/${id}.jpg`, b.focus);
        return json({ ok: true, id, path: `moments/${id}.jpg`, album: album.slug });
      }

      case "PUT photo": {
        const b = await body();
        const id = typeof b.id === "string" && NAME.test(b.id) ? b.id : "";
        if (!id || !there(`site/moments/${id}.md`)) return refuse(404, "photo_not_found");
        if (!both(b.caption) || !both(b.alt)) return refuse(422, "both_languages");
        if (b.newAlbum != null && !both(b.newAlbum)) return refuse(422, "both_languages");
        const album = await albumFor(b);
        if (typeof album === "string") return refuse(422, album);
        try {
          await deps.write(`site/moments/${id}.md`, editMoment(await text(`site/moments/${id}.md`), { caption: b.caption, alt: b.alt, album: album.slug, feed: b.feed !== false }));
          return json({ ok: true, id, album: album.slug });
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
          const made = addAlbum(await text("site/data/albums.yml"), { title: (await body()).title });
          await deps.write("site/data/albums.yml", made.text);
          return json({ ok: true, slug: made.slug });
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
          const part = b.part ? String(b.part) : slugify(String(b.partTitle?.en ?? ""));
          // A dry run first: a refusal must not leave a picture behind.
          const change = (d: typeof drink) => (was ? changeDrink(menu, was, part, d, b.partTitle) : setDrink(menu, part, d, b.partTitle));
          if (!was && hasDrink(menu, part, String(drink.name))) return refuse(422, "drink_exists");
          change(drink);
          if (picture !== "none") drink.photo = await writePicture("menu", String(drink.name), picture);
          await deps.write("site/data/menu.yml", change(drink));
          return json({ ok: true, photo: drink.photo ?? null });
        } catch (error) { return refuse(422, reason(error, "drink_wrong")); }
      }

      case "DELETE drink": {
        const b = await body();
        try {
          await deps.write("site/data/menu.yml", removeDrink(await text("site/data/menu.yml"), String(b.part), String(b.name)));
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
        // The file keeps its place when the name and the day did not change, also when it was
        // named by hand ("queens-gambit" for "Queen's Gambit"); otherwise the old one goes.
        const made = `site/${eventFile(event).path}`;
        const path = kept && made === `site/${eventFile(kept).path}` ? old : made;
        if (path !== old && there(path)) return refuse(409, "event_exists");
        if (picture !== "none") event.image = await writePicture("event", event.name?.trim() || event.title, picture);
        const file = eventFile(event);
        await deps.write(path, editing ? keepComments(oldText, file.text) : file.text);
        if (editing && path !== old) { await remove(old); deps.changed(); }
        return json({ ok: true, path, image: event.image ?? null });
      }

      case "DELETE event": {
        const path = String((await body()).path ?? "");
        if (!EVENT_PATH.test(path) || !there(path)) return refuse(404, "event_not_found");
        await remove(path);
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
        for (const e of list) {
          try {
            if (typeof e?.title !== "string" || typeof e.start !== "string" || typeof e.end !== "string") throw new Error("shape");
            const url = e.url ? eventfrogUrl(e.url).href : "";
            const image = await importPicture(e.image, slugify(e.title));
            const file = eventFile({ title: e.title.trim(), start: e.start, end: e.end, ticket_url: url, source_url: url || undefined, price_chf: typeof e.price_chf === "number" ? e.price_chf : null, category, organiser: typeof e.organiser === "string" ? e.organiser : undefined, image: image ?? undefined });
            if (there(`site/${file.path}`)) { skipped++; continue; }
            await deps.write(`site/${file.path}`, file.text);
            added++;
          } catch { skipped++; }
        }
        return json({ ok: true, added, skipped });
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
