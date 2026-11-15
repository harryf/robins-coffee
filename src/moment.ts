// What a moment's text file looks like, and the limits every published photo keeps.
// Pure and browser-safe: scripts/add-photo.ts and the editor both use it.
export const MAX_EDGE = 2400;
export const JPEG_QUALITY = 84;

const yamlString = (s: string) => JSON.stringify(s);

export type MomentText = { date: string; album?: string; feed?: boolean; caption: { en: string; de: string }; alt: { en: string; de: string } };

/** The .md file of a moment. `feed` is written only when false; `album` only when set. */
export function momentMarkdown(m: MomentText): string {
  return [
    "---",
    `date: ${m.date}`,
    ...(m.album ? [`album: ${m.album}`] : []),
    ...(m.feed === false ? ["feed: false"] : []),
    "caption:",
    `  en: ${yamlString(m.caption.en)}`,
    `  de: ${yamlString(m.caption.de)}`,
    "alt:",
    `  en: ${yamlString(m.alt.en)}`,
    `  de: ${yamlString(m.alt.de)}`,
    "---",
    "",
  ].join("\n");
}
