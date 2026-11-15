// The only script on the public site. No framework. It fills the "open now" pill
// from the hours data the build embedded in the page.
(function () {
  var hoursEl = document.getElementById("hours-data");
  var i18nEl = document.getElementById("i18n-data");
  if (!hoursEl || !i18nEl) return;
  var hours = JSON.parse(hoursEl.textContent);
  var t = JSON.parse(i18nEl.textContent);

  // Zürich wall clock, whatever the visitor's own time zone is.
  function zurichNow(dayOffset) {
    var parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false }).formatToParts(new Date(Date.now() + dayOffset * 864e5));
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

  // Is the bar open? Pure: takes the hours data and two clock readings.
  // A day that closes after midnight (Friday until 02:00) still counts in the small
  // hours of the next day, so yesterday's rule is checked first.
  function openState(now, yesterday) {
    var y = rule(yesterday.date, yesterday.day);
    if (y && y.close && mins(y.close) <= mins(y.open) && now.minutes < mins(y.close)) return { open: true, until: y.close };
    var today = rule(now.date, now.day);
    if (!today) return { open: false, closed: true };
    var from = mins(today.open);
    // No closing time ("until late") counts as open until midnight.
    var to = today.close ? mins(today.close) : 24 * 60;
    if (to <= from) to += 24 * 60;
    if (now.minutes >= from && now.minutes < to) return { open: true, until: today.close };
    if (now.minutes < from) return { open: false, opens: today.open };
    return { open: false, closed: true };
  }
  function stateText(s) {
    if (s.open) return s.until ? t.open_until.replace("{time}", s.until === "00:00" ? "24:00" : s.until) : t.open_now + ", " + t.until_late;
    return s.opens ? t.opens_at.replace("{time}", s.opens) : t.closed_today;
  }
  window.robinsOpenState = openState; // so the logic can be checked from the console

  var state = openState(zurichNow(0), zurichNow(-1));
  document.querySelectorAll("[data-open-pill]").forEach(function (el) {
    el.querySelector("[data-open-text]").textContent = stateText(state);
    el.classList.toggle("is-open", state.open);
    el.hidden = false;
  });

  // Ticker: one button pauses and restarts the moving text.
  document.querySelectorAll("[data-ticker-pause]").forEach(function (button) {
    button.addEventListener("click", function () {
      var paused = button.closest("[data-ticker]").classList.toggle("is-paused");
      button.setAttribute("aria-pressed", String(paused));
    });
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
      if (!link) { link = document.createElement("a"); link.setAttribute("data-mailto", ""); link.hidden = true; form.appendChild(link); }
      link.href = "mailto:" + form.dataset.to + "?subject=" + encodeURIComponent(form.dataset.subject) + "&body=" + encodeURIComponent(lines.join("\n"));
      link.click();
    });
  });
})();
