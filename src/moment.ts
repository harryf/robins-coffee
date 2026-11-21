// What a moment's text file looks like, and the limits every published photo keeps.
// Pure and browser-safe: scripts/add-photo.ts and the editor both use it.
export const MAX_EDGE = 2400;
export const JPEG_QUALITY = 84;

const yamlString = (s: string) => JSON.stringify(s);

export type MomentText = { date: string; album?: string; feed?: boolean; caption: { en: string; de: string }; alt: { en: string; de: string } };
/** A text in English and any other languages the site has; the Studio may know only some of them. */
type AnyTexts = { en: string; [lang: string]: string | undefined };

/**
 * The .md file of a moment. `feed` is written only when false; `album` only when set.
 * Each text is written in the order English, German, French, Italian, then any other
 * language; a language without a text is left out.
 */
export function momentMarkdown(m: Omit<MomentText, "caption" | "alt"> & { caption: AnyTexts; alt: AnyTexts }): string {
  const order = ["en", "de", "fr", "it"];
  const rank = (code: string) => (order.includes(code) ? order.indexOf(code) : order.length);
  const lines = (v: AnyTexts) => Object.entries(v)
    .filter(([k, x]) => k === "en" || (typeof x === "string" && x !== ""))
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([k, x]) => `  ${k}: ${yamlString(String(x ?? ""))}`);
  return [
    "---",
    `date: ${m.date}`,
    ...(m.album ? [`album: ${m.album}`] : []),
    ...(m.feed === false ? ["feed: false"] : []),
    "caption:",
    ...lines(m.caption),
    "alt:",
    ...lines(m.alt),
    "---",
    "",
  ].join("\n");
}
