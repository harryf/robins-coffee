# 2026-11-15: what we take from the bar's Google Maps entry

Harry pointed the site at the bar's own entry (`https://maps.app.goo.gl/pUvDQa4cqUcahSdu6`; the first link was the comedy club's entry at the same address) and asked for its opening times and some good reviews.

| Thing | Decision |
|---|---|
| Opening hours | Copied by hand into `site/data/hours.yml` on 15 Nov 2026: Mon to Thu 16:00 to 24:00, Fri 16:00 to 02:00, Sat 10:00 to 02:00, Sun 10:00 to 24:00. They replace "until late" from the old site and feed the page, the "open now" pill and the structured data |
| Rating | "4.8 out of 5 on Google, from 299 reviews", typed into `site.yml` with its date and linked to the entry. No `AggregateRating` structured data |
| Review texts | Not copied yet. Reviews belong to the people who wrote them and Google's terms do not allow scraping the Maps page. The clean route is the Business Profile API on the bar's own listing, as the comedy site does for its listing: five stars, with text, first name and last initial only |
| Phone | The entry shows 044 253 62 02, the old website +41 79 176 74 46. Settled 20 Nov 2026 (Harry): the mobile number was wrong; the site uses the listing's number, which rings in the main office |

**Needed for review texts and for stage 5:** a Google login that manages the bar's listing (owner or manager), or the bar's listing added to the login the comedy site already uses. Then one script reads rating, count and reviews daily, and later writes hours back.
