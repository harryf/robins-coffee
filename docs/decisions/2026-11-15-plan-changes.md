# 2026-11-15: changes to the first plan

The first spec (`../archive/spec-v1-2026-11-15.md`) was reviewed before any code was written. These are the changes, each with its reason. Harry confirmed the first one and chose the repository visibility; the rest are within "change the plan where it can be done better".

| # | First plan | Now | Why |
|---|---|---|---|
| 1 | Hugo | Our own generator: bun, TypeScript, Liquid; a pure renderer shared with the editor | A browser cannot run Hugo, so the first plan needed three preview layers, a parity test, a WebAssembly spike and a Chrome-only Mac helper. One renderer that runs in bun and in the browser gives the exact preview on a phone and removes all of that |
| 2 | Python scripts and a Makefile | TypeScript on bun, `package.json` scripts | One language across site, scripts and editor; Harry's standing rule |
| 3 | Two or three style tiles, then pick | One direction taken from the bar's own light and logo, built as the real first page, reviewed in the browser | The photos made the direction plain; a real page on a phone is a better thing to judge than tiles |
| 4 | Black and gold kept as "the identity" | Aubergine, neon pink, amber, cream; the slab logo and roundel kept | Black, gold and Cinzel came from a generic WordPress theme. The identity is the logo and the room |
| 5 | Gallery albums only | A "moments" feed (one photo, one line) plus albums later | A feed is what keeps a site alive and is the smallest possible act for an editor |
| 6 | Fixed page list | The home page is a stack of sections named in a data file | New sections were asked for; they should cost one file and one line |
| 7 | WhatsApp `_chat.txt` export, parsed by a script | Photos come through the WhatsApp explorer already running on Harry's Mac, by media id | The explorer already has every photo with dates and context; no export, no parser |
| 8 | Comedy feed: "check whether one exists" | Checked: the comedy site has all the data in `_data/calendar.yml`; we add one generated `events.json` there | Smallest change on a site we control |
| 9 | One approval required from day one | Zero approvals with owner bypass until Elias is a second approver | GitHub forbids approving your own pull request; with one approver nothing could merge |
| 10 | Google Business Profile not mentioned | Stage 5, with `hours.yml` shaped for it | Asked for; the comedy site already has the working pattern |
| 11 | Preview site indexable | `noindex` and a disallow-all `robots.txt` until the DNS cut-over | Two copies of the same venue in search results helps nobody |

Kept from the first plan: GitHub Pages, `gh-pages` branch with pull request previews, protected `main`, the content-as-Markdown model, the GitHub App plus a small login Worker, schema-driven editor forms, the self-update design, the privacy rules for photos.
