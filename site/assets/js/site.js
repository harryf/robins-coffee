// The only script on the public site. No framework. It fills the "open now" pill
// from the hours data the build embedded in the page.
(function () {
  var hoursEl = document.getElementById("hours-data");
  var i18nEl = document.getElementById("i18n-data");
  if (!hoursEl || !i18nEl) return;
  var hours = JSON.parse(hoursEl.textContent);
  var t = JSON.parse(i18nEl.textContent);

  // Zürich wall clock, whatever the visitor's own time zone is.
  function zurichNow() {
    var parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false }).formatToParts(new Date());
    var p = {};
    parts.forEach(function (x) { p[x.type] = x.value; });
    return { date: p.year + "-" + p.month + "-" + p.day, day: p.weekday.slice(0, 2).toLowerCase(), minutes: (+p.hour % 24) * 60 + +p.minute };
  }
  function rule(date, day) {
    var ex = (hours.exceptions || []).filter(function (e) { return String(e.date).slice(0, 10) === date; })[0];
    if (ex) return ex.closed ? null : ex;
    return (hours.regular || []).filter(function (r) { return r.days.indexOf(day) !== -1 && !r.closed; })[0] || null;
  }
  function mins(hhmm) { var a = hhmm.split(":"); return +a[0] * 60 + +a[1]; }

  var now = zurichNow();
  var today = rule(now.date, now.day);
  var text = t.closed_today, open = false;
  if (today) {
    var from = mins(today.open);
    // "Until late" has no closing time: count the bar as open from opening to midnight.
    var to = today.close ? mins(today.close) : 24 * 60;
    if (to <= from) to += 24 * 60;
    if (now.minutes >= from && now.minutes < to) { open = true; text = t.open_now + (today.close ? "" : ", " + t.until_late); }
    else if (now.minutes < from) text = t.opens_at.replace("{time}", today.open);
  }
  document.querySelectorAll("[data-open-pill]").forEach(function (el) {
    el.querySelector("[data-open-text]").textContent = text;
    el.classList.toggle("is-open", open);
    el.hidden = false;
  });

  // Contact form. There is no server behind this site yet, so "send" writes the
  // email for the visitor: it opens their mail app with everything filled in.
  // (See docs/decisions/2026-11-15-contact-form.md.)
  document.querySelectorAll("[data-contact-form]").forEach(function (form) {
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var f = form.elements;
      var lines = [f.message.value.trim(), "", f.name.value.trim()];
      if (f.phone.value.trim()) lines.push(f.phone.value.trim());
      var link = form.querySelector("[data-mailto]");
      link.href = "mailto:" + form.dataset.to + "?subject=" + encodeURIComponent(form.dataset.subject) + "&body=" + encodeURIComponent(lines.join("\n"));
      link.click();
    });
  });
})();
