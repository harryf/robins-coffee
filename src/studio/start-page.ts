// The Mac app's start screen: what the window shows from the moment it opens until the
// Studio's own screen loads. scripts/build-app.ts writes it into the bundle with the logo
// and the two fonts beside it, so it shows with no server. Night colours and type come
// from the site's tokens; the words from src/studio/strings.ts.
//
// The app moves the status line with one call, studioStep("<name>"), and only for a name
// made of a to z. The page shows its own words for a name it knows and ignores any other.
import { tokensCss, type Tokens } from "../tokens";
import type { Strings } from "./strings";
import { STEPS, type StartStep } from "./startup";

export const START_PAGE = "index.html";
export const START_LOGO = "logo.png";
/** Where the page finds its fonts: the same names tokensCss asks for. */
export const START_FONTS: Record<string, string> = {
  "alfa-slab-one.woff2": "@fontsource/alfa-slab-one/files/alfa-slab-one-latin-400-normal.woff2",
  "dm-sans.woff2": "@fontsource-variable/dm-sans/files/dm-sans-latin-wght-normal.woff2",
};

export const startWords = (t: Strings): Record<StartStep, string> => ({
  checking: t.start_checking,
  installing: t.start_installing,
  rebuilding: t.start_rebuilding,
  starting: t.start_starting,
});

const html = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const CSS = `
html, body { margin: 0; height: 100%; }
body { display: grid; place-items: center; background: var(--c-bg); color: var(--c-text); font-family: var(--font-body); font-size: var(--size-md); line-height: var(--leading-body); -webkit-user-select: none; user-select: none; cursor: default; }
.start { display: grid; justify-items: center; gap: var(--space-6); padding: var(--space-8) var(--space-4); text-align: center; }
.start__logo { width: 160px; height: 160px; object-fit: contain; }
.start__name { margin: 0; font-family: var(--font-display); font-size: var(--size-xxl); font-weight: var(--weight-regular); line-height: var(--leading-display); letter-spacing: var(--tracking-display); }
.start__step { margin: 0; min-height: calc(var(--size-md) * 2); color: var(--c-muted); font-size: var(--size-md); }
`;

export function startPage(tokens: Tokens, t: Strings): string {
  const words = startWords(t);
  // JSON inside a script: "<" written as < so no text can end the script element.
  const data = JSON.stringify(Object.fromEntries(STEPS.map((s) => [s, words[s]]))).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' file:; font-src 'self' file:; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<title>${html(t.app_name)}</title>
<style>
${tokensCss(tokens)}
${CSS}
</style>
</head>
<body>
<main class="start">
<img class="start__logo" src="${START_LOGO}" alt="" width="160" height="160">
<h1 class="start__name">${html(t.app_name)}</h1>
<p class="start__step" id="step" role="status" aria-live="polite">${html(words.checking)}</p>
</main>
<script>
(() => {
  const WORDS = ${data};
  const line = document.getElementById("step");
  window.studioStep = (name) => {
    if (typeof name === "string" && Object.prototype.hasOwnProperty.call(WORDS, name)) line.textContent = WORDS[name];
  };
})();
</script>
</body>
</html>
`;
}
