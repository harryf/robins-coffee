// Translators for tests: no Swift runs. The fake writes "[de] text" for each language;
// `missing` languages are reported as having no pack, like a Mac where they are not
// installed. A source of "auto" is taken to be English.
import type { Translator } from "../src/translate";

export function fakeTranslator(missing: string[] = [], asked: { texts: string[]; targets: string[]; source: string }[] = []): Translator {
  return async (texts, targets, source = "en") => {
    asked.push({ texts: [...texts], targets: [...targets], source });
    const from = source === "auto" ? "en" : source;
    const done = targets.filter((l) => !missing.includes(l));
    return { texts: Object.fromEntries(done.map((l) => [l, texts.map((x) => (l === from ? x : `[${l}] ${x}`))])), missing: targets.filter((l) => missing.includes(l)), failed: [], source: from };
  };
}
