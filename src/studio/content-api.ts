// The Studio's routes for content: photos, albums, the menu, events, Eventfrog, tools.
// Every path written here is made from a checked slug under a fixed folder, so a request
// cannot name a file of its own. The rules of each file live in src/content.ts.
import { existsSync } from "node:fs";
import { mkdir, unlink, readdir } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml, parseDocument } from "yaml";
import { cleanPhoto } from "../../scripts/add-photo";
import { momentMarkdown } from "../moment";
import { parseFrontMatter } from "../render";
import { eventFile, eventProblems, addAlbum, setDrink, removeDrink, drinkProblems, slugify, type EventInput } from "../content";
import { importFromPage, listOrganiserEvents, eventfrogImage, eventfrogUrl, fetchChecked, type Imported } from "../eventfrog";
import { draftAlt, type Focus } from "../focus";
import { look as realLook, toolReport, type Seen } from "../vision";

export type ContentDeps = {
  root: string;
  /** Write one file of the working copy (path from the repository root) and rebuild. */
  write: (path: string, data: string | Uint8Array) => Promise<void>;
  /** Tell the screen and the preview that a file went away. */
  changed: () => void;
  readKey: (name: "eventfrog") => Promise<string | null>;
  fetchFn?: typeof fetch;
  look?: (root: string, file: string) => Promise<Seen>;
};

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const refuse = (status: number, error: string, more: Record<string, unknown> = {}) => json({ error, ...more }, status);
const DAY = /^\d{4}-\d{2}-\d{2}$/, SLUG = /^[a-z0-9-]{1,60}$/;
const both = (v: any) => typeof v?.en === "string" && typeof v?.de === "string" && v.en.trim() !== "" && v.de.trim() !== "";
const validFocus = (f: any): f is Focus => Array.isArray(f) && f.length === 2 && f.every((n) => typeof n === "number" && n >= 0 && n <= 1);
const MAX_PHOTO = 40 * 1024 * 1024;

/** focus.yml with one photo's focus set; the file's comments are kept. */
export function setFocus(yamlText: string, photo: string, focus: Focus): string {
  const doc = parseDocument(yamlText || "{}\n");
  const node = doc.createNode([Math.round(focus[0] * 100) / 100, Math.round(focus[1] * 100) / 100]) as any;
  node.flow = true;
  doc.set(photo, node);
  return doc.toString({ lineWidth: 0 });
}

