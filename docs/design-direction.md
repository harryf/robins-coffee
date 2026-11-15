# Design direction: neon over wood

Where the look comes from, what is fixed, and what is still open. Tokens are in `site/data/tokens.json`; the live reference is `/styleguide/`.

## What the photos say

Seven photos from the bar's group (October and November 2026) and the two logo files were the brief.

| Seen in the room | Used as |
|---|---|
| Pink and violet light on everything at night | `neon` and `violet`; the night theme |
| Warm backlit bottle shelves | `amber`, for small labels and focus rings |
| Dark wood, deep aubergine shadows | `bg`, `surface`, `raised` |
| White wall with hand-drawn chalk lettering | Cream `text` at night, cream `bg` by day |
| Green cabinets behind the bar | `green`, used for the "open" dot only |
| Heavy slab-serif "R" and wordmark | Alfa Slab One for every heading |
| Patterned roundel, matching the espresso cups | The roundel in the header and, turning slowly, in the About section |
| A pink neon sign on the wall | The second sentence of the headline glows and flickers once on load |

## Fixed

- Pink is light, not paint: headline, main button, ticker, link colour. Never a large flat background behind text other than the ticker.
- The hero is always dark, in both themes, because the photo is.
- Two font families. No third "handwriting" font; the wall lettering stays in the photos.
- Motion is slow and small, and all of it stops under `prefers-reduced-motion`.
- Photos keep their own shape in the feed (columns, no forced crops).

## Open

- The roundel (173 px) and wordmark (512 px) are small bitmaps. Vector originals would let the roundel pattern become a section divider and a favicon set.
- The ticker words are the same in both languages.
- A manual day and night switch for visitors (today only `?theme=`).
- Whether the day theme should start with the bar's weekend opening (10:00) rather than 06:00.
- The four photos of the current site (barista, patterned cups) are not placed yet; they belong in an "about" strip or the first gallery album.
- A Designer critique at desktop and 390 px before milestone 2 closes.
