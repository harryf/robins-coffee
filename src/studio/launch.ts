#!/usr/bin/env bun
// Start the Studio: first bring this folder up to the newest version when that is safe
// (src/studio/update.ts), then run the server (src/studio/server.ts) with the same
// arguments. The update happens here, before the server's code is loaded, so the
// server that starts is always the new one.
//   bun src/studio/launch.ts [the server's options] [--offline]
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { authEnv } from "./git";
import { keychain } from "./keychain";
import { reportPath, selfUpdate, type UpdateReport } from "./update";

const root = join(import.meta.dir, "..", "..");
const args = Bun.argv.slice(2);
const offline = args.includes("--offline") || process.env.STUDIO_OFFLINE === "1" || args.includes("--help");

const run = async (cmd: string[], env: Record<string, string> = {}, timeoutMs = 120_000): Promise<string> => {
  const proc = Bun.spawn(cmd, { cwd: root, env: { ...process.env, ...env }, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => proc.kill(), timeoutMs);
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  clearTimeout(timer);
  if (code !== 0) throw new Error((err.trim() || out.trim() || `exit ${code}`).split("\n").slice(-2).join(" "));
  return out;
};

let report: UpdateReport;
if (offline) report = { result: "skipped", reason: "offline", at: new Date().toISOString() };
else {
  try {
    // The key is only for a private copy; a public repository answers without one. An ssh origin ignores it.
    const token = await keychain().read("github").catch(() => null);
    const names = async (cmd: string[]) => (await run(cmd, { GIT_LITERAL_PATHSPECS: "1" })).split("\0").filter(Boolean);
    report = await selfUpdate({
      git: (a, remote) => run(["git", ...a], { GIT_LITERAL_PATHSPECS: "1", GIT_TERMINAL_PROMPT: "0", ...(remote ? authEnv(token) : {}) }, remote ? 30_000 : 60_000),
      uncommitted: async () => [...(await names(["git", "diff", "--name-only", "--no-renames", "-z", "HEAD", "--"])), ...(await names(["git", "ls-files", "--others", "--exclude-standard", "-z"]))],
      install: async () => void (await run([process.execPath, "install", "--frozen-lockfile"], {}, 180_000)),
      rebuildApp: async () => void (await run([process.execPath, join("scripts", "build-app.ts")], {}, 180_000)),
      hasApp: () => existsSync(join(root, "ROBINs Studio.app")),
    });
  } catch (error) {
    report = { result: "failed", reason: "merge", at: new Date().toISOString() };
    console.error(`update: ${error instanceof Error ? error.message : String(error)}`);
  }
}
await mkdir(dirname(reportPath(root)), { recursive: true });
await Bun.write(reportPath(root), JSON.stringify(report, null, 2) + "\n");
if (report.result === "updated") console.log(`Updated the Studio (${report.from?.slice(0, 7)} to ${report.to?.slice(0, 7)}).`);

// The server gets this process's own input and output: when the app lets go of the
// input (its lifeline), the server sees it and stops, and so does this.
const server = Bun.spawn([process.execPath, join("src", "studio", "server.ts"), ...args], { cwd: root, stdin: "inherit", stdout: "inherit", stderr: "inherit" });
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(signal, () => server.kill(signal));
process.exit(await server.exited);
