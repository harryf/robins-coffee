# ROBIN's Bar & Coffee website

The new site for [robins-coffee.ch](https://robins-coffee.ch/), a coffee bar and cocktail bar at Zähringerstrasse 33 in Zürich's Old Town. Preview: <https://harryf.github.io/robins-coffee/>.

A static site built by a small generator in this repository (bun, TypeScript, Liquid templates), deployed to GitHub Pages. A browser editor for the bar staff comes later and will use the same renderer for its preview.

## Run it

You need [bun](https://bun.sh).

```
bun install
bun run build          # writes dist/ for the domain root
bun run build:local    # same, with relative links: open dist/index.html from disk
bun test
bun run check          # build, link check and tests in one go
```

The build also writes what a visitor never sees as a page: `404.html`, `sitemap.xml`, `robots.txt`, the favicons and the 1200 x 630 link preview pictures in `og/`. A page shows the hero photo in link previews unless its front matter names another with `og_photo: moments/<file>.jpg`.

## Where things are

| Path | What |
|---|---|
| `site/content/` | Pages, per language |
| `site/moments/` | Every published photo (home feed and gallery): one `.jpg` and one `.md` each |
| `site/photos/` | Photos used by page sections |
| `site/events/` | Events written by hand; comedy shows are imported at build time and not stored |
| `site/data/` | Venue facts, opening hours, home page sections, gallery albums, interface words, design tokens |
| `site/templates/` | Liquid layouts, sections and components |
| `site/assets/` | CSS, the one script, logo files |
| `src/` | The generator; `src/editor/` is the editor |
| `scripts/` | Tools: `add-photo.ts`, `review-photos.ts`, `import-selection.ts`, `check-links.ts`, `check-edit-scope.ts` |
| `inbox/` | Local only, not in git: the photo review page and its records |
| `docs/` | [The spec](docs/spec.md), [design direction](docs/design-direction.md), decisions, the baseline of the old site |

## Add a photo

```
bun scripts/add-photo.ts ~/Desktop/photo.jpg --date 2026-11-20 --slug friday-crowd \
  --caption-en "…" --caption-de "…" --alt-en "…" --alt-de "…"
```

The copy that lands in `site/moments/` is resized and has all metadata removed. This repository is public and its history is permanent: add a photo of a person only when it may be published.

Add `--album <slug>` to put it in a gallery album (the slugs are in `site/data/albums.yml`) and `--gallery-only` to keep it out of the home feed.

## Add a batch of photos from the bar's group

This needs the WhatsApp explorer running on the same Mac (`bun start` in its folder).

```
bun scripts/review-photos.ts --chat <id>        # the id is only needed the first time
open inbox/review.html                          # tick, pick albums, "Save selection"
bun scripts/import-selection.ts ~/Downloads/robins-selection.json --dry-run
bun scripts/import-selection.ts ~/Downloads/robins-selection.json
```

The import writes one moment per photo with `TODO` wherever a caption or alt text is missing. Replace every `TODO` in English and German, then run `bun run check`; the tests fail while one is left. `--days 30` changes how far back the review page looks (default 90).

Everything under `inbox/` stays on the Mac: the review page, the chat id and the list of what was imported.

## Albums

`site/data/albums.yml` lists the gallery albums: a slug, a title in English and German, and optionally `cover: <moment id>` for the photo shown first. A moment joins an album with `album: <slug>` in its front matter. `feed: false` keeps a moment in the gallery and out of the home feed.

## The editor

`/edit/` on the site is the editor for the people who run the bar: post a photo, change the opening hours, see the real page with the change, send it. It can be added to a phone's home screen, speaks English and German, and keeps an unsent change on the device. Looking and trying needs no login. Sending needs a key from GitHub, pasted once; "Set up this device" walks through it. A sent change is a pull request on a branch named `edit/...`. It shows up in the other person's inbox in the editor, with a yes (approve and publish) and a no (it stays open for Harry on GitHub).

The editor's version is in `src/editor/version.json`. Raise `version` with every change to the editor. An open editor notices a new build and offers "Update now"; raise `min_supported` only when an older editor must not send any more.

The code is in `src/editor/` and is bundled by the normal build into `dist/edit/`. It does not run from a file on disk (`build:local`); use a pull request preview to try it, or `bun run build` and any static file server on `dist/`. Why it works this way: [sign-in](docs/decisions/2026-11-16-editor-login.md), [inbox, versions and drafts](docs/decisions/2026-11-16-editor-inbox-updates.md).

## How a change goes live

Open a pull request. CI builds it, tests it, checks every link in the built site (pages, anchors, images, upper and lower case) and posts a preview under `/pr-preview/pr-<number>/`. Merging to `main` deploys.
