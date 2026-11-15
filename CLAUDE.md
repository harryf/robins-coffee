# Notes for Claude working on this repository

The new robins-coffee.ch: a static site from our own generator (bun, TypeScript, Liquid), deployed to GitHub Pages from `main`. `README.md` has the lay of the land, `docs/spec.md` the plan and the milestone you are in, `docs/decisions/` the reasons.

## Commands

```
bun run build:local    # dist/ with relative links, opens from file://
bun run check          # build + tests; run before saying you are done
```

Look at the result in a real browser at desktop and 390 px, in both themes (`?theme=day`, `?theme=night`).

## Rules that bite

- **This repository is public and its history is permanent.** Never commit a photo of a person that Harry has not cleared, a phone number of a private person, a WhatsApp sender name or chat text, or any secret. Photos enter only through `scripts/add-photo.ts`, which strips metadata; never copy an original into `site/`. Stage files by name.
- **`src/render.ts` must stay pure and browser-safe**: no `fs`, no `sharp`, no `Bun.*`, no network. The editor will import it to run the real build as its preview. Disk work belongs in `src/build.ts`.
- **Every link in a template goes through the `url` or `asset` filter.** The site is served from `/robins-coffee/`, later from `/`, and from relative paths in the editor preview. A bare `/path` works in one of the three.
- **One source per fact.** Hours in `site/data/hours.yml`, venue facts in `site/data/site.yml`, labels in `site/data/i18n.yml`. Never type an address, a time or a label into a template.
- **Tokens only.** No raw colour or font name in templates or CSS outside `site/data/tokens.json`. A new colour pair that carries text goes into `contrast_pairs`. Anything placed on a dark photo gets the class `on-photo` (night colours in both themes).
- **Nothing moves for ever without a pause** (WCAG 2.2.2). The ticker has its button; any new looping motion needs the same or a finite count.
- **No review texts copied from Google Maps by hand.** Rating and hours are typed facts with a date; review texts come only through the Business Profile API (`docs/decisions/2026-11-15-google-listing.md`). Never add `Review` or `AggregateRating` structured data.
- **Both languages or neither.** A new text needs EN and DE. German uses Swiss spelling: ss, never ß.
- **The old site's facts stay.** The "content clone" test lists every fact of the 2022 page; if one really changes, change the data file and that list together.
- **Nothing invented.** Facts about the bar come from the current site, from Harry or from the owners. Unknowns go to "Open questions" in the spec.
- **Imported events are never committed.** The build fetches the comedy feed (`events_feed` in `site.yml`), merges and publishes `/events.json`. To build offline or against a test feed: `bun src/build.ts --events <file or URL>`. Event times are shown in Zürich time whatever the build machine's zone.
- **No words from `Intl`.** Date and time labels take their numbers from `wallClock()` and their words from `i18n.yml`; Intl's German names differ between the Mac and the build server, which broke CI once.
- No em dashes anywhere: copy, docs, comments, commit messages.
- Case matters on the live build; a wrongly cased path works on the Mac and 404s live.
- `main` is protected. Work on a branch, open a pull request, check the preview link, then merge. Never push to `gh-pages` by hand; only the workflows write there.
- `site.yml` has `preview: true`, which keeps the whole site out of search engines. It flips to false only in the DNS cut-over pull request.

## Adding things

| To add | Do |
|---|---|
| A photo post | `bun scripts/add-photo.ts …` (see README) |
| A photo for a page section | `bun scripts/add-photo.ts <file> --plain --slug <name>`, then name it with EN and DE alt text where it is used |
| A home page section | `site/templates/sections/<name>.liquid`, then its name in `site/data/home.yml`, then a style guide entry |
| A component | `site/templates/components/<name>.liquid` with its parameters in a top comment, plus a style guide entry in the same pull request |
| A page | `site/content/en/<slug>.md` and `site/content/de/<slug>.md` |
| An event by hand | `site/events/<date>-<slug>.md` (format in `site/events/README.md`) |
| A change to an imported event | an entry in `site/data/event-overrides.yml`; never edit the import |
| A decision | `docs/decisions/<date>-<slug>.md`, short, and update `docs/spec.md` if it changes the plan |
