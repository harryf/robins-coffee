# ROBIN's Coffee website and editor: project spec (v2)

15 Nov 2026. Replaces the first draft, kept unchanged in `archive/spec-v1-2026-11-15.md`.
What changed and why: `decisions/2026-11-15-plan-changes.md`.

## 1. What we are building

We rebuild robins-coffee.ch as a static site in `github.com/harryf/robins-coffee`, give it a look taken from the room itself, keep it alive with a feed of photos and events, and then add a browser editor (a PWA) so bar staff can change content through reviewed pull requests.

Goals:

- A fast, phone-first site that keeps ROBIN's identity and every fact on the current site.
- A site that looks alive: new photos and events land on the home page the day they are posted, and adding a whole new section is a small change.
- One events calendar that blends ROBIN's own events with IN YOUR FACE Comedy shows at the bar.
- A documented design system that the site and the editor share.
- An editor that shows the real page before anything is published, on a phone, with no installation.
- `main` is the only deploy branch and is protected.
- Later: the same data files feed the Google Business Profile (hours first, then photos and the menu).

Not in scope: a server-side CMS or database, ticket sales (they stay on Eventfrog), a native app, a menu page (for now), venue hire copy (for now).

## 2. Stages

| Stage | Delivers | Done when |
|---|---|---|
| 1. Site | All current content, the new design, moments feed, events, gallery, German | Live on GitHub Pages and checked against the current site |
| 2. Design system | Tokens, components and a living style guide | Every page is built only from documented components |
| 3. Editor PWA | Login, edit, exact preview, pull request, review, self-update | Elias publishes a change from his phone without opening github.com |
| 4. Handover | Approver list, editor guide, DNS cut-over | robins-coffee.ch serves the new site |
| 5. Google | Hours, then photos and menu, written to the Business Profile from the repo | A change to `hours.yml` shows on Google without anyone opening Business Profile Manager |

## 3. The current site (baseline, captured 15 Nov 2026)

One WordPress page on a generic theme (its contact icons are still named `funeralhome-contact-icon`). Black background, gold `#d9c07e` headings in Cinzel, body in PT Serif at 14 px.

Content, all of it:

- Logo: white slab-serif "ROBIN'S coffee" wordmark and a white "R" mark over a photo of a patterned espresso cup.
- Two sentences: founded 2022 by Dennis Cobarrubias and the Sallahi family; a coffee bar for coffee and cocktails in the Old Town.
- Four photos (Instagram exports from August 2022): a barista at the machine, three shots of patterned cups.
- Contact form: name, phone, mail, message (Contact Form 7, Italian locale).
- Address Zähringerstrasse 33, 8001 Zürich, with a Google Maps link.
- Hours: Mon to Fri 16:00 until late, Sat and Sun 10:00 until late.
- Phone and email.

No menu, no events, no social links, no structured data, mixed German and English labels. Originals of the logo and the four photos are in `baseline/assets/`.

## 4. Design direction: "neon over wood"

The first draft planned style tiles before any page. We skipped that: the photos from the bar already answer the question. The room at night is pink and violet light over warm amber shelves, dark wood and green cabinets, with a chalk-white wall of hand lettering. The logo is a heavy slab serif inside a patterned roundel that matches the espresso cups. The site takes all of that and drops the black and gold of the old theme, which belongs to no part of the room.