export function contentApi(deps: ContentDeps) {
  const { root } = deps;
  const fetchFn = deps.fetchFn ?? fetch;
  const look = deps.look ?? realLook;
  const text = (path: string) => Bun.file(join(root, path)).text().catch(() => "");
  const photoBytes = (base64: unknown): Uint8Array | null => {
    if (typeof base64 !== "string" || !base64 || base64.length > MAX_PHOTO * 1.4) return null;
    try { const b = Buffer.from(base64, "base64"); return b.length ? new Uint8Array(b) : null; } catch { return null; }
  };

  async function overview() {
    const eventDir = join(root, "site", "events");
    const names = existsSync(eventDir) ? (await readdir(eventDir)).filter((n) => n.endsWith(".md") && n !== "README.md").sort() : [];
    const events = await Promise.all(names.map(async (n) => {
      const { data } = parseFrontMatter(await text(`site/events/${n}`));
      const day = (v: any) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v));
      return {
        path: `site/events/${n}`, title: String(data.name ?? data.title ?? n),
        when: data.every ? { kind: "weekly", every: String(data.every) } : Array.isArray(data.dates) ? { kind: "dates", count: data.dates.length, first: day([...data.dates].sort()[0]) } : { kind: "day", day: day(data.date ?? data.start ?? "").slice(0, 10) },
        ticket: !!data.ticket_url, source: data.source_url ? "eventfrog" : "hand",
      };
    }));
    const photoDir = join(root, "site", "photos");
    const photos = existsSync(photoDir) ? (await readdir(photoDir)).filter((n) => n.endsWith(".jpg")).sort().map((n) => `photos/${n}`) : [];
    return {
      albums: (parseYaml(await text("site/data/albums.yml"))?.albums ?? []).map((a: any) => ({ slug: a.slug, title: a.title })),
      menu: (parseYaml(await text("site/data/menu.yml"))?.sections ?? []).map((s: any) => ({ slug: s.slug, title: s.title, drinks: (s.drinks ?? []).map((d: any) => ({ name: d.name, price_chf: d.price_chf, text: d.text, photo: d.photo ?? null })) })),
      events, photos, tools: toolReport(),
    };
  }

  /** A cleaned copy in the cache, looked at by Vision, then removed. A Mac without the Swift tools gets a note instead. */
  async function lookAt(bytes: Uint8Array) {
    const { data, width, height } = await cleanPhoto(bytes);
    const dir = join(root, ".cache", "studio");
    await mkdir(dir, { recursive: true });
    const file = join(dir, `look-${crypto.randomUUID()}.jpg`);
    await Bun.write(file, data);
    try {
      const seen = await look(root, file);
      return { width, height, focus: seen.focus ? [seen.focus.x, seen.focus.y] : null, faces: seen.faces.length, words: seen.text.slice(0, 12), draft: draftAlt(seen), note: null as string | null };
    } catch (error) {
      return { width, height, focus: null, faces: 0, words: [], draft: { en: "", de: "" }, note: error instanceof Error ? error.message : String(error) };
    } finally {
      await unlink(file).catch(() => {});
    }
  }

  async function saveFocus(photo: string, focus: unknown) {
    if (validFocus(focus)) await deps.write("site/data/focus.yml", setFocus(await text("site/data/focus.yml"), photo, focus));
  }

  /** The picture of an import, cleaned into site/photos/ once; null when there is none or it cannot be used. */
  async function importPicture(src: string | null, slug: string): Promise<string | null> {
    const address = eventfrogImage(src);
    if (!address) return null;
    const path = `photos/event-${slug}.jpg`;
    if (existsSync(join(root, "site", path))) return path;
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

      case "POST look": {
        const bytes = photoBytes((await body()).base64);
        if (!bytes) return refuse(400, "photo_unreadable");
        try { return json(await lookAt(bytes)); } catch { return refuse(422, "photo_unreadable"); }
      }

      case "POST photo": {
        const b = await body();
        const bytes = photoBytes(b.base64);
        if (!bytes) return refuse(400, "photo_unreadable");
        const slug = slugify(String(b.slug ?? ""));
        if (!String(b.slug ?? "").trim() || !SLUG.test(slug)) return refuse(422, "photo_name_missing");
        let cleaned;
        try { cleaned = await cleanPhoto(bytes); } catch { return refuse(422, "photo_unreadable"); }
        if (b.kind === "plain") {
          const path = `site/photos/${slug}.jpg`;
          if (existsSync(join(root, path))) return refuse(409, "photo_exists");
          await deps.write(path, cleaned.data);
          await saveFocus(`photos/${slug}.jpg`, b.focus);
          return json({ ok: true, path: `photos/${slug}.jpg` });
        }
        if (!DAY.test(String(b.date ?? ""))) return refuse(422, "event_date_wrong");
        if (!both(b.caption) || !both(b.alt)) return refuse(422, "both_languages");
        const albums: any[] = parseYaml(await text("site/data/albums.yml"))?.albums ?? [];
        if (b.album && !albums.some((a) => a.slug === b.album)) return refuse(422, "album_unknown");
        const base = `site/moments/${b.date}-${slug}`;
        if (existsSync(join(root, `${base}.jpg`))) return refuse(409, "photo_exists");
        const sharp = (s: string) => s.trim().replace(/ß/g, "ss");
        await deps.write(`${base}.jpg`, cleaned.data);
        await deps.write(`${base}.md`, momentMarkdown({ date: b.date, album: b.album || undefined, feed: b.feed !== false, caption: { en: b.caption.en.trim(), de: sharp(b.caption.de) }, alt: { en: b.alt.en.trim(), de: sharp(b.alt.de) } }));
        await saveFocus(`moments/${b.date}-${slug}.jpg`, b.focus);
        return json({ ok: true, path: `moments/${b.date}-${slug}.jpg` });
      }

      case "POST album": {
        try {
          const made = addAlbum(await text("site/data/albums.yml"), { title: (await body()).title });
          await deps.write("site/data/albums.yml", made.text);
          return json({ ok: true, slug: made.slug });
        } catch (error) { return refuse(422, error instanceof Error ? error.message : "album_wrong"); }
      }

      case "POST drink": {
        const b = await body();
        const problems = drinkProblems(b.drink ?? {});
        if (problems.length) return refuse(422, problems[0]!, { problems });
        if (b.drink.photo && !existsSync(join(root, "site", b.drink.photo))) return refuse(422, "event_image_wrong");
        try {
          const part = b.part ? String(b.part) : slugify(String(b.partTitle?.en ?? ""));
          await deps.write("site/data/menu.yml", setDrink(await text("site/data/menu.yml"), part, b.drink, b.partTitle));
          return json({ ok: true });
        } catch (error) { return refuse(422, error instanceof Error ? error.message : "drink_wrong"); }
      }

      case "DELETE drink": {
        const b = await body();
        try {
          await deps.write("site/data/menu.yml", removeDrink(await text("site/data/menu.yml"), String(b.part), String(b.name)));
          return json({ ok: true });
        } catch (error) { return refuse(422, error instanceof Error ? error.message : "drink_not_found"); }
      }

      case "POST event": {
        const event = ((await body()).event ?? {}) as EventInput;
        const problems = eventProblems(event);
        if (problems.length) return refuse(422, problems[0]!, { problems });
        if (event.image && !existsSync(join(root, "site", event.image))) return refuse(422, "event_image_wrong");
        const file = eventFile(event);
        if (existsSync(join(root, "site", file.path))) return refuse(409, "event_exists");
        await deps.write(`site/${file.path}`, file.text);
        return json({ ok: true, path: `site/${file.path}` });
      }

      case "DELETE event": {
        const path = String((await body()).path ?? "");
        if (!/^site\/events\/[a-z0-9-]+\.md$/.test(path) || !existsSync(join(root, path))) return refuse(404, "event_not_found");
        await unlink(join(root, path));
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
            if (existsSync(join(root, "site", file.path))) { skipped++; continue; }
            await deps.write(`site/${file.path}`, file.text);
            added++;
          } catch { skipped++; }
        }
        return json({ ok: true, added, skipped });
      }
    }
    return null;
  };
}
