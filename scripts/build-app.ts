#!/usr/bin/env bun
// Build the Mac app "ROBINs Studio.app" from app/Studio.swift with swiftc.
//   bun scripts/build-app.ts [--out <folder>] [--dry-run] [--json]
// The app is a window around the Studio (bun run studio). It is built for the
// repository folder this script runs in: that path goes into the bundle's Info.plist,
// so the Swift source holds no path. The bundle is gitignored; build it again after
// moving the folder.
import { parseArgs } from "node:util";
import { chmod, mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
export const APP_NAME = "ROBINs Studio";
const EXECUTABLE = "ROBINsStudio";

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * The app's icon as an .icns file: the bar's roundel on the night colour, on the rounded
 * square a Mac icon is. Drawn with sharp, packed by Apple's own iconutil. The roundel is
 * a small bitmap until vector logos arrive, so it is a little soft at the largest sizes.
 */
export async function appIcon(background: string): Promise<Uint8Array> {
  const { default: sharp } = await import("sharp");
  const SIZE = 1024, BODY = 824, RADIUS = 185, MARK = 640;
  const plate = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}"><rect x="${(SIZE - BODY) / 2}" y="${(SIZE - BODY) / 2}" width="${BODY}" height="${BODY}" rx="${RADIUS}" fill="${background}"/></svg>`);
  const mark = await sharp(join(ROOT, "site", "assets", "brand", "logo-roundel-white.png")).resize({ width: MARK, height: MARK, fit: "inside", kernel: "lanczos3" }).toBuffer();
  const master = await sharp(plate).composite([{ input: mark, gravity: "centre" }]).png().toBuffer();
  const work = await mkdtemp(join(tmpdir(), "studio-icon-"));
  try {
    const set = join(work, "AppIcon.iconset");
    await mkdir(set);
    for (const [name, px] of [["16x16", 16], ["16x16@2x", 32], ["32x32", 32], ["32x32@2x", 64], ["128x128", 128], ["128x128@2x", 256], ["256x256", 256], ["256x256@2x", 512], ["512x512", 512], ["512x512@2x", 1024]] as const) {
      await sharp(master).resize({ width: px, height: px }).png().toFile(join(set, `icon_${name}.png`));
    }
    const proc = Bun.spawn(["/usr/bin/iconutil", "-c", "icns", "-o", join(work, "AppIcon.icns"), set], { stdout: "ignore", stderr: "pipe" });
    if ((await proc.exited) !== 0) throw new Error((await new Response(proc.stderr).text()).trim() || "iconutil failed");
    return new Uint8Array(await Bun.file(join(work, "AppIcon.icns")).arrayBuffer());
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/** The bundle's Info.plist. `repository` is where the app will start the Studio; `background` is the window colour before the page loads. */
export function infoPlist(repository: string, version: string, background: string): string {
  const entries: [string, string][] = [
    ["CFBundleName", "ROBIN's Studio"],
    ["CFBundleDisplayName", "ROBIN's Studio"],
    ["CFBundleIdentifier", "ch.robins-coffee.studio"],
    ["CFBundleExecutable", EXECUTABLE],
    ["CFBundlePackageType", "APPL"],
    ["CFBundleShortVersionString", version],
    ["CFBundleVersion", version],
    ["LSMinimumSystemVersion", "12.0"],
    ["NSPrincipalClass", "NSApplication"],
    ["StudioRepository", repository],
    ["StudioBackground", background],
    ["CFBundleIconFile", "AppIcon"],
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
${entries.map(([k, v]) => `  <key>${k}</key>\n  <string>${xml(v)}</string>`).join("\n")}
  <key>NSHighResolutionCapable</key>
  <true/>
  <key>NSAppTransportSecurity</key>
  <dict>
    <key>NSAllowsLocalNetworking</key>
    <true/>
  </dict>
</dict>
</plist>
`;
}

if (import.meta.main) {
  const { values } = parseArgs({ args: Bun.argv.slice(2), options: { out: { type: "string", default: ROOT }, "dry-run": { type: "boolean", default: false }, json: { type: "boolean", default: false }, help: { type: "boolean", default: false } } });
  if (values.help) {
    console.log(`Build the Mac app "${APP_NAME}.app": a window around the Studio for this folder.

  bun scripts/build-app.ts [--out <folder>] [--dry-run] [--json]

  --out      where the app goes (default: this repository folder; the bundle is gitignored)
  --dry-run  say what would be built, build nothing
  --json     print the result as JSON

Needs the Swift compiler: xcode-select --install`);
    process.exit(0);
  }
  const app = join(resolve(values.out!), `${APP_NAME}.app`);
  const binary = join(app, "Contents", "MacOS", EXECUTABLE);
  const source = join(ROOT, "app", "Studio.swift");
  const version = (await Bun.file(join(ROOT, "src", "studio", "version.json")).json()).version as string;
  const background = JSON.parse(await Bun.file(join(ROOT, "site", "data", "tokens.json")).text()).color.night.bg as string;
  const result = { app, repository: ROOT, source, version, built: false };
  const say = (line: string) => values.json || console.log(line);

  if (process.platform !== "darwin") {
    console.error("The app is for macOS. On another system use `bun run studio` and a browser.");
    process.exit(1);
  }
  const swiftc = Bun.which("swiftc");
  if (!swiftc) {
    console.error("The Swift compiler (swiftc) is missing. Install Apple's command line tools with:\n\n  xcode-select --install\n");
    process.exit(1);
  }
  if (values["dry-run"]) {
    say(`would build ${app}\n  from ${source}\n  for the repository ${ROOT}`);
  } else {
    // Built beside the app and swapped in at the end: a build that fails leaves the app
    // that is there (and maybe running) as it was.
    const fresh = `${app}.new`, old = `${app}.old`;
    await rm(fresh, { recursive: true, force: true });
    await mkdir(join(fresh, "Contents", "MacOS"), { recursive: true });
    await Bun.write(join(fresh, "Contents", "Info.plist"), infoPlist(ROOT, version, background));
    const freshBinary = join(fresh, "Contents", "MacOS", EXECUTABLE);
    const proc = Bun.spawn([swiftc, "-O", "-o", freshBinary, source], { stdout: "inherit", stderr: "inherit" });
    if ((await proc.exited) !== 0) {
      await rm(fresh, { recursive: true, force: true });
      console.error("swiftc could not build the app (see above). The app that was there is untouched.");
      process.exit(1);
    }
    await chmod(freshBinary, 0o755);
    // The icon is a nicety: an app without one still works, so a failure here is only said.
    try {
      await mkdir(join(fresh, "Contents", "Resources"), { recursive: true });
      await Bun.write(join(fresh, "Contents", "Resources", "AppIcon.icns"), await appIcon(background));
    } catch (error) {
      console.error(`(the app has no icon: ${error instanceof Error ? error.message : String(error)})`);
    }
    await rm(old, { recursive: true, force: true });
    if (existsSync(app)) await rename(app, old);
    await rename(fresh, app);
    await rm(old, { recursive: true, force: true });
    result.built = true;
    say(`built ${app}\n  it starts the Studio for ${ROOT}\n  open it with: open "${app}"`);
  }
  if (values.json) console.log(JSON.stringify(result, null, 1));
}
