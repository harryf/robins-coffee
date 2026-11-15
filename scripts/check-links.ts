#!/usr/bin/env bun
// Check every link of a built site: pages, anchors, images, styles, the sitemap.
//   bun scripts/check-links.ts [dist] [--base /robins-coffee/ | relative] [--origin https://host]
// A link must point at a file that exists with exactly that spelling (the live server
// tells upper from lower case; the Mac does not). Links to other sites are counted,
// not fetched: a slow site elsewhere must not fail our build.
import { parseArgs } from "node:util";
import { join, posix } from "node:path";
import { parse as parseYaml } from "yaml";

export type LinkReport = { problems: string[]; internal: number; external: number };

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");

export async function checkLinks(dir: string, base = "/", origin = ""): Promise<LinkReport> {
  const names = [...new Bun.Glob("**/*").scanSync({ cwd: dir, dot: true })];
  const files = new Set(names);
  const lower = new Map(names.map((n) => [n.toLowerCase(), n]));
  const text: Record<string, string> = {};
  for (const n of names) if (/\.(html|css|xml)$/.test(n)) text[n] = await Bun.file(join(dir, n)).text();
  const ids = (page: string) => new Set([...(text[page] ?? "").matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]!));
  const report: LinkReport = { problems: [], internal: 0, external: 0 };
  const self = origin.replace(/\/$/, "");

  const check = (from: string, raw: string) => {
    let link = decode(raw.trim());
    const bad = (why: string) => report.problems.push(`${from}: "${raw}" ${why}`);
    if (self && (link === self || link.startsWith(self + "/"))) link = link.slice(self.length) || "/";
    else if (/^(https?:|mailto:|tel:)/.test(link)) return void report.external++;
    else if (/^(data:|javascript:)/.test(link) || link === "" || link === "#") return;
    if (link.startsWith("//")) return bad("has no scheme");
    report.internal++;
    const hash = link.indexOf("#");
    const fragment = hash < 0 ? "" : link.slice(hash + 1);
    const clean = (hash < 0 ? link : link.slice(0, hash)).split("?")[0]!;
    let target = from;
    if (clean !== "") {
      if (clean.startsWith("/")) {
        if (base === "relative") return bad("starts with / in a relative build");
        if (!clean.startsWith(base)) return bad(`does not start with the base ${base} (use the url or asset filter)`);
        target = clean.slice(base.length);
      } else {
        // A page shown at any address (404.html) cannot use links relative to itself.
        if (base !== "relative" && from.endsWith(".html")) return bad("is relative; it only works at one depth (use the url or asset filter)");
        target = posix.normalize(posix.join(posix.dirname(from), clean));
        if (target.startsWith("..")) return bad("leaves the site");
      }
      if (target === "" || target === "." || target.endsWith("/")) target = (target === "." ? "" : target) + "index.html";
      if (!files.has(target)) {
        const near = lower.get(target.toLowerCase());
        return bad(near ? `is spelled ${near} on disk (upper and lower case differ on the live server)` : `points at ${target}, which does not exist`);
      }
    }
    if (fragment && target.endsWith(".html") && !ids(target).has(decodeURIComponent(fragment))) bad(`points at #${fragment}, which is not an id in ${target}`);
  };

  for (const [name, body] of Object.entries(text)) {
    if (name.endsWith(".css")) for (const m of body.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) check(name, m[1]!);
    else if (name.endsWith(".xml")) for (const m of body.matchAll(/<loc>([^<]+)<\/loc>|href="([^"]+)"/g)) check(name, m[1] ?? m[2]!);
    else {
      for (const m of body.matchAll(/\s(?:href|src|poster)="([^"]*)"/g)) check(name, m[1]!);
      for (const m of body.matchAll(/\s(?:srcset|data-srcset)="([^"]*)"/g)) for (const part of m[1]!.split(",")) if (part.trim()) check(name, part.trim().split(/\s+/)[0]!);
      for (const m of body.matchAll(/<meta property="og:(?:image|url)" content="([^"]*)"/g)) check(name, m[1]!);
    }
  }
  return report;
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({ args: Bun.argv.slice(2), allowPositionals: true, options: { base: { type: "string", default: "/" }, origin: { type: "string" } } });
  const root = join(import.meta.dir, "..");
  const base = values.base === "relative" ? "relative" : "/" + values.base!.replace(/^\/|\/$/g, "") + (values.base === "/" ? "" : "/");
  // Without --origin the site's own address is the one in site.yml, as in the build.
  const origin = values.origin ?? parseYaml(await Bun.file(join(root, "site", "data", "site.yml")).text()).url;
  const report = await checkLinks(join(root, positionals[0] ?? "dist"), base, origin);
  for (const p of report.problems) console.error(process.env.GITHUB_ACTIONS ? `::error title=Broken link::${p}` : `BROKEN: ${p}`);
  console.log(`link check: ${report.internal} links inside the site, ${report.external} to other sites (not fetched), ${report.problems.length} broken`);
  if (report.problems.length) process.exit(1);
}
