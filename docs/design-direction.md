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
| Patterned roundel, matching the espresso cups | The roundel in the header and beside the About text |
| Daylight coffee photos of the 2022 site (cobblestones, patterned cups) | The photo strip under the About text: the "coffee by day" half |
| A pink neon sign on the wall | The second sentence of the headline glows and flickers once on load |

## Fixed

- Pink is light, not paint: headline, main button, ticker, link colour. Never a large flat background behind text other than the ticker.
- The hero is always dark, in both themes, because the photo is. It and the header above it carry `on-photo`, so everything on them is light on dark.
- Since 16 Nov 2026 the day theme is "coffee": espresso brown with a crema orange where the night has neon pink, and the latte art photo as its hero. Harry found the first day theme (cream) ugly. Night is "cocktails": aubergine and pink, with Elias at the taps as its hero. A switch in the header (coffee cup, cocktail glass) shows either for the rest of the visit.
- Nothing moves for ever without a pause: the ticker has a pause button, the "open" dot pulses three times, the headline flickers once. (WCAG 2.2.2; the roundel no longer turns.)
- The hero photo is never repeated as the first card of the feed.
- Two font families. No third "handwriting" font; the wall lettering stays in the photos.
- Motion is slow and small, and all of it stops under `prefers-reduced-motion`.
- Photos keep their own shape in the feed (columns, no forced crops).

## Open

- The roundel (173 px) and wordmark (512 px) are small bitmaps. Vector originals would let the roundel pattern become a section divider and a favicon set.
- Whether the day theme should start with the bar's weekend opening (10:00) rather than 06:00.
- Critique of 15 Nov 2026: all twelve findings applied except two left open: the first three feed cards are still the same evening (needs more photos, not CSS), and the hero photo is soft on large phones (needs the original file; the group copy is 1500 px wide).
