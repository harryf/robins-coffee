// Design tokens (site/data/tokens.json) to CSS custom properties, plus the contrast
// maths the tests use. Browser-safe, like the renderer.
export type Tokens = { color: Record<"night" | "day", Record<string, string>>; contrast_pairs: [string, string][]; [group: string]: any };

const vars = (prefix: string, o: Record<string, string>) => Object.entries(o).map(([k, v]) => `  --${prefix}${k}: ${v};`).join("\n");

export function tokensCss(t: Tokens): string {
  const scales = ["font", "size", "space", "radius", "motion", "layout"].map((g) => vars(`${g}-`, t[g])).join("\n");
  return `/* GENERATED from site/data/tokens.json by src/tokens.ts. Edit the JSON, not this. */
@font-face { font-family: "Alfa Slab One"; src: url("fonts/alfa-slab-one.woff2") format("woff2"); font-weight: 400; font-display: swap; }
@font-face { font-family: "DM Sans Variable"; src: url("fonts/dm-sans.woff2") format("woff2"); font-weight: 100 1000; font-display: swap; }
:root {
${vars("c-", t.color.night)}
${scales}
  color-scheme: dark;
}
:root[data-theme="day"] {
${vars("c-", t.color.day)}
  color-scheme: light;
}
/* Anything that sits on a dark photo keeps the night colours in both themes. */
.on-photo {
${vars("c-", t.color.night)}
  color: var(--c-text);
  color-scheme: dark;
}
`;
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/** WCAG contrast ratio of two #rrggbb colours. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}
