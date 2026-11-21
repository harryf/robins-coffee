// Apple's Translation framework for the Studio: runs the small Swift helper in
// tools/translate.swift. It translates on this Mac only, with the language packs that are
// installed; a pack that is missing is reported, never downloaded. The texts go to the
// helper on its standard input, never on a command line. Needs a Mac with the Swift
// tools; the helper is compiled once into .cache/, like the Vision helper.
import { existsSync, statSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

/**
 * What one run gives: the translations per language (one per text, in order), the
 * languages whose pack is not installed on this Mac, and those that could not be done for
 * another reason. `note` names that reason in plain words when there is one.
 */
export type Translation = { texts: Record<string, string[]>; missing: string[]; failed: string[]; note?: string; /** The language the texts were in: the one asked for, or the one the Mac recognised for "auto". */ source?: string };
/** Translates texts from `source` (English unless said; "auto" lets the Mac recognise it) into each target language. */
export type Translator = (texts: string[], targets: string[], source?: string) => Promise<Translation>;

/** The helper's answer as a Translation. A target in the texts' own language gets the texts as they are; anything unexpected counts as failed. */
export function readAnswer(answer: unknown, texts: string[], targets: string[]): Translation {
  const a = answer && typeof answer === "object" ? (answer as Record<string, any>) : {};
  const source = typeof a.source === "string" ? a.source.slice(0, 2).toLowerCase() : undefined;
  const out: Translation = { texts: {}, missing: [], failed: [], ...(source ? { source } : {}) };
  const all = a.results && typeof a.results === "object" ? (a.results as Record<string, any>) : {};
  for (const lang of targets) {
    if (lang === source) { out.texts[lang] = [...texts]; continue; }
    const one = all[lang];
    if (one?.status === "ok" && Array.isArray(one.texts) && one.texts.length === texts.length && one.texts.every((x: unknown) => typeof x === "string")) out.texts[lang] = one.texts;
    else if (one?.status === "missing") out.missing.push(lang);
    else {
      out.failed.push(lang);
      if (one?.status === "old_mac") out.note = "old_mac";
      else if (typeof one?.error === "string" && !out.note) out.note = one.error;
    }
  }
  return out;
}

const run = async (cmd: string[], input: string | null, timeoutMs: number) => {
  const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe", stdin: input === null ? "ignore" : "pipe" });
  if (input !== null && p.stdin) { p.stdin.write(input); await p.stdin.end(); }
  const timer = setTimeout(() => p.kill(), timeoutMs);
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  clearTimeout(timer);
  return { out, err, code };
};

/** The compiled helper, built when it is missing or older than its source. Throws with a plain reason when it cannot be built. */
export async function translateTool(root: string): Promise<string> {
  const source = join(root, "tools", "translate.swift"), bin = join(root, ".cache", "translate");
  if (process.platform !== "darwin") throw new Error("Translating needs a Mac.");
  if (existsSync(bin) && statSync(bin).mtimeMs >= statSync(source).mtimeMs) return bin;
  if (!Bun.which("swiftc")) throw new Error("The Swift tools are missing. Install them with: xcode-select --install");
  await mkdir(join(root, ".cache"), { recursive: true });
  const { code, err } = await run(["swiftc", "-O", source, "-o", bin], null, 180_000);
  if (code !== 0) throw new Error(`The translation helper could not be built: ${err.trim().split("\n").at(-1) ?? "unknown reason"}`);
  return bin;
}

/** The real translator of this Mac, for the repository at `root`. With no texts it only says which packs are installed. */
export function appleTranslator(root: string): Translator {
  return async (texts, targets, source = "en") => {
    const wanted = targets.filter((t) => t !== source);
    if (!wanted.length) return { texts: {}, missing: [], failed: [], source };
    const { code, out, err } = await run([await translateTool(root)], JSON.stringify({ source, targets: wanted, texts }), 120_000);
    if (code !== 0) throw new Error(err.trim() || "The texts could not be translated.");
    return readAnswer(JSON.parse(out), texts, wanted);
  };
}

// Run by hand: bun src/translate.ts de fr it < texts.json (a JSON list of English texts).
if (import.meta.main) {
  const targets = process.argv.slice(2);
  if (!targets.length || targets.includes("--help")) {
    console.log("usage: bun src/translate.ts <lang> [<lang>...] < texts.json\nTranslates a JSON list of English texts on this Mac and prints the result as JSON.");
    process.exit(targets.includes("--help") ? 0 : 2);
  }
  const texts = JSON.parse(await Bun.stdin.text());
  console.log(JSON.stringify(await appleTranslator(join(import.meta.dir, ".."))(texts, targets), null, 2));
}
