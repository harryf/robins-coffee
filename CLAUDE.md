# Notes for Claude working on this repository

The new robins-coffee.ch: a static site from our own generator (bun, TypeScript, Liquid), deployed to GitHub Pages from `main`. `README.md` has the lay of the land, `docs/spec.md` the plan and the milestone you are in, `docs/decisions/` the reasons.

## Commands

```
bun run build:local    # dist/ with relative links, opens from file://
bun run check          # build + link check + tests; run before saying you are done
```

Look at the result in a real browser at desktop and 390 px, in both themes (`?theme=day`, `?theme=night`, or the cup and cocktail switch in the header).

## Rules that bite

- **This repository is public and its history is permanent.** Never commit a photo of a person that Harry has not cleared, a phone number of a private person, a WhatsApp sender name or chat text, or any secret. Photos enter only through `scripts/add-photo.ts`, `scripts/import-selection.ts` or the editor (`src/editor/photo.ts` redraws them on a canvas); all three strip metadata. Never copy an original into `site/`. Stage files by name.
- **`inbox/` is local and gitignored.** The review page, the chat id and the record of which WhatsApp message became which file live there. No message id, chat id or sender detail goes into a tracked file, a commit message or a pull request.
- **No moment merges with `TODO` in it.** The import writes `TODO` for every caption and alt text the owner did not write; a test fails until each is replaced in EN and DE.
- **`src/render.ts` must stay pure and browser-safe**: no `fs`, no `sharp`, no `Bun.*`, no network. The editor will import it to run the real build as its preview. Disk work belongs in `src/build.ts`.
- **Every link in a template goes through the `url` or `asset` filter.** The site is served from `/robins-coffee/`, later from `/`, and from relative paths in the editor preview. A bare `/path` works in one of the three.
- **One source per fact.** Hours in `site/data/hours.yml`, venue facts in `site/data/site.yml`, labels in `site/data/i18n.yml`. Never type an address, a time or a label into a template.
- **Tokens only.** No raw colour or font name in templates or CSS outside `site/data/tokens.json`. The same holds for font size, weight, line height, tracking, margin, padding, gap, border, radius, shadow, z-index, durations, text measures and media query breakpoints: tests fail on a typed value. Plain numbers are fine for one component's own geometry (width, height, columns, transforms). No `style=` in a template outside the style guide. A new colour pair that carries text goes into `contrast_pairs`. Anything placed on a dark photo gets the class `on-photo` (light on dark whatever the theme; `src/tokens.ts` works out what that takes).
- **Every published photo is a moment.** The feed and the gallery read the same files; an album is `album: <slug>` plus a line in `site/data/albums.yml`, and `feed: false` keeps a photo in the gallery only.
- **Nothing moves for ever without a pause** (WCAG 2.2.2). The whole ticker is a button without a visible mark: a tap or Enter pauses it. It is the one thing that keeps moving with "reduce motion" on (Harry's decision, 16 Nov 2026). Any new looping motion needs a pause too, or a finite count.
- **No review texts copied from Google Maps by hand.** Rating and hours are typed facts with a date; review texts come only through the Business Profile API (`docs/decisions/2026-11-15-google-listing.md`). Never add `Review` or `AggregateRating` structured data.
- **Both languages or neither.** A new text needs EN and DE. German uses Swiss spelling: ss, never ß.
- **The old site's facts stay.** The "content clone" test lists every fact of the 2022 page; if one really changes, change the data file and that list together.
- **Nothing invented.** Facts about the bar come from the current site, from Harry or from the owners. Unknowns go to "Open questions" in the spec.
- **Nothing invented about an event either.** A poster without a time gives an event without a time (`date` without `from`): the card shows the day only.
- **Imported events are never committed.** The build fetches the comedy feed (`events_feed` in `site.yml`), merges and publishes `/events.json`. To build offline or against a test feed: `bun src/build.ts --events <file or URL>`. Event times are shown in Zürich time whatever the build machine's zone.
- **No words from `Intl`.** Date and time labels take their numbers from `wallClock()` and their words from `i18n.yml`; Intl's German names differ between the Mac and the build server, which broke CI once.
- **The link check must pass.** `scripts/check-links.ts` runs in CI over the built site and fails on a missing file, a wrong case, a missing anchor, a path outside the base or a link relative to its page. `404.html` is shown at any address, which is why relative links are refused.
- **A page that must not be listed** (style guide, 404) carries `noindex: true`; the sitemap leaves it out. A page that is listed needs both languages; a test checks.
- **The editor (`src/editor/`) has no server.** It talks only to `api.github.com`, with the person's own token in the Authorization header, and only ever creates an `edit/...` branch and a pull request. Rules that can be decided without a screen live in `changes.ts`, `github.ts` and `version.ts` and are tested; `main.ts` only draws. Every word on a screen is in `strings.ts`, English and German. A change to the editor raises `version` in `src/editor/version.json`. The draft is changed only through `setDraft`, which keeps the device's copy in step. What an editor change may touch is `inEditScope` in `scope.ts`, a file that must import nothing (CI runs the base branch's copy before installing). The preview frame stays sandboxed without `allow-same-origin`. Never log the token, never put it in a URL.
- **The Studio (`src/studio/`) is a local server, and only that.** It listens on 127.0.0.1, every API request needs the per-run token and its own Host and Origin, and the preview is served under another origin (`localhost`) so a built page can never reach the API. It writes only paths inside `inEditScope`, built from checked slugs under fixed folders. Keys live in the macOS Keychain: never in a file, a URL, a command line or a log. Publish pushes only an `edit/...` branch. Rules that can be decided without a screen live in `src/content.ts`, `src/eventfrog.ts`, `src/focus.ts`, `describe.ts`, `publish.ts` and `guard.ts` and are tested; `ui/` only draws, and every word on the screen is in `src/studio/strings.ts`, English and German.
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
| An album | An entry in `site/data/albums.yml` (slug, title in EN and DE, optional cover), then `album: <slug>` on its moments |
| A photo for a page section | `bun scripts/add-photo.ts <file> --plain --slug <name>`, then name it with EN and DE alt text where it is used |
| A home page section | `site/templates/sections/<name>.liquid`, then its name in `site/data/home.yml`, then a style guide entry |
| A component | `site/templates/components/<name>.liquid` with its parameters in a top comment (the style guide prints it), plus its example in the `case` block of `layouts/styleguide.liquid`; a test fails without both |
| A token | A line in `site/data/tokens.json`; it becomes `--<group>-<name>` and appears in the style guide by itself |
| A page | `site/content/en/<slug>.md` and `site/content/de/<slug>.md`; `og_photo:` picks its link preview picture, `permalink:` names its output file (only 404 uses it) |
| An event by hand | `site/events/<name>.md` (format in `site/events/README.md`): one evening, a list of dates or a weekly evening; picture, short text in EN and DE and ticket link are optional, and without a link the card says people can just come |
| A drink on the menu | An entry in `site/data/menu.yml` (name, text in EN and DE, price, optional `photo` added with `--plain --slug menu-<name>` plus alt text in EN and DE) |
| A change to an imported event | an entry in `site/data/event-overrides.yml`; never edit the import |
| Something the editor can change | A form in `src/editor/main.ts`, its rules and file writing in `src/editor/changes.ts` with tests, and the path inside `inEditScope` |
| A form in the Studio | A route in `src/studio/content-api.ts` with its rules in `src/content.ts` and tests, a section in `src/studio/ui/content.ts`, its words in `src/studio/strings.ts` (EN and DE), and its phrase in `src/studio/describe.ts` |
| Where a photo is cut | A line in `site/data/focus.yml`: `"photos/<name>.jpg": [across, down]`, both from 0 to 1 |
| A decision | `docs/decisions/<date>-<slug>.md`, short, and update `docs/spec.md` if it changes the plan |
