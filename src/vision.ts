// Apple Vision for the Studio: runs the small Swift helper in tools/vision.swift on one
// picture. Needs a Mac with the Swift tools; the helper is compiled once into .cache/.
// Not browser-safe (it starts programs); the pure parts live in src/focus.ts.
import { existsSync, statSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

export type Seen = { focus?: { x: number; y: number }; box?: { x: number; y: number; w: number; h: number }; labels: { name: string; confidence: number }[]; text: string[]; faces: { x: number; y: number; w: number; h: number }[]; /** When the picture was taken, as its EXIF data says it: "2026:11:07 21:14:05". */ taken?: string };

const run = async (cmd: string[], timeoutMs: number) => {
  const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  const timer = setTimeout(() => p.kill(), timeoutMs);
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  clearTimeout(timer);
  return { out, err, code };
};

/** The compiled helper, built when it is missing or older than its source. Throws with a plain reason when it cannot be built. */
export async function visionTool(root: string): Promise<string> {
  const source = join(root, "tools", "vision.swift"), bin = join(root, ".cache", "vision");
  if (process.platform !== "darwin") throw new Error("Apple Vision needs a Mac.");
  if (existsSync(bin) && statSync(bin).mtimeMs >= statSync(source).mtimeMs) return bin;
  if (!Bun.which("swiftc")) throw new Error("The Swift tools are missing. Install them with: xcode-select --install");
  await mkdir(join(root, ".cache"), { recursive: true });
  const { code, err } = await run(["swiftc", "-O", source, "-o", bin], 180_000);
  if (code !== 0) throw new Error(`The picture helper could not be built: ${err.trim().split("\n").at(-1) ?? "unknown reason"}`);
  return bin;
}

/**
 * What Vision sees in one picture file. `original` names the file as it came from the
 * camera when `file` is a cleaned copy: only the moment it was taken is read from it.
 */
export async function look(root: string, file: string, original?: string): Promise<Seen> {
  const { code, out, err } = await run([await visionTool(root), file, ...(original ? [original] : [])], 60_000);
  if (code !== 0) throw new Error(err.trim() || "The picture could not be read.");
  const j = JSON.parse(out);
  return { focus: j.focus, box: j.box, labels: j.labels ?? [], text: j.text ?? [], faces: j.faces ?? [], ...(typeof j.taken === "string" ? { taken: j.taken } : {}) };
}

export type Tool = { name: string; found: boolean; needed: boolean; why: string; install: string };

/** The programs the Studio uses on this Mac, with the line that installs a missing one. */
export function toolReport(which: (name: string) => string | null = Bun.which, platform: string = process.platform): Tool[] {
  const row = (name: string, needed: boolean, why: string, install: string): Tool => ({ name, found: !!which(name), needed, why, install });
  return [
    row("bun", true, "tool_bun", "curl -fsSL https://bun.sh/install | bash"),
    row("git", true, "tool_git", "brew install git"),
    { ...row("swiftc", false, "tool_swift", "xcode-select --install"), found: platform === "darwin" && !!which("swiftc") },
    row("gh", false, "tool_gh", "brew install gh"),
  ];
}
