// The only script on the public site. No framework. It fills the "open now" pill
// from the hours data the build embedded in the page.

// Theme switch: coffee colours or cocktail colours, kept for this visit only, so the
// next visit follows the clock again.
(function () {
  var root = document.documentElement;
  document.querySelectorAll("[data-theme-switch]").forEach(function (button) {
    var show = function () { button.setAttribute("aria-checked", String(root.dataset.theme !== "day")); };
    button.hidden = false;
    show();
    button.addEventListener("click", function () {
      root.dataset.theme = root.dataset.theme === "day" ? "night" : "day";
      try { sessionStorage.setItem("theme", root.dataset.theme); } catch (e) {}
      var bar = document.querySelector('meta[name="theme-color"]');
      if (bar) bar.content = bar.getAttribute("data-" + root.dataset.theme);
      show();
    });
  });
})();

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

  // Events are baked in at build time (at least once a day). In between, an event
  // that has ended is taken off the page here.
  document.querySelectorAll(".event[data-end]").forEach(function (el) {
    if (new Date(el.getAttribute("data-end")).getTime() < Date.now()) el.hidden = true;
  });

  // 404 page: when the address names a language, that language's block goes first.
  document.querySelectorAll("[data-notfound] [data-lang]").forEach(function (block) {
    if (location.pathname.indexOf("/" + block.getAttribute("data-lang") + "/") >= 0) block.parentNode.prepend(block);
  });

  // Ticker: the whole strip is the button that pauses and restarts the moving text.
  // On a device that asks for reduced motion it starts paused, and a tap sets it going.
  var calm = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.querySelectorAll("[data-ticker]").forEach(function (ticker) {
    var set = function (paused) {
      ticker.classList.toggle("is-paused", paused);
      ticker.classList.toggle("is-playing", !paused);
      ticker.setAttribute("aria-pressed", String(paused));
    };
    if (calm) set(true);
    ticker.addEventListener("click", function () { set(!ticker.classList.contains("is-paused")); });
  });

  // Style guide: what this device and browser report, for chasing a "works here, not there".
  document.querySelectorAll("[data-device-report]").forEach(function (out) {
    var view = document.querySelector(".ticker__view");
    var x = function () { return view ? view.getBoundingClientRect().left : 0; };
    var can = function (rule) { return window.CSS && CSS.supports ? CSS.supports(rule) : false; };
    var before = x();
    // Measured again every second, so the answer is about now and not about the moment
    // the page loaded (a page in a background tab does not move anything).
    var report = function () {
      var cs = view ? getComputedStyle(view) : null;
      var now = x();
      var facts = [
        ["Reduce Motion asked for", calm ? "yes" : "no"],
        ["Page in front", document.visibilityState === "visible" ? "yes" : "no"],
        ["Ticker animation", cs ? cs.animationName + ", " + cs.animationDuration + ", " + cs.animationPlayState : "no ticker on this page"],
        ["Ticker moved in the last second", view ? (Math.abs(now - before) > 0.5 ? "yes" : "no") : "no ticker on this page"],
        ["color-mix", can("color: color-mix(in srgb, red 50%, blue)") ? "yes" : "no"],
        ["overflow: clip", can("overflow: clip") ? "yes" : "no"],
        ["svh units", can("height: 1svh") ? "yes" : "no"],
        ["translate property", can("translate: 1px 0") ? "yes" : "no"],
        ["Window", window.innerWidth + " x " + window.innerHeight + ", pixel ratio " + window.devicePixelRatio],
        ["Browser", navigator.userAgent]
      ];
      before = now;
      out.textContent = "";
      facts.forEach(function (f) {
        var dt = document.createElement("dt"), dd = document.createElement("dd");
        dt.textContent = f[0];
        dd.textContent = f[1];
        out.appendChild(dt);
        out.appendChild(dd);
      });
    };
    setInterval(report, 1000);
  });

  // Lightbox. Every moment photo is a plain link to its largest JPEG; here a click
  // opens it in a native <dialog> instead (which traps focus, closes on Esc and makes
  // the page behind inert). Previous and next stay inside the photo's own grid.
  // A browser without <dialog> keeps the plain links.
  var photoLinks = document.querySelectorAll("a[data-lightbox]");
  if (photoLinks.length && window.HTMLDialogElement && HTMLDialogElement.prototype.showModal) {
    var el = function (tag, cls, parent) { var n = document.createElement(tag); n.className = cls; parent.appendChild(n); return n; };
    var button = function (parent, label, sign, onClick) {
      var b = el("button", "lightbox__btn", parent);
      b.type = "button"; b.textContent = sign; b.setAttribute("aria-label", label);
      b.addEventListener("click", onClick);
      return b;
    };
    var dialog = el("dialog", "lightbox on-photo", document.body);
    dialog.setAttribute("aria-label", t.lightbox_label);
    button(el("div", "lightbox__top", dialog), t.lightbox_close, "×", function () { shut(); });
    var stage = el("div", "lightbox__stage", dialog);
    var bar = el("div", "lightbox__bar", dialog);
    var prev = button(bar, t.lightbox_prev, "‹", function () { step(-1); });
    var caption = el("p", "lightbox__caption", bar);
    caption.setAttribute("aria-live", "polite");
    var next = button(bar, t.lightbox_next, "›", function () { step(1); });
    var group = [], at = 0;

    var show = function (i) {
      at = (i + group.length) % group.length;
      var link = group[at], thumb = link.querySelector("img"), card = link.closest("figure");
      var box = stage.getBoundingClientRect();
      var img = new Image();
      img.alt = thumb.alt;
      img.width = thumb.getAttribute("width");
      img.height = thumb.getAttribute("height");
      // The width the photo will really take on this screen, so the browser picks the
      // smallest file that is sharp enough (a phone never loads the widest one).
      img.sizes = Math.max(1, Math.round(Math.min(box.width, box.height * thumb.getAttribute("width") / thumb.getAttribute("height")))) + "px";
      img.srcset = link.getAttribute("data-srcset");
      img.src = link.href;
      stage.replaceChildren(img);
      var time = card.querySelector("time");
      caption.replaceChildren(card.querySelector(".moment__caption").textContent, " ", time.cloneNode(true));
    };
    var step = function (by) { if (group.length > 1) show(at + by); };

    photoLinks.forEach(function (link) {
      link.addEventListener("click", function (event) {
        // A click with a modifier key still opens the JPEG in a new tab or window.
        if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        group = Array.prototype.slice.call((link.closest("[data-lightbox-group]") || document).querySelectorAll("a[data-lightbox]"));
        prev.hidden = next.hidden = group.length < 2;
        document.documentElement.classList.add("is-lightbox-open");
        dialog.showModal();
        show(group.indexOf(link));
      });
    });
    // Every way out ends here: the close button, a click beside the photo, Esc (the
    // dialog's "cancel") and the dialog's own "close". Runs once per opening.
    var shut = function () {
      var root = document.documentElement;
      if (!root.classList.contains("is-lightbox-open")) return;
      root.classList.remove("is-lightbox-open");
      if (dialog.open) dialog.close();
      stage.replaceChildren();
      group[at].focus(); // back to the photo that was last shown
    };
    dialog.addEventListener("cancel", function (event) { event.preventDefault(); shut(); });
    dialog.addEventListener("close", shut);
    dialog.addEventListener("keydown", function (event) {
      if (event.key === "ArrowLeft") step(-1);
      if (event.key === "ArrowRight") step(1);
    });
    stage.addEventListener("click", function (event) { if (event.target === stage) shut(); });
    var touchX = null;
    stage.addEventListener("touchstart", function (event) { touchX = event.touches.length === 1 ? event.touches[0].clientX : null; }, { passive: true });
    stage.addEventListener("touchend", function (event) {
      if (touchX === null) return;
      var dx = event.changedTouches[0].clientX - touchX;
      touchX = null;
      if (Math.abs(dx) > 50) step(dx < 0 ? 1 : -1);
    }, { passive: true });
  }

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
