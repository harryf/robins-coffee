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

No menu, no events, no social links, no structured data, mixed German and English labels. Originals of the logo and the four photos are in `baseline/assets/`; full-page screenshots at 1280 and 390 px are in `baseline/`.

All of it is on the new home page, and `test/site.test.ts` ("content clone of the old site") fails if a fact goes missing.

## 4. Design direction: "neon over wood"

The first draft planned style tiles before any page. We skipped that: the photos from the bar already answer the question. The room at night is pink and violet light over warm amber shelves, dark wood and green cabinets, with a chalk-white wall of hand lettering. The logo is a heavy slab serif inside a patterned roundel that matches the espresso cups. The site takes all of that and drops the black and gold of the old theme, which belongs to no part of the room.

- **Colour.** Night: aubergine black, neon pink as the one loud colour, violet and amber as support, cream text. Day: the same hues on cream. Pink is the brand's light, used for the headline, the main button and the ticker, never for body text.
- **Day and night.** The page follows the Zürich clock: a cream day theme from 06:00 to 17:00, the night theme otherwise. `?theme=day` or `?theme=night` pins one. Without JavaScript the page is night.
- **Type.** Alfa Slab One for headings (close to the logo's slab), DM Sans for text. Both self-hosted, two families only.
- **Signs of life.** An "open until" pill worked out from `hours.yml`; a headline that lights up like the sign; a slow ticker with a pause button; the newest photos first on the home page. All motion stops under `prefers-reduced-motion`.
- **Photography first.** Real photos from the bar lead every page. No stock, no illustrations.

Open design work is listed in `design-direction.md`.

## 5. Architecture

Everything lives in one public repository and deploys to GitHub Pages. The only piece outside GitHub will be one small Cloudflare Worker for the editor login (and perhaps for sending the contact form, see `decisions/2026-11-15-contact-form.md`).

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
    moments/             every published photo: <date>-<slug>.jpg + .md
    photos/              photos used by page sections
    data/                site.yml, hours.yml, home.yml, albums.yml, i18n.yml, tokens.json
    templates/           layouts/, sections/, components/ (Liquid)
    assets/              css/, js/, brand/
  src/                   the generator: render.ts (pure), build.ts, tokens.ts
  scripts/               tools: add-photo.ts, review-photos.ts, import-selection.ts
  inbox/                 local only, gitignored: the review page, the chat id, the import record
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
| Moment | `site/moments/<date>-<slug>.md` + `.jpg` | date, caption and alt text in EN and DE; optional `album: <slug>`; optional `feed: false` (gallery only) |
| Section photo | `site/photos/<slug>.jpg` | alt text in EN and DE where it is used (`home.yml`) |
| Imported event | fetched at build time, never committed (section 7) | generated |
| Manual event | `site/events/<date>-<slug>.md` (format in `site/events/README.md`) | title, start, end, price_chf, ticket_url, category |
| Event override | `site/data/event-overrides.yml` | event id, hide, featured, replacement image or title |
| Gallery album | `site/data/albums.yml` | slug, title in EN and DE, optional cover (a moment id) |
| Opening hours | `site/data/hours.yml` | regular hours per weekday, dated exceptions |
| Venue facts | `site/data/site.yml` | address, phone, email, map link, Instagram, preview flag |
| Interface words | `site/data/i18n.yml` | every fixed label in EN and DE |

Rules:

- **One source per fact.** Hours, address and phone live in one file each; the page, the footer, the "open now" pill and the structured data read them. Nothing is typed twice.
- **Derived things are never edited by hand.** Photo sizes, the generated CSS and imported events come from a script.
- **Moments are the easy path.** One photo plus one line of text is a complete post. Posting one is the first thing the editor will learn to do.
- **One model for photos.** Every photo in the feed or the gallery is a moment. An album is a line in `albums.yml` plus `album: <slug>` on its moments; there are no album folders. A moment that names an album missing from `albums.yml` fails the build.
- **No unfinished text.** An imported photo starts with `TODO` as caption and alt text; a test fails while any moment contains `TODO`.
- **The home page is a stack of sections** named in `home.yml`. A new section is one Liquid file in `templates/sections/` plus one line.
- English is the default language at `/`; German is at `/de/` with the same slugs. German uses Swiss spelling (ss, never ß); a test checks it.
- Photos are capped at 2400 px and carry no metadata; a test checks every committed photo.
- No em dashes anywhere; a test checks the rendered pages.

## 7. Events (stage 1, after the content clone)

Events are fetched at build time and rendered as static HTML. Nothing is fetched in the visitor's browser and no key is exposed.

| Source | How |
|---|---|
| IN YOUR FACE Comedy | The comedy site publishes `https://inyourfacecomedy.ch/events.json` (its `pages/events.json`, generated from `_data/calendar.yml`): every upcoming date with venue, start, end, price, flyer and its tracked `/go/` link. We read it at build time and keep venue `robins` |
| Eventfrog | ROBIN's own events through the organiser API with a read-only key (Actions secret). Comes after the comedy feed works |
| Manual | Markdown files for events on neither platform |

`src/events.ts` (pure, tested) turns every source into one shape, removes duplicates (same start and ticket link, or same start and normalised name; the earlier source wins, comedy first), applies `site/data/event-overrides.yml` and sorts. `src/build.ts` does the fetching and hands the merged list to the renderer as `data/events.json`; it also publishes `/events.json` and `/events.ics`. Nothing imported is committed. If the feed cannot be read, the build uses the list this site published last time and raises a warning on the workflow run; with no earlier copy it builds without imported events.

Display: the next four events on the home page ("What's on", left out when nothing is announced), an events page with the next 60 days grouped by month, `ComedyEvent` structured data, and one `.ics` feed to subscribe to. Each row shows the show's flyer, fetched and resized by the build.

Taken from running the comedy site:

- Comedy ticket buttons go through the comedy site's `/go/?show=<slug>` link with `utm_source=robins`, so clicks from the bar's site are counted and always land on the next date.
- A scheduled build every morning (04:40 UTC) refreshes the list and drops past events without a commit; between builds, the page script hides an event once it has ended.
- When an event page is removed, its URL redirects to the events page, never a 404.
- No `Review` or `AggregateRating` structured data on our own site.

## 8. Photos: moments and gallery

The source is the venue's WhatsApp group, read through the WhatsApp explorer on Harry's Mac (`http://127.0.0.1:4747/media/<id>`). That tool and its data never leave the Mac; only chosen, cleaned photos enter this repository.

`bun scripts/add-photo.ts <file-or-url> --date … --slug … --caption-en … --caption-de … --alt-en … --alt-de …` writes one moment: auto-oriented, sRGB, at most 2400 px, re-encoded with every bit of metadata removed. `--dry-run` shows what it would write. With `--plain --slug …` it writes a section photo into `site/photos/` instead.

Privacy rules (the repository and its history are public and permanent):

- A photo of a person is committed only when Harry says it may be published. Harry cleared the first seven on 15 Nov 2026.
- Captions use first names only. No sender names, phone numbers or chat text.
- Removing a photo later does not remove it from git history, so the choice is made before the commit.

**Gallery.** `/gallery/` and `/de/gallery/` show every moment on one page. Albums are sections, newest first by their newest photo; photos with no album follow under "More from the bar". An album's optional `cover` puts that photo first. The home feed shows the newest moments (not the hero photo, not `feed: false`) and links to the gallery. The header carries "Photos" / "Fotos".

**Lightbox.** Each moment photo is a plain link to its largest JPEG, so it works without JavaScript. With JavaScript, `site.js` opens the photo in a native `<dialog>`: caption and date, previous and next inside the same grid, arrow keys, a swipe, Esc, a close button. The dialog traps focus, the page behind does not scroll, and focus returns to the photo. It always wears the night colours (`on-photo`). It picks a file by the width the photo takes on the screen, so a phone never loads the widest one.

**A batch in one sitting.** Two local tools, both talking to the explorer on Harry's Mac:

| Step | Command | Result |
|---|---|---|
| 1. Review | `bun scripts/review-photos.ts --chat <id> [--days 90]` | `inbox/review.html`: the group's photos, newest first by day. Tick photos, pick an album or "feed only", type a rough caption or a note, press "Save selection" |
| 2. Import | `bun scripts/import-selection.ts <robins-selection.json> [--dry-run]` | One moment per photo: cleaned like `add-photo.ts`, dated from the sent time in Zürich time, with album and feed flag. New albums are added to `albums.yml` |
| 3. Finish | Replace every `TODO`, then `bun run check` | Caption and alt text in EN and DE; the tests pass again |

- The chat id is given once and kept in `inbox/config.json`. The import refuses a message from any other chat, a video, and a photo its sender deleted.
- The review page shows a sender's first name and the time. It holds no phone number, no id, no chat name and no chat text. Ticks live in the browser's localStorage, so a reload keeps them.
- Photos already published are marked on the review page and cannot be ticked again. `inbox/imported.json` records which message became which file.
- `inbox/` is gitignored. Message ids, the chat id and notes never enter the repository.

## 9. Design system

`site/data/tokens.json` is the single source: colours for night and day, type, sizes, space, radii, motion and layout. `src/tokens.ts` turns it into CSS custom properties; the editor will use the same file.

- Each component is one Liquid file in `templates/components/` or `templates/sections/` with its parameters named in a comment at the top.
- `/styleguide/` renders every token and component. It is built with the site and kept out of search engines.
- Layouts and CSS use tokens only: colour, type (family, size, weight, line height, tracking), space, radius, border, shadow, motion, layers, tap targets, measures and breakpoints. Tests fail on a raw colour, on a typed value for any of those, on a media query with a number that is not a breakpoint, and on an inline style in a template. The geometry of one component (a thumbnail width, a column count) stays in the stylesheet beside it.
- The style guide lists tokens straight from `tokens.json` and components, sections and layouts straight from the template folders, each with the comment its file starts with. A test fails when a component or section has no entry or no comment. Things that sit on a dark photo (the hero, the header above it) carry the class `on-photo`, which gives them the night colours in both themes.
- Every text and surface pair listed in `tokens.json` must reach WCAG AA contrast in both themes; a test checks it.
- A new component arrives with its style guide entry in the same pull request.

## 10. Editor PWA (stage 3)

An installable web app at `/edit/`. People sign in with GitHub, edit forms, see the real page and press "Send for publishing". Git stays hidden.

**As built (16 Nov 2026):** no server and no framework; sign-in is a personal access token; see `docs/decisions/2026-11-16-editor-login.md`, which replaces the Stack and Login points below. The first version posts photos and changes the opening hours.

- **Stack.** Vite, TypeScript, a small UI library (Preact or Svelte, chosen at the start of stage 3), Octokit for the GitHub REST API, a Markdown editor limited to what the site supports. English and German.
- **Login.** A GitHub App installed only on this repository (contents, pull requests, metadata). GitHub's token endpoints cannot be called from browser code, so a Cloudflare Worker of about 50 lines swaps the login code for a token. It accepts only the site's origins and stores nothing.
- **Roles.** Write access means editor. Listed in `CODEOWNERS` means approver.
- **First screen: "Post a photo".** Pick or take a photo, write one line, done. The app resizes it to 2400 px, strips metadata in the browser, asks for alt text and files it as a moment.
- **Editing.** Forms are built from `editor/schema.yml`, so a new field is a pull request, not an editor release. Hours, venue facts, pages, moments, events.
- **Preview.** The editor runs `src/render.ts` on the repository's files plus the unsaved change and shows the result in a frame at phone, tablet and desktop width. Photos appear at their original size; everything else is exact. Approvers also get the pull request preview link, which is the built site.
- **Save and review.** Save creates a branch `edit/<login>/<slug>-<date>`, one commit through the Git Data API and a draft pull request. Submit marks it ready with a plain summary. Approvers see before and after, then "Approve and publish" (approve plus squash merge) or "Request changes".
- **Guard rails.** Validation from the schema before any commit. Unsaved work kept in IndexedDB. If `main` changed the same file the editor shows both versions; it never force-pushes. A CI check fails any `edit/*` pull request that touches anything outside `site/content/`, `site/moments/`, `site/events/` and `site/data/` (minus `tokens.json`).
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

The comedy site already writes opening hours and event posts to a Business Profile through the API: validate first, write only on a difference, read back after. ROBIN's listing gets the same treatment from this repository, in this order: hours from `hours.yml`, then photos from moments, then a menu when one exists. `hours.yml` is shaped for it (weekday periods plus dated exceptions). The hours in `hours.yml` were copied from the listing on 15 Nov 2026, so the two agree today. The site also shows the listing's rating with a link; review texts wait for API access (`decisions/2026-11-15-google-listing.md`).

## 13. Build plan

One branch and one pull request per milestone or smaller. Each milestone starts by restating its scope.

| # | Milestone | Accepted when |
|---|---|---|
| 0 | Repository, generator, pipeline, first page (done 15 Nov 2026) | A push to `main` deploys; a pull request gets a preview; tests run in CI |
| 1 | Content clone (done 15 Nov 2026) | Every fact and photo of the current site is in the new one; screenshots of the old site are in `baseline/`; contact form decision made |
| 2 | Design pass (critique and Lighthouse done 15 Nov 2026) | Harry has reviewed the direction on his phone; critique fixes are in; Lighthouse mobile 95+ for performance and accessibility |
| 3 | Events (comedy feed done 15 Nov 2026; Eventfrog source still to come) | The home page and the events page match the comedy calendar for the next 60 days with no duplicates |
| 4 | Gallery and photo review page (gallery and lightbox done 15 Nov 2026; review page and import built, first real batch still to run) | A batch of group photos is picked and published in one sitting |
| 5 | German and polish (done 16 Nov 2026) | Both languages complete, Open Graph images, 404, sitemap, link check |
| 6 | Design system complete (done 16 Nov 2026) | Every component is in the style guide; no style value outside tokens |
| 7 | Editor MVP (built 16 Nov 2026; first real send by Harry and Elias still to come) | Elias posts a photo and changes the hours from his phone, with the exact preview, without github.com |
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

- Which phone number is right: the old website says +41 79 176 74 46, the Google entry 044 253 62 02.
- Access to the bar's Google listing (owner or manager login) for review texts and for stage 5; see `decisions/2026-11-15-google-listing.md`.
- Contact form sender: the form writes an email in the visitor's mail app for now (`decisions/2026-11-15-contact-form.md`). A real sender (Worker route or form service) is chosen at the cut-over, when DNS control is known.
- Vector logo files from the owners.
- Which Eventfrog organiser account lists ROBIN's own events, and who makes the read-only key.
- Should German be the default language at `/` instead of English?
