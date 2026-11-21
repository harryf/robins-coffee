// The photo batch tools: the local review page and the import of a selection.
// No network here: the WhatsApp explorer is a fake fetch, and files go to a temp folder.
import { describe, expect, test } from "bun:test";
import sharp from "sharp";
import { join } from "node:path";
import { mkdtemp, mkdir, readdir, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { parse as parseYaml } from "yaml";
import { parseFrontMatter } from "../src/render";
import { loadReview, reviewPage, firstName, type ReviewData } from "../scripts/review-photos";
import { importSelection, type Selection } from "../scripts/import-selection";

const ROOT = join(import.meta.dir, "..");
import { FROZEN_SITE } from "./frozen";
const EXPLORER = "http://explorer.test";
const tokens = JSON.parse(await Bun.file(join(ROOT, "site/data/tokens.json")).text());
const i18n = parseYaml(await Bun.file(join(FROZEN_SITE, "data/i18n.yml")).text());
const albums = parseYaml(await Bun.file(join(FROZEN_SITE, "data/albums.yml")).text()).albums;

const at = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
/** A message item as the explorer returns it, with everything private that it carries. */
const message = (id: number, sent: number, over: Record<string, unknown> = {}) => ({
  id, chatId: 77, chatJid: "120363000000000000@g.us", chatName: "Secret Group Name", chatIsGroup: true, sent, fromMe: false,
  senderKey: "41000000000@s.whatsapp.net", senderName: "Anna Muster", senderPhone: "41000000000", senderJid: "123456789012345@lid",
  kind: "image", text: "private chat text", mediaPath: "/Users/someone/Library/photo.jpg", archived: true, deletedAt: null, goneAt: null, ...over,
});

type Call = { path: string; query: URLSearchParams };
function fakeExplorer(messages: any[], media?: Uint8Array) {
  const calls: Call[] = [];
  const fetcher = async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.origin !== EXPLORER) throw new Error(`network call in a test: ${url}`);
    calls.push({ path: url.pathname, query: url.searchParams });
    let m;
    if ((m = /^\/api\/chats\/(\d+)\/messages$/.exec(url.pathname))) {
      const types = url.searchParams.get("type")?.split(",");
      const hits = messages.filter((x) => x.chatId === Number(m![1]) && (!types || types.includes(x.kind)));
      const [limit, offset] = [Number(url.searchParams.get("limit") ?? 100), Number(url.searchParams.get("offset") ?? 0)];
      return Response.json({ total: hits.length, limit, offset, items: hits.slice(offset, offset + limit) });
    }
    if ((m = /^\/api\/messages\/(\d+)$/.exec(url.pathname))) {
      const hit = messages.find((x) => x.id === Number(m![1]));
      return hit ? Response.json(hit) : new Response("not found", { status: 404 });
    }
    if (/^\/media\/\d+$/.test(url.pathname) && media) return new Response(media.slice().buffer as ArrayBuffer, { headers: { "content-type": "image/jpeg" } });
    return new Response("not found", { status: 404 });
  };
  return { fetcher: fetcher as typeof fetch, calls };
}