- **Colour.** Night: aubergine black, neon pink as the one loud colour, violet and amber as support, cream text. Day: the same hues on cream. Pink is the brand's light, used for the headline, the main button and the ticker, never for body text.
- **Day and night.** The page follows the Zürich clock: a cream day theme from 06:00 to 17:00, the night theme otherwise. `?theme=day` or `?theme=night` pins one. Without JavaScript the page is night.
- **Type.** Alfa Slab One for headings (close to the logo's slab), DM Sans for text. Both self-hosted, two families only.
- **Signs of life.** An "open now" pill worked out from `hours.yml`; a headline that lights up like the sign; a slow ticker; the roundel turning slowly; the newest photos first on the home page. All motion stops under `prefers-reduced-motion`.
- **Photography first.** Real photos from the bar lead every page. No stock, no illustrations.

Open design work is listed in `design-direction.md`.

## 5. Architecture

Everything lives in one public repository and deploys to GitHub Pages. The only piece outside GitHub will be one small Cloudflare Worker for the editor login (and, if we keep a contact form, for sending its mail).

**The generator is ours: bun, TypeScript and Liquid templates.** About 400 lines.

- `src/render.ts` turns content, data and templates into HTML. It is pure and runs in a browser as well as in bun: no file system, no Node APIs.
- `src/build.ts` does what needs a disk: reads `site/`, resizes photos with sharp, copies assets, writes `dist/`.
- The editor imports `src/render.ts` and runs it on the repository's files plus the editor's unsaved changes. The preview is the real build.

Why not Hugo, as first planned: a browser cannot run Hugo. The first draft needed three preview layers to work around that (JavaScript copies of the templates with a parity test, pull request previews, and a Mac helper that only works in Chrome). One renderer that runs in both places removes all three problems. Liquid is the template language of the comedy site, so includes and habits carry over.

**Hosting and deploy**

- GitHub Pages, first at `harryf.github.io/robins-coffee/`, later on robins-coffee.ch. Templates never write a bare path: every link goes through the `url` filter, so the sub-path, the domain and a relative build (`--base relative`, for `file://` and the editor preview) all work.
- `deploy.yml` builds every push to `main` and publishes to the `gh-pages` branch.
- `preview.yml` builds every pull request into `/pr-preview/pr-<number>/` and removes it when the pull request closes. Approvers review that link.
- While `preview: true` in `site/data/site.yml`, every page is `noindex` and `robots.txt` disallows everything, so the preview never competes with the live site. The cut-over pull request flips it.

**Repository layout**

```
robins-coffee/
  site/                  everything an editor may touch
    content/<lang>/      pages: Markdown with front matter
    moments/             the photo feed: <date>-<slug>.jpg + .md
    data/                site.yml, hours.yml, home.yml, i18n.yml, tokens.json
    templates/           layouts/, sections/, components/ (Liquid)
    assets/              css/, js/, brand/
  src/                   the generator: render.ts (pure), build.ts, tokens.ts
  scripts/               one-off and scheduled tools (add-photo.ts, later fetch-events.ts)
  editor/                the PWA (stage 3)
  test/                  bun tests
  docs/                  spec, design direction, decisions, baseline, archive
  .github/               workflows, CODEOWNERS
```

**Commands.** `bun run build` (into `dist/`), `bun run build:local` (relative links, opens from disk), `bun test`, `bun run check` (both).

## 6. Content model

All content is Markdown with front matter or a small YAML file, so every change is a readable diff.

| Type | Location | Key fields |
|---|---|---|
| Page | `site/content/<lang>/<slug>.md` | title, description, layout, body |
| Home | `site/content/<lang>/index.md` + `site/data/home.yml` | texts per language; section order, hero photo |
| Moment | `site/moments/<date>-<slug>.md` + `.jpg` | date, caption and alt text in EN and DE |
| Imported event | fetched at build time, never committed (section 7) | generated |
| Manual event | `site/events/<date>-<slug>.md` | title, start, end, price text, ticket URL, image, category |
| Event override | `site/data/event-overrides.yml` | event id, hide, featured, replacement image or title |
| Gallery album | `site/gallery/<album>/` | title, date, cover, photos with captions |
| Opening hours | `site/data/hours.yml` | regular hours per weekday, dated exceptions |
| Venue facts | `site/data/site.yml` | address, phone, email, map link, Instagram, preview flag |
| Interface words | `site/data/i18n.yml` | every fixed label in EN and DE |

Rules:

- **One source per fact.** Hours, address and phone live in one file each; the page, the footer, the "open now" pill and the structured data read them. Nothing is typed twice.
- **Derived things are never edited by hand.** Photo sizes, the generated CSS and imported events come from a script.
- **Moments are the easy path.** One photo plus one line of text is a complete post. Posting one is the first thing the editor will learn to do.
- **The home page is a stack of sections** named in `home.yml`. A new section is one Liquid file in `templates/sections/` plus one line.
- English is the default language at `/`; German is at `/de/` with the same slugs. German uses Swiss spelling (ss, never ß); a test checks it.
- Photos are capped at 2400 px and carry no metadata; a test checks every committed photo.
- No em dashes anywhere; a test checks the rendered pages.

## 7. Events (stage 1, after the content clone)

Events are fetched at build time and rendered as static HTML. Nothing is fetched in the visitor's browser and no key is exposed.

| Source | How |
|---|---|
| IN YOUR FACE Comedy | The comedy site already builds `_data/calendar.yml` from Eventfrog with venue, start, end, price and ticket URL for every date. We add one small generated `events.json` to that site and read it here, keeping venue `robins` only |
| Eventfrog | ROBIN's own events through the organiser API with a read-only key (Actions secret). Comes after the comedy feed works |
| Manual | Markdown files for events on neither platform |

`scripts/fetch-events.ts` normalises all sources to one shape, removes duplicates (Eventfrog id or ticket URL first, then start time plus a normalised title; the comedy record wins for title and image), applies overrides and writes into the build workspace only. A failed fetch reuses the last published `/events.json` and fails loudly in the workflow.

Display: the next few events on the home page (a "This week" section), a full events page grouped by month, `Event` structured data, `.ics` links.

Taken from running the comedy site:

- Comedy ticket buttons go through the comedy site's `/go/?show=<slug>` link with `utm_source=robins`, so clicks from the bar's site are counted and always land on the next date.
- A daily scheduled build drops past events without a commit.
- When an event page is removed, its URL redirects to the events page, never a 404.
- No `Review` or `AggregateRating` structured data on our own site.

## 8. Photos: moments and gallery

The source is the venue's WhatsApp group, read through the WhatsApp explorer on Harry's Mac (`http://127.0.0.1:4747/media/<id>`). That tool and its data never leave the Mac; only chosen, cleaned photos enter this repository.

`bun scripts/add-photo.ts <file-or-url> --date … --slug … --caption-en … --caption-de … --alt-en … --alt-de …` writes one moment: auto-oriented, sRGB, at most 2400 px, re-encoded with every bit of metadata removed. `--dry-run` shows what it would write.

Privacy rules (the repository and its history are public and permanent):

- A photo of a person is committed only when Harry says it may be published. Harry cleared the first seven on 15 Nov 2026.
- Captions use first names only. No sender names, phone numbers or chat text.
- Removing a photo later does not remove it from git history, so the choice is made before the commit.

Later in stage 1: a gallery page with albums and a lightbox, and a local review page that lists recent group photos from the explorer so a batch can be picked in one sitting.

## 9. Design system

`site/data/tokens.json` is the single source: colours for night and day, type, sizes, space, radii, motion and layout. `src/tokens.ts` turns it into CSS custom properties; the editor will use the same file.

- Each component is one Liquid file in `templates/components/` or `templates/sections/` with its parameters named in a comment at the top.
- `/styleguide/` renders every token and component. It is built with the site and kept out of search engines.
- Layouts and CSS use tokens only. A test fails on a hex colour in the stylesheet (the hero overlay is the one listed exception, because the hero photo is dark in both themes).
- Every text and surface pair listed in `tokens.json` must reach WCAG AA contrast in both themes; a test checks it.
- A new component arrives with its style guide entry in the same pull request.

## 10. Editor PWA (stage 3)

An installable web app at `/edit/`. People sign in with GitHub, edit forms, see the real page and press "Submit for review". Git stays hidden.

- **Stack.** Vite, TypeScript, a small UI library (Preact or Svelte, chosen at the start of stage 3), Octokit for the GitHub REST API, a Markdown editor limited to what the site supports. English and German.
- **Login.** A GitHub App installed only on this repository (contents, pull requests, metadata). GitHub's token endpoints cannot be called from browser code, so a Cloudflare Worker of about 50 lines swaps the login code for a token. It accepts only the site's origins and stores nothing.
- **Roles.** Write access means editor. Listed in `CODEOWNERS` means approver.
- **First screen: "Post a photo".** Pick or take a photo, write one line, done. The app resizes it to 2400 px, strips metadata in the browser, asks for alt text and files it as a moment.
- **Editing.** Forms are built from `editor/schema.yml`, so a new field is a pull request, not an editor release. Hours, venue facts, pages, moments, events.
- **Preview.** The editor runs `src/render.ts` on the repository's files plus the unsaved change and shows the result in a frame at phone, tablet and desktop width. Photos appear at their original size; everything else is exact. Approvers also get the pull request preview link, which is the built site.
- **Save and review.** Save creates a branch `edit/<login>/<slug>-<date>`, one commit through the Git Data API and a draft pull request. Submit marks it ready with a plain summary. Approvers see before and after, then "Approve and publish" (approve plus squash merge) or "Request changes".
- **Guard rails.** Validation from the schema before any commit. Unsaved work kept in IndexedDB. If `main` changed the same file the editor shows both versions; it never force-pushes. A CI check fails any `edit/*` pull request that touches anything outside `site/content/`, `site/moments/`, `site/events/`, `site/gallery/` and `site/data/` (minus `tokens.json`).
- **Self-update.** The editor is built with the site, so a merge to `main` is the release. `/edit/version.json` carries version, commit and `min_supported`; the app checks it on start, on focus and every 15 minutes, offers "Update now", and refuses to commit when below `min_supported`.

## 11. Governance

- `main` takes changes only by pull request with a green build; force pushes and deletion are blocked; squash merge only.
- `.github/CODEOWNERS` lists the approvers. Today that is Harry. Elias joins as the second approver once he has a GitHub account.
- GitHub does not let an author approve their own pull request. Until there are two approvers the rule asks for zero approvals and the owner may bypass; the day Elias is added it goes to one approval with code owner review. Recorded in `decisions/`.
- No automation commits to `main`. Imported events are fetched at build time for that reason.
- Secrets live in Actions and Cloudflare, never in the repository.

| Role | Who | Can |
|---|---|---|
| Owner | Harry | Everything, including rules and secrets |
| Approver | Named in `CODEOWNERS` | Approve and merge pull requests |
| Editor | Bar staff | Open pull requests through the editor |

## 12. Google Business Profile (stage 5)

The comedy site already writes opening hours and event posts to a Business Profile through the API: validate first, write only on a difference, read back after. ROBIN's listing gets the same treatment from this repository, in this order: hours from `hours.yml`, then photos from moments, then a menu when one exists. `hours.yml` is shaped for it (weekday periods plus dated exceptions). One gap to close first: Google needs real closing times, and the bar publishes "until late".

## 13. Build plan

One branch and one pull request per milestone or smaller. Each milestone starts by restating its scope.

| # | Milestone | Accepted when |
|---|---|---|
| 0 | Repository, generator, pipeline, first page (done 15 Nov 2026) | A push to `main` deploys; a pull request gets a preview; tests run in CI |
| 1 | Content clone | Every fact and photo of the current site is in the new one; screenshots of the old site are in `baseline/`; contact form decision made |
| 2 | Design pass | Harry has reviewed the direction on his phone; critique fixes are in; Lighthouse mobile 95+ |
| 3 | Events | The home page and the events page match the comedy calendar for the next 60 days with no duplicates |
| 4 | Gallery and photo review page | A batch of group photos is picked and published in one sitting |
| 5 | German and polish | Both languages complete, Open Graph images, 404, sitemap, link check |
| 6 | Design system complete | Every component is in the style guide; no style value outside tokens |
| 7 | Editor MVP | Elias posts a photo and changes the hours from his phone, with the exact preview, without github.com |
| 8 | Editor complete | Conflict handling, offline drafts, self-update, German interface |
| 9 | Handover | robins-coffee.ch serves the new site; two approvers have each merged a change |
| 10 | Google Business Profile | Hours on Google follow `hours.yml` |

## 14. Risks and open questions

| Risk | Mitigation |
|---|---|
| Photos of people in a public history | Harry clears each photo before the commit; first names only; metadata stripped and tested |
| We own the generator | It is small, tested and has one job; the content is plain Markdown and YAML, so moving to another generator later stays cheap |
| The logo files are small (173 px roundel, 512 px wordmark) | Ask the owners for vector originals; until then they are shown small |
| Eventfrog access or limits | Last-good fallback, loud failure, manual events |
| Only one approver | Add Elias early; rule tightened that day |
| Login Worker outage | Stateless and tiny; a signed-in session keeps working until its token expires |

Open questions:

- Real closing times per weekday (the "open now" pill treats "until late" as midnight; Google needs a time).
- Contact form: Harry wants to keep one. A static site needs a sender: the login Worker can take a second route for it, or a form service. Decide in milestone 1; until then the page offers phone, email and Instagram.
- Vector logo files from the owners.
- Which Eventfrog organiser account lists ROBIN's own events, and who makes the read-only key.
- Should German be the default language at `/` instead of English?
