# Notes for Claude working on this repository

The new robins-coffee.ch: a static site from our own generator (bun, TypeScript, Liquid), deployed to GitHub Pages from `main`. `README.md` has the lay of the land, `docs/spec.md` the plan and the milestone you are in, `docs/decisions/` the reasons.

## Commands

```
bun run build:local    # dist/ with relative links, opens from file://
bun run check          # build + link check + tests; run before saying you are done
```

Look at the result in a real browser at desktop and 390 px, in both themes (`?theme=day`, `?theme=night`, or the cup and cocktail switch in the header).

## Rules that bite

- **This repository is public and its history is permanent.** Never commit a photo of a person that Harry has not cleared, a phone number of a private person, a WhatsApp sender name or chat text, or any secret. Photos enter only through `scripts/add-photo.ts`, `scripts/import-selection.ts` or the Studio (which uses `cleanPhoto` from `scripts/add-photo.ts`); all three strip metadata. Never copy an original into `site/`. Stage files by name.
- **`inbox/` is local and gitignored.** The review page, the chat id and the record of which WhatsApp message became which file live there. No message id, chat id or sender detail goes into a tracked file, a commit message or a pull request.
- **No moment merges with `TODO` in it.** The import writes `TODO` for every caption and alt text the owner did not write; a test fails until each is replaced in EN and DE.
- **`src/render.ts` must stay pure and browser-safe**: no `fs`, no `sharp`, no `Bun.*`, no network. Keep it that way, so the same build can run in any preview. Disk work belongs in `src/build.ts`.
- **Every link in a template goes through the `url` or `asset` filter.** The site is served from `/robins-coffee/`, later from `/`, and from relative paths (`build:local`). A bare `/path` works in one of the three.
- **One source per fact.** Hours in `site/data/hours.yml`, venue facts in `site/data/site.yml`, labels in `site/data/i18n.yml`. Never type an address, a time or a label into a template.
- **Tokens only.** No raw colour or font name in templates or CSS outside `site/data/tokens.json`. The same holds for font size, weight, line height, tracking, margin, padding, gap, border, radius, shadow, z-index, durations, text measures and media query breakpoints: tests fail on a typed value. Plain numbers are fine for one component's own geometry (width, height, columns, transforms). No `style=` in a template outside the style guide. A new colour pair that carries text goes into `contrast_pairs`. Anything placed on a dark photo gets the class `on-photo` (light on dark whatever the theme; `src/tokens.ts` works out what that takes).
- **Every published photo is a moment.** The feed and the gallery read the same files; an album is `album: <slug>` plus a line in `site/data/albums.yml`, and `feed: false` keeps a photo in the gallery only.
- **Nothing moves for ever without a pause** (WCAG 2.2.2). The whole ticker is a button without a visible mark: a tap or Enter pauses it. It is the one thing that keeps moving with "reduce motion" on (Harry's decision, 16 Nov 2026). Any new looping motion needs a pause too, or a finite count.
- **No review texts copied from Google Maps by hand.** Rating and hours are typed facts with a date; review texts come only through the Business Profile API (`docs/decisions/2026-11-15-google-listing.md`). Never add `Review` or `AggregateRating` structured data.
- **English first, then German, French and Italian** (`languages` in `site.yml`; English lives at `/`, the others under `/de/`, `/fr/`, `/it/`). Every interface word in `i18n.yml` and every listed page in `site/content/` exists in all four (tests check). A content text (caption, alt, menu, album, event) needs English; another language may be missing and the page then shows the English. The Studio writes the other three with Apple's Translation framework on the bar's Mac. German uses Swiss spelling: ss, never ß. French and Italian page copy was written by Claude and still wants a native reader.
- **The language a visitor sees**: a first visit to an English page moves to the browser's first language the site has (head script in `base.liquid`); a language picked in the header menu is kept in `localStorage` and wins. A page in another language never moves anyone.
- **Tests of the code never read the live content.** They run on the frozen copy in `test/fixture/site/` (through `test/frozen.ts`), because the bar changes `site/` every week and a test that counts today's albums stops such a change from going live. What must hold for any content is in `test/live-content.test.ts`, which may not count things or name a caption, a price or a time. A label or page field that a template needs goes into `site/` and the frozen copy together.
- **The old site's facts stay.** The "content clone" test lists every fact of the 2022 page and runs on the frozen copy, so it guards the templates, not what the bar types later.
- **Nothing invented.** Facts about the bar come from the current site, from Harry or from the owners. Unknowns go to "Open questions" in the spec.
- **Nothing invented about an event either.** A poster without a time gives an event without a time (`date` without `from`): the card shows the day only.
- **Imported events are never committed.** The build fetches the comedy feed (`events_feed` in `site.yml`), merges and publishes `/events.json`. To build offline or against a test feed: `bun src/build.ts --events <file or URL>`. Event times are shown in Zürich time whatever the build machine's zone.
- **No words from `Intl`.** Date and time labels take their numbers from `wallClock()` and their words from `i18n.yml`; Intl's German names differ between the Mac and the build server, which broke CI once.
- **The link check must pass.** `scripts/check-links.ts` runs in CI over the built site and fails on a missing file, a wrong case, a missing anchor, a path outside the base or a link relative to its page. `404.html` is shown at any address, which is why relative links are refused.
- **A page that must not be listed** (style guide, 404) carries `noindex: true`; the sitemap leaves it out. A page that is listed needs all four languages; a test checks. The Studio install page is for the bar and stays English and German.
- **What an `edit/...` branch may touch is `inEditScope` in `src/scope.ts`**, a file that must import nothing: CI runs the base branch's copy (`scripts/check-edit-scope.ts`) before installing anything.
- **The phone editor at `/edit/` is retired** (21 Nov 2026). `/edit/` is a note pointing to the Studio and `/edit/sw.js` (`src/retired-editor-sw.js`) unregisters itself on phones that installed the editor. Keep both; do not bring the editor back.
- **The Studio (`src/studio/`) is a local server, and only that.** It listens on 127.0.0.1, every API request needs the per-run token and its own Host and Origin, and the preview is served under another origin (`localhost`) so a built page can never reach the API. It writes only paths inside `inEditScope`, built from checked slugs under fixed folders. Keys live in the macOS Keychain: never in a file, a URL, a command line or a log. Publish pushes only an `edit/...` branch. Rules that can be decided without a screen live in `src/content.ts`, `src/eventfrog.ts`, `src/focus.ts`, `describe.ts`, `publish.ts` and `guard.ts` and are tested; `ui/` only draws, and every word on the screen is in `src/studio/strings.ts`, in English. Texts for the site are typed in English; `tools/translate.swift` (Apple's Translation framework, macOS 26, on the Mac only, never a web service) writes the other languages of `site.yml` on save, through `src/translate.ts`. A language whose pack is not installed is left out and the site shows English. Tests use `test/fake-translate.ts`.
- **The Studio's history lists content changes only**: a commit of `main` is a row when every file it touched is inside `inEditScope` (`src/studio/history.ts`). So keep a content change and a code change in separate commits if the bar should see the first. A restore may still go back to any commit of `main` that touched content.
- **The Studio updates itself at start** (`src/studio/launch.ts`, `update.ts`): it fast-forwards its folder to the newest `main` of the folder's own `origin`, never from an address in a content file, never on another branch, never over a local change to the same file. So whatever lands on `main` under `src/studio/`, `app/` or `package.json` runs on the bar's Mac at its next start: treat a merge there as a release. A change to the Studio raises `version` in `src/studio/version.json`.
- **`scripts/install-studio.sh` is run straight from `main` by people who are not developers** (the line on `/studio/`). It must stay safe to run twice, ask for no password, never use `sudo`, and fetch only from GitHub and bun.sh; a test checks. The line printed on the page and the one in the script's header are the same text; change them together, in both languages.
- **Eventfrog is fetched only from its own https hosts**, pictures included, and an import becomes an ordinary event file with its `source_url`. The comedy feed stays a build time import.
- **A photo's cut is a focus point**, not a second file: `site/data/focus.yml`, found by Apple Vision in the Studio (`tools/vision.swift`) or typed by hand. An alt text from Vision is a draft; a person finishes it.
- No em dashes anywhere: copy, docs, comments, commit messages.
- Case matters on the live build; a wrongly cased path works on the Mac and 404s live.
- `main` is protected. Work on a branch, open a pull request, check the preview link, then merge. Never push to `gh-pages` by hand; only the workflows write there.
- `site.yml` has `preview: true`, which keeps the whole site out of search engines. It flips to false only in the DNS cut-over pull request.

## Adding things

| To add | Do |
|---|---|
| A photo post | `bun scripts/add-photo.ts …` (see README); `--album <slug>` and `--gallery-only` are optional |
| A batch of photos from the group | `bun scripts/review-photos.ts`, tick and save on `inbox/review.html`, `bun scripts/import-selection.ts <robins-selection.json>`, then replace every `TODO` (see README) |
| An album | An entry in `site/data/albums.yml` (slug, title in English and any of de, fr, it; optional cover), then `album: <slug>` on its moments |
| A photo for a page section | `bun scripts/add-photo.ts <file> --plain --slug <name>`, then name it with alt text in all four languages where it is used |
| A home page section | `site/templates/sections/<name>.liquid`, then its name in both lists of `site/data/home.yml` (`sections` is the night order, `sections_day` the day order; the page script moves them by the clock), then a style guide entry |
| A kind of guest on the home page | A card under `guests:` in both `content/<lang>/index.md` with the same `key`, and the key in `guests_day` in `home.yml`; the build stops when they differ |
| A component | `site/templates/components/<name>.liquid` with its parameters in a top comment (the style guide prints it), plus its example in the `case` block of `layouts/styleguide.liquid`; a test fails without both |
| A token | A line in `site/data/tokens.json`; it becomes `--<group>-<name>` and appears in the style guide by itself |
| A page | `site/content/en/<slug>.md` and `site/content/de/<slug>.md`; `og_photo:` picks its link preview picture, `permalink:` names its output file (only 404 uses it) |
| An event by hand | `site/events/<name>.md` (format in `site/events/README.md`): one evening, a list of dates or a weekly evening; picture, short text (English, other languages optional) and ticket link are optional, and without a link the card says people can just come |
| A drink on the menu | An entry in `site/data/menu.yml` (name, text in English plus any of de, fr, it, price, optional `photo` added with `--plain --slug menu-<name>` plus alt text) |
| A change to an imported event | an entry in `site/data/event-overrides.yml`; never edit the import |
| A form in the Studio | A route in `src/studio/content-api.ts` with its rules in `src/content.ts` and tests, a section in `src/studio/ui/content.ts`, its words in `src/studio/strings.ts` (English only: the Studio's screens are English), its texts through `english()` in `ui/content.ts` so the Mac translates them, and its phrase in `src/studio/describe.ts` |
| Where a photo is cut | A line in `site/data/focus.yml`: `"photos/<name>.jpg": [across, down]`, both from 0 to 1 |
| A decision | `docs/decisions/<date>-<slug>.md`, short, and update `docs/spec.md` if it changes the plan |
