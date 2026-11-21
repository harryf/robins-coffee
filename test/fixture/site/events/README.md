Events that are on neither the comedy calendar nor Eventfrog go here, one file per
event or per series. This README is not an event (it has no front matter start) and is
skipped. A single evening, `2026-12-31-new-years-eve.md`:

    ---
    title: "New Year's Eve at ROBIN's"
    start: 2026-12-31T21:00:00+01:00
    end: 2027-01-01T03:00:00+01:00
    price_chf: 0
    category: other        # comedy, music or other
    ticket_url: ""         # leave empty when people can just come
    image: "photos/event-nye.jpg"   # optional; add with scripts/add-photo.ts --plain
    text:                  # optional, one or two sentences
      en: "DJ from ten."
      de: "DJ ab zehn."
    ---

Instead of `start` and `end` a file may say the day in Zürich time:

    date: 2026-12-31       # one day
    from: "21:00"          # optional; without it the card shows the day only
    to: "03:00"            # optional; earlier than `from` means after midnight

and one file can hold a whole series:

    dates: [2026-11-29, 2026-12-11]   # a list of days, or
    every: we                         # every Wednesday (mo tu we th fr sa su),
    until: 2027-03-31                 # optional last day; the site shows ten weeks ahead
