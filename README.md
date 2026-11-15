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
```

## Where things are

| Path | What |
|---|---|
| `site/content/` | Pages, per language |
| `site/moments/` | The photo feed: one `.jpg` and one `.md` per post |
| `site/photos/` | Photos used by page sections |
| `site/events/` | Events written by hand; comedy shows are imported at build time and not stored |
| `site/data/` | Venue facts, opening hours, home page sections, interface words, design tokens |
| `site/templates/` | Liquid layouts, sections and components |
| `site/assets/` | CSS, the one script, logo files |
| `src/` | The generator |
| `scripts/` | Tools, for example `add-photo.ts` |
| `docs/` | [The spec](docs/spec.md), [design direction](docs/design-direction.md), decisions, the baseline of the old site |

## Add a photo

```
bun scripts/add-photo.ts ~/Desktop/photo.jpg --date 2026-11-20 --slug friday-crowd \
  --caption-en "…" --caption-de "…" --alt-en "…" --alt-de "…"
```

The copy that lands in `site/moments/` is resized and has all metadata removed. This repository is public and its history is permanent: add a photo of a person only when it may be published.

## How a change goes live

Open a pull request. CI builds and tests it and posts a preview under `/pr-preview/pr-<number>/`. Merging to `main` deploys.
