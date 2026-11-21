import { describe, expect, test } from "bun:test";
import { fromManual } from "../src/events";

// site/assets/js/when.js is a plain browser script (no build step on the public site);
// it hangs its functions on the global object, which here is Bun's.
const whenScript: string = "../site/assets/js/when.js";
await import(whenScript);
const W = (globalThis as any).robinsWhen as {
  dayOf(ms: number, zone?: string): string;
  eventDay(e: { start: string; end: string }, now: number, zone?: string): "over" | "today" | "tomorrow" | "week" | "later";
  promo(events: { start: string; end: string; allDay?: boolean }[], now: number, zone?: string): { index: number; when: "tonight" | "today" | "tomorrow"; more: number } | null;
};
const at = (iso: string) => Date.parse(iso);
const ev = (start: string, end: string, allDay = false) => ({ start, end, allDay });

describe("today, tomorrow and this week, by the Zürich clock (site/assets/js/when.js)", () => {
  // Saturday 21 Nov 2026; Zürich is UTC+1 in winter.
  const SAT_NOON = at("2026-11-21T12:00:00+01:00");

  test("the day is the Zürich date, whatever the zone of the machine", () => {
    expect(W.dayOf(at("2026-11-21T23:30:00Z"))).toBe("2026-11-22"); // 00:30 in Zürich
    expect(W.dayOf(at("2026-07-02T22:30:00Z"))).toBe("2026-07-03"); // summer time, 00:30
    expect(W.dayOf(at("2026-11-21T22:59:00Z"))).toBe("2026-11-21");
  });

  test("an event is today, tomorrow, later this week, later still, or over", () => {
    expect(W.eventDay(ev("2026-11-21T20:00:00+01:00", "2026-11-21T23:00:00+01:00"), SAT_NOON)).toBe("today");
    expect(W.eventDay(ev("2026-11-22T20:00:00+01:00", "2026-11-22T23:00:00+01:00"), SAT_NOON)).toBe("tomorrow");
    expect(W.eventDay(ev("2026-11-27T20:00:00+01:00", "2026-11-27T23:00:00+01:00"), SAT_NOON)).toBe("week"); // today + 6
    expect(W.eventDay(ev("2026-11-28T20:00:00+01:00", "2026-11-28T23:00:00+01:00"), SAT_NOON)).toBe("later"); // today + 7
    expect(W.eventDay(ev("2026-11-21T08:00:00+01:00", "2026-11-21T11:00:00+01:00"), SAT_NOON)).toBe("over");
  });

  test("just after midnight the new day has begun: Saturday's show is today, Sunday's tomorrow", () => {
    const SAT_0010 = at("2026-11-21T00:10:00+01:00");
    expect(W.eventDay(ev("2026-11-21T20:00:00+01:00", "2026-11-21T23:00:00+01:00"), SAT_0010)).toBe("today");
    expect(W.eventDay(ev("2026-11-22T20:00:00+01:00", "2026-11-22T23:00:00+01:00"), SAT_0010)).toBe("tomorrow");
    // Friday's show that ended at 23:00 is over.
    expect(W.eventDay(ev("2026-11-20T20:00:00+01:00", "2026-11-20T23:00:00+01:00"), SAT_0010)).toBe("over");
  });

  test("a party that runs past midnight is still today while it is on, and over once it ends", () => {
    const party = ev("2026-11-20T22:00:00+01:00", "2026-11-21T03:00:00+01:00");
    expect(W.eventDay(party, at("2026-11-20T23:00:00+01:00"))).toBe("today");
    expect(W.eventDay(party, at("2026-11-21T01:30:00+01:00"))).toBe("today");
    expect(W.eventDay(party, at("2026-11-21T03:00:00+01:00"))).toBe("over");
    expect(W.promo([party], at("2026-11-21T01:30:00+01:00"))).toEqual({ index: 0, when: "tonight", more: 0 });
  });

  test("tomorrow counts calendar days, not 24 hours, across the change to winter time", () => {
    // Sun 25 Oct 2026 has 25 hours in Zürich. At 23:30 on Saturday the 24th, Sunday 23:45 is tomorrow.
    expect(W.eventDay(ev("2026-10-25T23:45:00+01:00", "2026-10-26T01:00:00+01:00"), at("2026-10-24T23:30:00+02:00"))).toBe("tomorrow");
  });

  test("the promotion: the first event of today, else of tomorrow; tonight after five, today by day or for a whole day", () => {
    const comedy = ev("2026-11-21T20:00:00+01:00", "2026-11-21T22:00:00+01:00");
    const brunch = ev("2026-11-21T10:00:00+01:00", "2026-11-21T14:00:00+01:00");
    const chess = ev("2026-11-21T00:00:00+01:00", "2026-11-22T00:00:00+01:00", true);
    const sunday = ev("2026-11-22T20:00:00+01:00", "2026-11-22T22:00:00+01:00");
    const later = ev("2026-11-25T20:00:00+01:00", "2026-11-25T22:00:00+01:00");
    expect(W.promo([comedy, sunday], SAT_NOON)).toEqual({ index: 0, when: "tonight", more: 0 });
    expect(W.promo([brunch, comedy, sunday], at("2026-11-21T11:00:00+01:00"))).toEqual({ index: 0, when: "today", more: 1 });
    expect(W.promo([chess, comedy], SAT_NOON)).toEqual({ index: 0, when: "today", more: 1 });
    // Brunch is over by three: the evening show is first now.
    expect(W.promo([brunch, comedy, sunday], at("2026-11-21T15:00:00+01:00"))).toEqual({ index: 1, when: "tonight", more: 0 });
    // Nothing left today: tomorrow, with how many more tomorrow.
    expect(W.promo([comedy, sunday, ev("2026-11-22T22:30:00+01:00", "2026-11-23T01:00:00+01:00"), later], at("2026-11-21T22:30:00+01:00"))).toEqual({ index: 1, when: "tomorrow", more: 1 });
  });

  test("ANTI: nothing today or tomorrow means no promotion, also for an empty list", () => {
    expect(W.promo([ev("2026-11-25T20:00:00+01:00", "2026-11-25T22:00:00+01:00")], SAT_NOON)).toBeNull();
    expect(W.promo([], SAT_NOON)).toBeNull();
    expect(W.promo([ev("2026-11-21T08:00:00+01:00", "2026-11-21T11:00:00+01:00")], SAT_NOON)).toBeNull();
  });

  test("works on the events the build makes from a hand file, a whole day included", () => {
    const chess = fromManual({ "events/q.md": "---\ntitle: Q\ndates: [2026-11-21, 2026-11-22]\n---\n" }, { timeZone: "Europe/Zurich" });
    const all = chess.map((e) => ({ start: e.start, end: e.end, allDay: !!e.all_day }));
    expect(W.promo(all, at("2026-11-21T23:59:00+01:00"))).toEqual({ index: 0, when: "today", more: 0 });
    expect(W.promo(all, at("2026-11-22T00:00:00+01:00"))).toEqual({ index: 1, when: "today", more: 0 });
  });
});
