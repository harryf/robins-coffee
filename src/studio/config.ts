// The one setting that lives outside every copy of the site: which folder the Mac app
// edits. It is a small file in the person's Library, read by the app when it starts
// (app/Studio.swift reads the same file) and written from the Settings screen.
import { existsSync, statSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

/** Where the setting is kept. STUDIO_CONFIG moves it, for tests. */
export const configPath = (env: Record<string, string | undefined> = process.env) => env.STUDIO_CONFIG || join(homedir(), "Library", "Application Support", "ROBINs Studio", "config.json");

/** `folder`: the copy of the site the app edits. `app`: where the app itself is, when the installer put it outside that folder. */
export type Config = { folder?: string; app?: string };

export async function readConfig(path = configPath()): Promise<Config> {
  try {
    const data = JSON.parse(await Bun.file(path).text());
    return { ...(typeof data?.folder === "string" ? { folder: data.folder } : {}), ...(typeof data?.app === "string" ? { app: data.app } : {}) };
  } catch {
    return {};
  }
}

/** Why a folder cannot be the Studio's folder, as a key the screen translates; null when it can. */
export function folderProblem(folder: unknown): string | null {
  if (typeof folder !== "string" || !folder.trim()) return "folder_missing";
  const path = folder.trim().replace(/^~(?=\/|$)/, homedir());
  if (!isAbsolute(path) || path.includes("\0")) return "folder_not_full";
  if (!existsSync(path) || !statSync(path).isDirectory()) return "folder_not_there";
  // A copy of the site: its data, the Studio's own code, and git underneath.
  if (!existsSync(join(path, "site", "data", "site.yml")) || !existsSync(join(path, "src", "studio", "launch.ts"))) return "folder_not_site";
  if (!existsSync(join(path, ".git"))) return "folder_not_git";
  if (!existsSync(join(path, "node_modules"))) return "folder_not_installed";
  return null;
}

/** Save the folder; throws the problem key when it cannot be one. Returns the path as saved. */
export async function saveFolder(folder: string, path = configPath()): Promise<string> {
  const problem = folderProblem(folder);
  if (problem) throw new Error(problem);
  const full = resolve(folder.trim().replace(/^~(?=\/|$)/, homedir()));
  await mkdir(dirname(path), { recursive: true });
  // Whatever else the file holds (where the app is) stays.
  await Bun.write(path, JSON.stringify({ ...(await readConfig(path)), folder: full }, null, 2) + "\n");
  return full;
}