describe("photo review page", () => {
  const NOW = new Date("2026-11-15T20:00:00+01:00");
  const group = [
    message(905, at("2026-11-14T21:04:00+01:00")),
    message(904, at("2026-11-14T20:10:00+01:00"), { kind: "video" }),
    message(903, at("2026-11-14T00:30:00+01:00"), { senderName: "+41 00 000 00 00" }),
    message(902, at("2026-11-07T23:59:00+01:00"), { fromMe: true, senderName: null }),
    message(901, at("2026-11-07T19:00:00+01:00"), { kind: "text" }),
    message(900, at("2026-11-07T18:00:00+01:00"), { mediaPath: null, archived: false }),
    message(899, at("2026-11-06T18:00:00+01:00"), { deletedAt: at("2026-11-06T19:00:00+01:00") }),
    message(898, at("2026-11-06T17:00:00+01:00"), { kind: "gif" }),
  ];
  const data = async (): Promise<ReviewData> => loadReview({ fetch: fakeExplorer(group).fetcher, explorer: EXPLORER, chat: 77, days: 90, now: NOW });
  const html = async (imported: Record<string, string> = {}) => reviewPage(await data(), { albums, imported, tokens, t: i18n.en, explorer: EXPLORER, timezone: "Europe/Zurich", days: 90 });

  test("asks one chat for its images of the last days and counts what it leaves out", async () => {
    const { fetcher, calls } = fakeExplorer(group);
    const got = await loadReview({ fetch: fetcher, explorer: EXPLORER, chat: 77, days: 90, now: NOW });
    expect(got.photos.map((p) => p.id)).toEqual([905, 903, 902]);
    expect(got.skipped).toEqual({ videos: 2, others: 1, noFile: 1, deleted: 1 });
    expect(calls.every((c) => c.path === "/api/chats/77/messages")).toBe(true);
    expect(calls[0]!.query.get("type")).toBe("image");
    expect(calls[0]!.query.get("from")).toBe("2026-08-17");
  });

  test("reads every page of a long list", async () => {
    const many = Array.from({ length: 1203 }, (_, i) => message(5000 - i, at("2026-11-01T12:00:00+01:00") - i * 60));
    const got = await loadReview({ fetch: fakeExplorer(many).fetcher, explorer: EXPLORER, chat: 77, days: 90, now: NOW });
    expect(got.photos.length).toBe(1203);
    expect(new Set(got.photos.map((p) => p.id)).size).toBe(1203);
  });

  test("only a first name is kept from a sender, and none when the name is a number", () => {
    expect(firstName("Anna Muster")).toBe("Anna");
    expect(firstName("+41 00 000 00 00")).toBe("");
    expect(firstName("41000000000")).toBe("");
    expect(firstName(null)).toBe("");
  });

  test("the page shows no phone number, sender id, surname, chat name or chat text", async () => {
    const page = await html();
    for (const secret of ["41000000000", "00 000 00 00", "s.whatsapp.net", "@lid", "@g.us", "Muster", "Secret Group Name", "private chat text", "/Users/someone"]) {
      expect(`has ${secret}: ${page.includes(secret)}`).toBe(`has ${secret}: false`);
    }
    expect(page).toContain("Anna");
    expect(JSON.stringify(await data())).not.toMatch(/41000000000|Muster|whatsapp\.net|Secret Group/);
  });

  test("photos are newest first, grouped by Zürich day, loaded straight from the explorer", async () => {
    const page = await html();
    const days = [...page.matchAll(/<h2[^>]*>([^<]+)<\/h2>/g)].map((m) => m[1]);
    expect(days).toEqual(["Saturday 14 November 2026", "Saturday 7 November 2026"]);
    const ids = [...page.matchAll(/<article class="photo[^"]*" data-id="(\d+)"/g)].map((m) => Number(m[1]));
    expect(ids).toEqual([905, 903, 902]);
    for (const id of ids) expect(page).toContain(`src="${EXPLORER}/media/${id}"`);
    expect(page).toContain("3 photos on 2 days");
    expect(page).toContain("2 videos");
    expect(page).toContain("1 other message");
    expect(page).toContain("1 photo without a file");
    expect(page).toContain("1 photo deleted by its sender");
  });

  test("published photos are marked and cannot be ticked; the others can", async () => {
    const page = await html({ "903": "2026-11-14-quiz-night" });
    const card = (id: number) => page.split(`data-id="${id}"`)[1]!.split("</article>")[0]!;
    expect(card(903)).toContain("2026-11-14-quiz-night");
    expect(card(903)).toMatch(/<input type="checkbox" data-f="on" disabled>/);
    expect(card(903)).not.toContain("<select");
    expect(card(905)).toMatch(/<input type="checkbox" data-f="on">/);
    expect(card(905)).toContain('<option value="halloween-2026">Halloween 2026</option>');
    expect(card(905)).toContain('<option value="behind-the-bar">Behind the bar</option>');
  });

  test("it is one self-contained page in the site's tokens that saves robins-selection.json", async () => {
    const page = await html();
    expect(page).toContain("--c-neon: #ff4fa8");
    expect(page).toContain("robins-selection.json");
    expect(page).toContain("localStorage");
    expect(page).not.toMatch(/<link[^>]+stylesheet|<script[^>]+src=/);
    expect(page).not.toContain("@font-face");
    expect(page).not.toContain("\u2014");
    // Tokens only: no raw colour outside the inlined token block.
    const own = page.split("/* page */")[1]!.split("</style>")[0]!;
    expect(own.split("\n").filter((l) => /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i.test(l))).toEqual([]);
  });
});

describe("selection import", () => {
  const dirty = async (w = 3200, h = 1600) => new Uint8Array(await sharp({ create: { width: w, height: h, channels: 3, background: "#804060" } })
    .withExif({ IFD0: { Make: "TestCam", Artist: "Somebody" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "47/1 22/1 0/1" } }).jpeg().toBuffer());
  const group = [
    message(501, at("2026-11-13T23:30:00Z")), // 00:30 on the 14th in Zürich
    message(502, at("2026-11-14T20:00:00+01:00")),
    message(503, at("2026-11-14T21:00:00+01:00")),
    message(504, at("2026-11-14T22:00:00+01:00"), { kind: "video" }),
    message(505, at("2026-11-14T22:30:00+01:00"), { chatId: 12 }),
  ];
  /** A throwaway copy of the parts of the repository the import touches. */
  async function sandbox() {
    const root = await mkdtemp(join(tmpdir(), "robins-import-"));
    await mkdir(join(root, "site/moments"), { recursive: true });
    await mkdir(join(root, "inbox"), { recursive: true });
    for (const f of ["data/albums.yml", "data/site.yml"]) await cp(join(FROZEN_SITE, f), join(root, "site", f));
    await Bun.write(join(root, "inbox/imported.json"), JSON.stringify({ "400": "2026-11-07-elias-pouring" }));
    return root;
  }
  const run = async (root: string, photos: Selection["photos"], over: { dryRun?: boolean; chat?: number } = {}) =>
    importSelection({ version: 1, photos }, { root, explorer: EXPLORER, fetch: fakeExplorer(group, await dirty()).fetcher, ...over });
  const pick = (id: number, over: Partial<Selection["photos"][number]> = {}) => ({ id, album: "", album_name: "", feed: true, caption: "", note: "", ...over });

  test("writes a cleaned photo dated in Zürich time, with album, feed flag and TODO texts", async () => {
    const root = await sandbox();
    const result = await run(root, [pick(501, { album: "halloween-2026", feed: false })]);
    expect(result.written.map((w) => w.file)).toEqual(["2026-11-14-photo"]);
    const meta = await sharp(join(root, "site/moments/2026-11-14-photo.jpg")).metadata();
    expect(`exif:${!!meta.exif} xmp:${!!meta.xmp}`).toBe("exif:false xmp:false");
    expect(Math.max(meta.width!, meta.height!)).toBe(2400);
    const { data } = parseFrontMatter(await Bun.file(join(root, "site/moments/2026-11-14-photo.md")).text());
    expect(data).toMatchObject({ album: "halloween-2026", feed: false, caption: { en: "TODO", de: "TODO" }, alt: { en: "TODO", de: "TODO" } });
    expect(new Date(data.date).toISOString().slice(0, 10)).toBe("2026-11-14");
  });

  test("the owner's rough caption is kept and names the file; a note is never written to the site", async () => {
    const root = await sandbox();
    const result = await run(root, [pick(502, { caption: "Quiz night, table three won!", note: "ask Anna Muster first" }), pick(503)]);
    expect(result.written.map((w) => w.file)).toEqual(["2026-11-14-quiz-night-table-three-won", "2026-11-14-photo"]);
    expect(result.written[0]!.note).toBe("ask Anna Muster first");
    const md = await Bun.file(join(root, "site/moments/2026-11-14-quiz-night-table-three-won.md")).text();
    const { data } = parseFrontMatter(md);
    expect(data.caption).toEqual({ en: "Quiz night, table three won!", de: "TODO" });
    expect(data.feed).toBeUndefined();
    expect(data.album).toBeUndefined();
    for (const f of await readdir(join(root, "site"), { recursive: true })) {
      if (/\.(md|yml)$/.test(f)) expect(await Bun.file(join(root, "site", f)).text()).not.toMatch(/Muster|50[0-9]\b/);
    }
  });

  test("two photos of one day get different file names", async () => {
    const root = await sandbox();
    const result = await run(root, [pick(502), pick(503)]);
    expect(result.written.map((w) => w.file)).toEqual(["2026-11-14-photo", "2026-11-14-photo-2"]);
  });

  test("a new album is appended once, with the typed name as both titles", async () => {
    const root = await sandbox();
    const before = await Bun.file(join(root, "site/data/albums.yml")).text();
    const result = await run(root, [pick(502, { album_name: "Quiz Night" }), pick(503, { album_name: "quiz night " }), pick(501, { album_name: "Behind the bar" })]);
    expect(result.newAlbums).toEqual([{ slug: "quiz-night", name: "Quiz Night" }]);
    const after = await Bun.file(join(root, "site/data/albums.yml")).text();
    expect(after.startsWith(before)).toBe(true);
    const list = parseYaml(after).albums;
    expect(list.length).toBe(albums.length + 1);
    expect(list.at(-1)).toEqual({ slug: "quiz-night", title: { en: "Quiz Night", de: "Quiz Night" } });
    expect(result.written.map((w) => w.album)).toEqual(["quiz-night", "quiz-night", "behind-the-bar"]);
  });

  test("which message became which file is recorded in inbox/imported.json, and a second run skips it", async () => {
    const root = await sandbox();
    await run(root, [pick(502)]);
    expect(JSON.parse(await Bun.file(join(root, "inbox/imported.json")).text())).toEqual({ "400": "2026-11-07-elias-pouring", "502": "2026-11-14-photo" });
    const again = await run(root, [pick(502), pick(503)]);
    expect(again.skipped).toEqual([502]);
    expect(again.written.map((w) => w.file)).toEqual(["2026-11-14-photo-2"]);
  });

  test("--dry-run writes nothing", async () => {
    const root = await sandbox();
    const result = await run(root, [pick(502, { album_name: "Quiz Night" })], { dryRun: true });
    expect(result.written.map((w) => w.file)).toEqual(["2026-11-14-photo"]);
    expect(await readdir(join(root, "site/moments"))).toEqual([]);
    expect(parseYaml(await Bun.file(join(root, "site/data/albums.yml")).text()).albums.length).toBe(albums.length);
    expect(JSON.parse(await Bun.file(join(root, "inbox/imported.json")).text())).toEqual({ "400": "2026-11-07-elias-pouring" });
  });

  test("anything that is not a photo of the bar's group stops the import before a file is written", async () => {
    const root = await sandbox();
    await expect(run(root, [pick(502), pick(504)])).rejects.toThrow(/504 is a video/);
    await expect(run(root, [pick(502), pick(999)])).rejects.toThrow(/999/);
    await expect(run(root, [pick(502), pick(505)], { chat: 77 })).rejects.toThrow(/505 is not from the bar's group/);
    await expect(run(root, [pick(502, { album: "no-such-album" })])).rejects.toThrow(/no-such-album/);
    await run(root, [pick(502)], { chat: 77 });
    expect((await readdir(join(root, "site/moments"))).sort()).toEqual(["2026-11-14-photo.jpg", "2026-11-14-photo.md"]);
  });
});
