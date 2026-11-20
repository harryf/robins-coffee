#!/usr/bin/env bun
// The Studio: one local server for the editing screen (/_studio/) and the preview of
// the working copy (/).   bun run studio [--port 4750] [--open] [--events <feed file>]
//
// It listens on 127.0.0.1 only and stops with the process. src/studio/guard.ts says who
// may call the API and which files it may write; this file wires the parts together.
import { contentApi, type ContentDeps } from "./content-api";
import { parseArgs } from "node:util";
import { existsSync } from "node:fs";
import { mkdir, realpath } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parse as parseYaml } from "yaml";
import { hoursEditable, validateWeek, weekFromYaml, weekToYaml, DAYS, type Week } from "../editor/changes";
import { inEditScope } from "../editor/scope";
import { STRINGS as EDITOR_STRINGS, pickLang } from "../editor/strings";
import { tokensCss } from "../tokens";
import { studioGitHub } from "./checks";
import type { FileChange } from "./describe";
import { studioGit, type StudioGit } from "./git";
import { knownHost, previewFile, previewOrigin, refuseApi, safeEditPath, studioHostOnly, studioOrigin, type Self, previewHostOnly } from "./guard";
import { isKeyName, keychain, KEY_NAMES, validKey, type Keychain } from "./keychain";
import { preview as makePreview, type BuildState } from "./preview";
import { publish, type PublishGitHub, type PublishResult, type Step } from "./publish";
import { STRINGS } from "./strings";

export const DEFAULT_PORT = 4750;
const HOURS = "site/data/hours.yml";
const ALBUMS = "site/data/albums.yml";
/** Added to every HTML page of the preview as it is served, never to a built file. */
export const RELOAD_SCRIPT = `<script>new EventSource("/_studio/events").addEventListener("reload",function(){location.reload()})</script>`;

export type StudioOptions = {
  root: string;
  port?: number;
  /** A comedy feed file for the build, so a test needs no network. */
  events?: string;
  /** Where main is fetched from and edit/ branches go. Default: the repository named in site.yml, on GitHub. */
  remote?: string;
  keys?: Keychain;
  /** The GitHub side of Publish; a test passes a fake. */
  github?: (repo: string, token: string) => PublishGitHub;
  /** Opens an address in the default browser. */
  open?: (url: string) => void;
  /** For tests: the fetch used for Eventfrog, and the Apple Vision call. */
  fetchFn?: ContentDeps["fetchFn"];
  look?: ContentDeps["look"];
  /** Ask the remote for the newest main when starting. */
  fetchOnStart?: boolean;
};

export type StudioState = {
  build: BuildState;
  branch: string;
  changes: (FileChange & { publishable: boolean })[];
  keys: Record<string, boolean> | null;
  publish: { running: boolean; steps: Step[]; result: PublishResult | null };
  preview: string;
};

const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
const refuse = (status: number, error: string) => json({ error }, status);

