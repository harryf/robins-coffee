// Which day an event belongs to, by the Zürich clock: today, tomorrow, later this week,
// later still, or over. The site is built once a day, so the page cannot know what
// "today" is when someone reads it; site.js asks these functions in the visitor's
// browser. Pure: every answer depends only on the event times and the clock reading
// passed in, so test/when.test.ts can check them with a fixed clock.
// Only numbers come from Intl; the words are in i18n.yml.
(function (root) {
  var ZONE = "Europe/Zurich";
  var pad = function (n) { return (n < 10 ? "0" : "") + n; };

  function parts(ms, zone) {
    var p = {};
    new Intl.DateTimeFormat("en-US", { timeZone: zone || ZONE, year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(ms)).forEach(function (x) { p[x.type] = +x.value; });
    return p;
  }
  /** The calendar day on a Zürich wall, "2026-11-21". */
  function dayOf(ms, zone) { var p = parts(ms, zone); return p.year + "-" + pad(p.month) + "-" + pad(p.day); }
  /** A calendar day plus n days: counts days, not 24 hours, so summer time cannot shift it. */
  function addDays(day, n) { return new Date(Date.parse(day + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10); }

  /**
   * "over" once it has ended; an event that is on right now (a party past midnight) is
   * "today"; otherwise the day it starts on: "today", "tomorrow", "week" (the five days
   * after tomorrow, so today and the next six make the week) or "later".
   */
  function eventDay(e, now, zone) {
    var start = Date.parse(e.start), end = Date.parse(e.end);
    if (!(end > now)) return "over";
    var today = dayOf(now, zone);
    var day = start <= now ? today : dayOf(start, zone);
    if (day === today) return "today";
    if (day === addDays(today, 1)) return "tomorrow";
    return day <= addDays(today, 6) ? "week" : "later";
  }

  /** An evening event starts at five or later, or in the small hours; a whole-day event never is one. */
  function isEvening(e, zone) {
    if (e.allDay) return false;
    var h = parts(Date.parse(e.start), zone).hour % 24;
    return h >= 17 || h < 5;
  }

  /**
   * What the home page promotes: the first event of today that has not ended, else the
   * first of tomorrow, with how many more that day has. `when` names the label:
   * "tonight", "today" (by day, or for a whole day) or "tomorrow". Null when neither day
   * has anything. `events` must be in order of start, as the build writes them.
   */
  function promo(events, now, zone) {
    var pick = function (want) {
      var idx = [];
      events.forEach(function (e, i) { if (eventDay(e, now, zone) === want) idx.push(i); });
      return idx;
    };
    var today = pick("today");
    if (today.length) return { index: today[0], when: isEvening(events[today[0]], zone) ? "tonight" : "today", more: today.length - 1 };
    var tomorrow = pick("tomorrow");
    if (tomorrow.length) return { index: tomorrow[0], when: "tomorrow", more: tomorrow.length - 1 };
    return null;
  }

  root.robinsWhen = { dayOf: dayOf, addDays: addDays, eventDay: eventDay, isEvening: isEvening, promo: promo };
})(typeof window !== "undefined" ? window : globalThis);
