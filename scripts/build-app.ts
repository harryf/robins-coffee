#!/usr/bin/env bun
// Build the Mac app "ROBINs Studio.app" from app/Studio.swift with swiftc.
//   bun scripts/build-app.ts [--out <folder>] [--dry-run] [--json]
// The app is a window around the Studio (bun run studio). It is built for the
// repository folder this script runs in: that path goes into the bundle's Info.plist,
// so the Swift source holds no path. The bundle is gitignored; build it again after
// moving the folder.
import { parseArgs } from "node:util";
import { chmod, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
export const APP_NAME = "ROBINs Studio";
const EXECUTABLE = "ROBINsStudio";

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

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
  const version = (await Bun.file(join(ROOT, "src", "editor", "version.json")).json()).version as string;
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
    await rm(app, { recursive: true, force: true });
    await mkdir(join(app, "Contents", "MacOS"), { recursive: true });
    await Bun.write(join(app, "Contents", "Info.plist"), infoPlist(ROOT, version, background));
    const proc = Bun.spawn([swiftc, "-O", "-o", binary, source], { stdout: "inherit", stderr: "inherit" });
    if ((await proc.exited) !== 0) {
      await rm(app, { recursive: true, force: true });
      console.error("swiftc could not build the app (see above).");
      process.exit(1);
    }
    await chmod(binary, 0o755);
    result.built = true;
    say(`built ${app}\n  it starts the Studio for ${ROOT}\n  open it with: open "${app}"`);
  }
  if (values.json) console.log(JSON.stringify(result, null, 1));
}