export async function startStudio(options: StudioOptions) {
  const { root } = options;
  const site = parseYaml(await Bun.file(join(root, "site", "data", "site.yml")).text());
  const keys = options.keys ?? keychain();
  const git: StudioGit = studioGit(root, { remote: options.remote ?? `https://github.com/${site.repo}.git`, token: () => keys.read("github").catch(() => null) });
  const makeGitHub = options.github ?? studioGitHub;
  const open = options.open ?? ((url: string) => void Bun.spawn(["/usr/bin/open", url], { stdin: "ignore", stdout: "ignore", stderr: "ignore" }));

  // The screen: its script bundled for the browser, its colours and type read from the site's tokens.
  const bundle = await Bun.build({ entrypoints: [join(import.meta.dir, "ui", "main.ts")], target: "browser", minify: false });
  if (!bundle.success) throw new Error("the Studio screen could not be bundled:\n" + bundle.logs.join("\n"));
  const appJs = await bundle.outputs[0]!.text();
  const tokens = JSON.parse(await Bun.file(join(root, "site", "data", "tokens.json")).text());
  const appCss = tokensCss(tokens) + "\n" + (await Bun.file(join(import.meta.dir, "ui", "studio.css")).text()).replace(/breakpoint\(([a-z]+)\)/g, (_, name: string) => tokens.breakpoint[name]);
  const FONTS: Record<string, string> = {
    "alfa-slab-one.woff2": "@fontsource/alfa-slab-one/files/alfa-slab-one-latin-400-normal.woff2",
    "dm-sans.woff2": "@fontsource-variable/dm-sans/files/dm-sans-latin-wght-normal.woff2",
  };

  // Server-sent events: "reload" for preview tabs, "state" for the editing screen.
  const encoder = new TextEncoder();
  const clients = new Set<ReadableStreamDefaultController<Uint8Array>>();
  const send = (event: string) => {
    for (const client of clients) {
      try {
        client.enqueue(encoder.encode(`event: ${event}\ndata: ${Date.now()}\n\n`));
      } catch {
        clients.delete(client);
      }
    }
  };
  const alive = setInterval(() => send("ping"), 20_000);

  const site_ = makePreview({ root, events: options.events, onChange: () => send("state"), onBuild: (_state, fresh) => send(fresh ? "reload" : "state") });
  let publishing: StudioState["publish"] = { running: false, steps: [], result: null };
  /** True between a Publish request and the start of its run, so a second request cannot slip in while the build settles. */
  let starting = false;

  /** What a list file gained and lost, which its path alone cannot say. */
  async function withHints(changes: FileChange[]): Promise<FileChange[]> {
    return Promise.all(changes.map(async (c) => {
      if (c.path !== ALBUMS || c.status !== "modified") return c;
      const slugs = (text: string | null): string[] => {
        try {
          return (parseYaml(text ?? "")?.albums ?? []).map((a: any) => String(a.slug));
        } catch {
          return [];
        }
      };
      const before = slugs(await git.liveText(ALBUMS));
      const after = slugs(await Bun.file(join(root, ALBUMS)).text().catch(() => null));
      return { ...c, items: { added: after.filter((s) => !before.includes(s)).length, removed: before.filter((s) => !after.includes(s)).length } };
    }));
  }
  const hinted = { ...git, changes: async () => withHints(await git.changes()) };

  async function state(): Promise<StudioState> {
    const has = await Promise.all(KEY_NAMES.map((name) => keys.has(name))).then((found) => Object.fromEntries(KEY_NAMES.map((name, i) => [name, found[i]!])), () => null);
    return {
      build: site_.state(),
      branch: await git.branch().catch(() => ""),
      changes: (await hinted.changes().catch(() => [])).map((c) => ({ ...c, publishable: inEditScope(c.path) })),
      keys: has,
      publish: publishing,
      preview: previewOrigin(self) + "/",
    };
  }

  async function runPublish() {
    publishing = { running: true, steps: [], result: null };
    send("state");
    const token = await keys.read("github").catch(() => null);
    const result: PublishResult = token
      ? await publish({ git: hinted, github: makeGitHub(site.repo, token), report: (step) => { publishing.steps.push(step); send("state"); } })
      : { ok: false, reason: "no_key" };
    publishing = { running: false, steps: publishing.steps, result };
    send("state");
  }

  async function write(path: string, data: string | Uint8Array) {
    if (!inEditScope(path)) throw new Error("outside the content folders");
    await mkdir(dirname(join(root, path)), { recursive: true });
    // Where the folder really is: a link inside site/ must not lead a write out of it.
    const home = await realpath(join(root, "site"));
    if (!(await realpath(dirname(join(root, path))) + "/").startsWith(home + "/")) throw new Error("outside the content folders");
    await Bun.write(join(root, path), data);
    // The folder watcher sees it too; asking here as well keeps a save from waiting on it.
    send("state");
    void site_.build();
  }

  const contentRoutes = contentApi({ root, write, changed: () => { send("state"); void site_.build(); }, readKey: (name) => keys.read(name), fetchFn: options.fetchFn, look: options.look });

  async function api(req: Request, url: URL): Promise<Response> {
    const route = `${req.method} ${url.pathname.slice("/_studio/api/".length)}`;
    const body = async (): Promise<any> => req.json().catch(() => ({}));
    switch (route) {
      case "GET state":
        return json(await state());
      case "GET hours": {
        const text = await Bun.file(join(root, HOURS)).text();
        return json({ editable: hoursEditable(text), week: weekFromYaml(text) });
      }
      case "PUT hours": {
        const { week, lang } = (await body()) as { week?: Week; lang?: string };
        const text = await Bun.file(join(root, HOURS)).text();
        const shaped = !!week && DAYS.every((d) => week[d] && typeof week[d].closed === "boolean" && typeof week[d].open === "string" && (week[d].close === null || typeof week[d].close === "string"));
        if (!week || !shaped) return refuse(400, "not a week");
        if (!hoursEditable(text)) return refuse(409, "hours_closed_form");
        // The reasons come from the phone editor's strings file, which has them in both languages.
        const problems = validateWeek(week, EDITOR_STRINGS[pickLang(lang ?? null, undefined)]);
        if (problems.length) return json({ problems }, 422);
        await write(HOURS, weekToYaml(text, week));
        return json({ ok: true });
      }
      case "GET file": {
        const path = safeEditPath(url.searchParams.get("path"));
        if (!path) return refuse(403, "outside the content folders");
        const file = Bun.file(join(root, path));
        return (await file.exists()) ? new Response(file, { headers: { "Cache-Control": "no-store" } }) : refuse(404, "no such file");
      }
      case "PUT file": {
        // Text only. A picture has one way in, the photo route, which re-encodes it without its metadata.
        const { path: asked, text } = await body();
        const path = safeEditPath(asked);
        if (!path || !/\.(md|yml)$/.test(path)) return refuse(403, "outside the content folders");
        if (typeof text !== "string") return refuse(400, "text is needed");
        await write(path, text);
        return json({ ok: true });
      }
      case "POST discard": {
        const path = safeEditPath((await body()).path);
        if (!path) return refuse(403, "outside the content folders");
        if (publishing.running) return refuse(409, "busy");
        await git.discard(path);
        send("state");
        void site_.build();
        return json({ ok: true });
      }
      case "POST publish":
        if (publishing.running || starting) return json({ ok: false, reason: "busy" }, 409);
        starting = true;
        // What does not build here would fail the check on GitHub too: say so now, not in five minutes.
        await site_.settled().finally(() => { starting = false; });
        if (site_.state().status !== "ok") {
          publishing = { running: false, steps: [], result: { ok: false, reason: "build" } };
          send("state");
          return json({ ok: false, reason: "build" }, 409);
        }
        void runPublish();
        return json({ ok: true }, 202);
      case "GET history":
        return json({ entries: await git.history() });
      case "POST open": {
        // Only the preview, and only a path inside it: this endpoint must not become "open anything".
        const path = String((await body()).path ?? "/");
        if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return refuse(400, "a path inside the preview is needed");
        open(previewOrigin(self) + path);
        return json({ ok: true });
      }
    }
    const content = await contentRoutes(route, body);
    if (content) return content;
    const key = /^(PUT|DELETE) keys\/([a-z]+)$/.exec(route);
    if (key && isKeyName(key[2]!)) {
      if (key[1] === "DELETE") await keys.remove(key[2]);
      else {
        const value = String((await body()).value ?? "").trim();
        if (!validKey(value)) return refuse(422, "key_bad");
        await keys.save(key[2], value);
      }
      send("state");
      return json({ ok: true, saved: await keys.has(key[2]) });
    }
    return refuse(404, "no such thing");
  }

  async function previewResponse(url: URL): Promise<Response> {
    const path = previewFile(url.pathname);
    if (!path) return new Response("Not found", { status: 404 });
    let file = join(site_.dir, path);
    let status = 200;
    if (!existsSync(file) || !(await Bun.file(file).exists())) {
      if (existsSync(join(file, "index.html"))) return new Response(null, { status: 302, headers: { Location: url.pathname + "/" + url.search } });
      file = join(site_.dir, "404.html");
      status = 404;
      if (!existsSync(file)) return new Response(site_.state().status === "building" ? STRINGS.en.build_building : STRINGS.en.build_failed, { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8", "Retry-After": "2" } });
    }
    if (!file.endsWith(".html")) return new Response(Bun.file(file), { status, headers: { "Cache-Control": "no-store" } });
    const html = await Bun.file(file).text();
    const at = html.lastIndexOf("</body>");
    return new Response(at < 0 ? html + RELOAD_SCRIPT : html.slice(0, at) + RELOAD_SCRIPT + html.slice(at), { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
  }

  const self: Self = { port: options.port ?? DEFAULT_PORT, token: crypto.randomUUID() + crypto.randomUUID() };
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: self.port,
    idleTimeout: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (!knownHost(req, self)) return refuse(403, "host");
      if (url.pathname === "/_studio/events") {
        const from = req.headers.get("origin");
        if (from !== null && from !== studioOrigin(self) && from !== previewOrigin(self)) return refuse(403, "origin");
        let mine: ReadableStreamDefaultController<Uint8Array>;
        return new Response(new ReadableStream<Uint8Array>({
          start(controller) {
            mine = controller;
            clients.add(controller);
            controller.enqueue(encoder.encode(": connected\n\n"));
          },
          cancel() {
            clients.delete(mine);
          },
        }), { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store" } });
      }
      if (url.pathname === "/_studio" || url.pathname.startsWith("/_studio/")) {
        // The screen and everything behind it exist under the 127.0.0.1 name only.
        if (!studioHostOnly(req, self)) return refuse(403, "host");
        if (url.pathname.startsWith("/_studio/api/")) {
          const why = refuseApi(req, self);
          if (why) return refuse(403, why);
          try {
            return await api(req, url);
          } catch (error) {
            return refuse(500, error instanceof Error ? error.message : String(error));
          }
        }
        if (req.method !== "GET") return refuse(405, "method");
        if (url.pathname === "/_studio") return new Response(null, { status: 302, headers: { Location: "/_studio/" } });
        if (url.pathname === "/_studio/") {
          const html = `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="studio-token" content="${self.token}"><title>${STRINGS.en.app_name}</title><link rel="stylesheet" href="/_studio/app.css"></head><body><div id="app"></div><script type="module" src="/_studio/app.js"></script></body></html>\n`;
          return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Frame-Options": "DENY", "Content-Security-Policy": "frame-ancestors 'none'; default-src 'self'; img-src 'self' blob:", "Referrer-Policy": "no-referrer" } });
        }
        if (url.pathname === "/_studio/app.js") return new Response(appJs, { headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store" } });
        if (url.pathname === "/_studio/app.css") return new Response(appCss, { headers: { "Content-Type": "text/css; charset=utf-8", "Cache-Control": "no-store" } });
        const font = FONTS[url.pathname.slice("/_studio/fonts/".length)];
        if (url.pathname.startsWith("/_studio/fonts/") && font) return new Response(Bun.file(join(root, "node_modules", font)), { headers: { "Content-Type": "font/woff2" } });
        return refuse(404, "no such thing");
      }
      if (req.method !== "GET" && req.method !== "HEAD") return refuse(405, "method");
      // The built site is never served under the screen's own name: a script in a page of the
      // site could otherwise read the screen's token and use the API.
      if (!previewHostOnly(req, self)) return refuse(403, "host");
      return previewResponse(url);
    },
  });
  self.port = server.port!;

  const firstBuild = site_.start();
  if (options.fetchOnStart) void git.fetchMain().then(() => send("state"), () => undefined);

  return {
    port: self.port,
    token: self.token,
    url: `${studioOrigin(self)}/_studio/`,
    previewUrl: `${previewOrigin(self)}/`,
    firstBuild,
    /** Resolves when no build is running or waiting. */
    settled: () => site_.settled(),
    /** Resolves when a running publish has finished. */
    async published(): Promise<PublishResult | null> {
      while (publishing.running) await Bun.sleep(20);
      return publishing.result;
    },
    async stop() {
      clearInterval(alive);
      site_.stop();
      for (const client of clients) {
        try {
          client.close();
        } catch {}
      }
      await server.stop(true);
    },
  };
}

if (import.meta.main) {
  const { values } = parseArgs({ args: Bun.argv.slice(2), options: { port: { type: "string", default: String(DEFAULT_PORT) }, open: { type: "boolean", default: false }, events: { type: "string" }, lifeline: { type: "boolean", default: false }, offline: { type: "boolean", default: false }, help: { type: "boolean", default: false } } });
  if (values.help) {
    console.log(`The Studio: edit the site's content on this Mac, see the real build, publish.

  bun run studio [--port ${DEFAULT_PORT}] [--open] [--events <feed file or address>]

  --port      the port on 127.0.0.1 (default ${DEFAULT_PORT}); the Studio stops if it is taken
  --open      open the editing screen in the default browser
  --events    build the preview with this comedy feed, not the one named in site.yml
  --lifeline  stop when standard input closes (the Mac app starts it this way)
  --offline   do not ask GitHub for the newest main when starting (or set STUDIO_OFFLINE=1)

Editing screen: http://127.0.0.1:<port>/_studio/     Preview: http://localhost:<port>/`);
    process.exit(0);
  }
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(`--port must be a number from 1 to 65535, not "${values.port}"`);
    process.exit(2);
  }
  const root = join(import.meta.dir, "..", "..");
  try {
    const studio = await startStudio({ root, port, events: values.events, fetchOnStart: !values.offline && process.env.STUDIO_OFFLINE !== "1" });
    console.log(`Studio:  ${studio.url}\nPreview: ${studio.previewUrl}\nCtrl-C stops it.`);
    const quit = async () => {
      await studio.stop();
      process.exit(0);
    };
    process.on("SIGINT", quit);
    process.on("SIGTERM", quit);
    process.on("SIGHUP", quit);
    if (values.open) Bun.spawn(["/usr/bin/open", studio.url], { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
    if (values.lifeline) {
      // The app holds the other end of standard input. When it goes away, however it went, so do we.
      void (async () => {
        for await (const _ of Bun.stdin.stream()) void _;
        await quit();
      })();
    }
  } catch (error: any) {
    if (error?.code === "EADDRINUSE") console.error(`Port ${port} on 127.0.0.1 is taken. The Studio may already be running; stop it, or start this one with --port <another>.`);
    else console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
