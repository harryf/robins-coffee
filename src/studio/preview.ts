// The preview: the real site build (src/build.ts, base "/") of the files on disk, in a
// gitignored folder. A build goes into a "next" folder and takes the preview's place
// only when it worked, so a broken file leaves the last good preview standing.
import { watch, existsSync, statSync, type FSWatcher } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

export type BuildState = { status: "building" | "ok" | "failed"; at: string; log: string };

export type PreviewOptions = {
  root: string;
  /** Called after every build with its outcome; `fresh` is true when the preview folder changed. */
  onBuild: (state: BuildState, fresh: boolean) => void;
  /** Called on any change under site/, before the rebuild. */
  onChange?: () => void;
  /** A comedy feed file or address for the build. Default: the feed named in site.yml, fetched now and then and kept in the cache folder. */
  events?: string;
};

const FEED_MAX_AGE = 10 * 60_000;

/** What a failed build said, without the parts only a programmer reads: code excerpts, stack frames, object dumps. */
/**
 * The environment of the preview's build. It is a build on a person's Mac even when the
 * Studio itself runs inside a CI job (its tests do): with GitHub's marker set, bun and
 * the build print annotations for GitHub instead of plain lines.
 */
export function buildEnv(env: Record<string, string | undefined> = process.env): Record<string, string> {
  return Object.fromEntries(Object.entries(env).filter((pair): pair is [string, string] => pair[1] !== undefined && pair[0] !== "GITHUB_ACTIONS" && pair[0] !== "CI"));
}

export function plainLog(log: string): string {
  const noise = /^\s*(at |\d+ \||\^+\s*$|(pos|linePos|code|errno|syscall): |\[Object|\],?$|\},?$|Bun v)/;
  const lines = log.split("\n").filter((line) => line.trim() && !noise.test(line));
  return (lines.length ? lines : log.split("\n")).slice(0, 12).join("\n").slice(0, 2000);
}

export function preview(options: PreviewOptions) {
  const { root } = options;
  const work = join(root, ".cache", "studio");
  const dir = join(work, "preview");
  const next = join(work, "next");
  let state: BuildState = { status: "building", at: new Date().toISOString(), log: "" };
  let running: Bun.Subprocess | null = null;
  let busy = false;
  let again = false;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let watcher: FSWatcher | null = null;
  let idle: Promise<void> = Promise.resolve();
  let seen = "";

  /** Every file under site/ with its size and time: cheap for a site of this size, and it cannot miss a change. */
  function fingerprint(): string {
    const site = join(root, "site");
    const parts: string[] = [];
    for (const p of new Bun.Glob("**/*").scanSync({ cwd: site, dot: true })) {
      try {
        const s = statSync(join(site, p));
        parts.push(`${p}:${s.size}:${s.mtimeMs}`);
      } catch {}
    }
    return String(Bun.hash(parts.sort().join("\n")));
  }

  /** The build must not wait for the network on every save: the feed is fetched to a file and reused for ten minutes. */
  async function feed(): Promise<string | null> {
    if (options.events) return options.events;
    const file = join(work, "feed.json");
    try {
      const fresh = existsSync(file) && Date.now() - Bun.file(file).lastModified < FEED_MAX_AGE;
      if (!fresh) {
        const url = parseYaml(await Bun.file(join(root, "site", "data", "site.yml")).text()).events_feed;
        const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
        if (!res.ok) throw new Error(String(res.status));
        await Bun.write(file, JSON.stringify(await res.json()));
      }
    } catch {
      // Offline or the feed is down: an older copy is better than none, and with none the build has its own fallback.
    }
    return existsSync(file) ? file : null;
  }

  async function buildOnce(): Promise<void> {
    state = { ...state, status: "building", at: new Date().toISOString() };
    options.onBuild(state, false);
    await mkdir(work, { recursive: true });
    const events = await feed();
    if (stopped) return;
    const proc = Bun.spawn([process.execPath, join("src", "build.ts"), "--base", "/", "--out", join(".cache", "studio", "next"), ...(events ? ["--events", events] : [])], { cwd: root, stdin: "ignore", stdout: "pipe", stderr: "pipe", env: buildEnv() });
    running = proc;
    const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    running = null;
    if (stopped) return;
    if (code === 0) {
      const old = join(work, "old");
      await rm(old, { recursive: true, force: true });
      if (existsSync(dir)) await rename(dir, old);
      await rename(next, dir);
      await rm(old, { recursive: true, force: true });
      state = { status: "ok", at: new Date().toISOString(), log: out.trim() };
    } else {
      state = { status: "failed", at: new Date().toISOString(), log: plainLog(err.trim() || out.trim() || `exit ${code}`) };
    }
    options.onBuild(state, code === 0);
  }

  /** One build at a time; a change during a build asks for one more afterwards. */
  function build(): Promise<void> {
    if (busy) {
      again = true;
      return idle;
    }
    busy = true;
    idle = (async () => {
      do {
        again = false;
        await buildOnce().catch((error) => {
          state = { status: "failed", at: new Date().toISOString(), log: String(error) };
          options.onBuild(state, false);
        });
      } while (again && !stopped);
      busy = false;
    })();
    return idle;
  }

  return {
    dir,
    state: () => state,
    build,
    /** Resolves when no build is running or waiting. */
    settled: () => idle,
    start() {
      // The build itself makes the watcher fire (copying a folder touches it), so an event
      // only counts when a file's size or time really differs from what was last seen.
      watcher = watch(join(root, "site"), { recursive: true }, () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          const now = fingerprint();
          if (now === seen) return;
          seen = now;
          options.onChange?.();
          void build();
        }, 150);
      });
      seen = fingerprint();
      return build();
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      watcher?.close();
      running?.kill();
    },
  };
}

export type Preview = ReturnType<typeof preview>;
