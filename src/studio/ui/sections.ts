// The registry of sections. To add a form (photos, albums, menu, events): write a
// Section and put it in SECTIONS. The shell reads this list and nothing else.
import { DAYS, type Week } from "../../editor/changes";
import type { HistoryEntry } from "../history";
import { KEY_NAMES } from "../keychain";
import { STRINGS, type Lang } from "../strings";
import { h, type Ctx, type Section } from "./dom";
import { CONTENT_SECTIONS } from "./content";
import { systemCards } from "./system";

const HOURS_PATH = "site/data/hours.yml";

const hours: Section = {
  id: "hours",
  title: (t) => t.sec_hours,
  render(ctx) {
    const { t, api } = ctx;
    const holder = h("div", {}, h("p", { class: "muted" }, t.loading));
    const said = h("div", { role: "status" });
    const root = h("div", {}, holder, said);
    let dirty = false;
    let live = "";

    async function load() {
      const res = await api("GET", "hours");
      if (res.status !== 200) return holder.replaceChildren(h("p", { class: "problem" }, t.failed(String(res.data.error ?? res.status))));
      if (!res.data.editable) return holder.replaceChildren(h("p", { class: "problem" }, t.hours_closed_form));
      const week = res.data.week as Week;
      dirty = false;
      const rows = DAYS.map((d) => {
        const day = t[`day_${d}`];
        // Plain text fields, not time pickers: a picker follows the Mac's own clock style and would
        // show 4:00 PM, while the site and hours.yml speak 16:00. The server checks what is typed.
        const time = (value: string, label: string) => h("input", { type: "text", class: "time", inputMode: "numeric", maxLength: 5, placeholder: "--:--", value, "aria-label": label, oninput: () => (dirty = true) });
        const open = time(week[d].open, t.opens(day));
        const close = time(week[d].close ?? "", t.closes(day));
        const closed = h("input", { type: "checkbox", checked: week[d].closed, onchange: () => { dirty = true; sync(); } });
        const sync = () => { open.disabled = close.disabled = closed.checked; };
        sync();
        return { d, open, close, closed, el: h("div", { class: "day" }, h("span", { class: "day__name" }, day), h("span", { class: "day__times" }, open, h("span", { class: "muted" }, t.to), close), h("label", { class: "day__closed" }, closed, t.closed)) };
      });
      const save = h("button", { class: "button button--primary", type: "submit" }, t.save);
      holder.replaceChildren(h("form", { class: "form", onsubmit: async (event: Event) => {
        event.preventDefault();
        const next = Object.fromEntries(rows.map((r) => [r.d, { closed: r.closed.checked, open: r.closed.checked ? week[r.d].open : r.open.value.trim(), close: r.close.value.trim() || null }])) as Week;
        save.disabled = true;
        const res = await api("PUT", "hours", { week: next, lang: ctx.lang });
        save.disabled = false;
        if (res.status === 200) {
          dirty = false;
          said.replaceChildren(h("p", { class: "ok" }, t.hours_saved));
        } else if (res.status === 422) {
          // The server words a problem as "<day code>: <reason>" in the screen's language; the day gets its name here.
          said.replaceChildren(h("ul", { class: "problem" }, ...(res.data.problems as string[]).map((p) => h("li", {}, p.replace(/^(mo|tu|we|th|fr|sa|su)\b/, (d) => t[`day_${d as (typeof DAYS)[number]}`])))));
        } else said.replaceChildren(h("p", { class: "problem" }, res.data.error === "hours_closed_form" ? t.hours_closed_form : t.failed(String(res.data.error ?? res.status))));
      } }, h("p", { class: "muted" }, t.hours_help), ...rows.map((r) => r.el), h("div", { class: "form__actions" }, save)));
    }

    void load();
    // A discard or a hand edit changes the file under the form: read it again unless the person is typing.
    ctx.onState((state) => {
      const now = JSON.stringify(state.changes.find((c) => c.path === HOURS_PATH) ?? null);
      if (now !== live && !dirty && live !== "") void load();
      live = now;
    });
    return root;
  },
};

const history: Section = {
  id: "history",
  title: (t) => t.sec_history,
  render({ t, api, lang }) {
    const root = h("div", {}, h("p", { class: "muted" }, t.loading));
    void api("GET", "history").then((res) => {
      if (res.status !== 200) return root.replaceChildren(h("p", { class: "problem" }, t.failed(String(res.data.error ?? res.status))));
      const entries = res.data.entries as HistoryEntry[];
      if (!entries.length) return root.replaceChildren(h("p", { class: "muted" }, t.history_empty));
      const when = (iso: string) => new Date(iso).toLocaleString(lang === "de" ? "de-CH" : "en-GB", { dateStyle: "medium", timeStyle: "short" });
      root.replaceChildren(
        h("p", { class: "muted" }, t.history_help),
        h("table", { class: "history" },
          h("thead", {}, h("tr", {}, h("th", { scope: "col" }, t.history_when), h("th", { scope: "col" }, t.history_what), h("th", { scope: "col" }, t.history_who))),
          h("tbody", {}, ...entries.map((e) => h("tr", {}, h("td", { class: "history__when" }, when(e.date)), h("td", {}, e.what), h("td", { class: "muted" }, e.who)))),
        ),
      );
    });
    return root;
  },
};

const settings: Section = {
  id: "settings",
  title: (t) => t.sec_settings,
  render(ctx) {
    const { t, api } = ctx;
    const language = h("select", { id: "studio-lang", onchange: () => ctx.setLang(language.value as Lang) }, ...(Object.keys(STRINGS) as Lang[]).map((l) => h("option", { value: l, selected: l === ctx.lang }, STRINGS[l].lang_name)));
    const cards = KEY_NAMES.map((name) => {
      const label = t[`key_${name}`];
      const status = h("span", { class: "pill" });
      const said = h("div", { role: "status" });
      // The field only ever takes a new value in. A saved key is never sent back to this screen.
      const input = h("input", { type: "password", autocomplete: "off", spellcheck: false, placeholder: t.key_paste(label), "aria-label": t.key_paste(label) });
      const remove = h("button", { class: "button button--quiet", type: "button", onclick: async () => {
        await api("DELETE", `keys/${name}`);
        said.replaceChildren();
      } }, t.key_remove);
      const show = (saved: boolean | null) => {
        status.textContent = saved === null ? t.keys_unavailable : saved ? t.key_saved : t.key_not_saved;
        status.dataset.status = saved ? "ok" : "none";
        remove.hidden = !saved;
      };
      show(ctx.state()?.keys?.[name] ?? false);
      ctx.onState((state) => show(state.keys ? !!state.keys[name] : null));
      return h("form", { class: "card", onsubmit: async (event: Event) => {
        event.preventDefault();
        const res = await api("PUT", `keys/${name}`, { value: input.value });
        input.value = "";
        said.replaceChildren(res.status === 200 ? h("p", { class: "ok" }, t.saved) : h("p", { class: "problem" }, res.data.error === "key_bad" ? t.key_bad : t.failed(String(res.data.error ?? res.status))));
      } }, h("h3", { class: "card__title" }, label, " ", status), h("p", { class: "muted" }, t[`key_${name}_help`]), h("div", { class: "card__row" }, input, h("button", { class: "button", type: "submit" }, t.save), remove), said);
    });
    return h("div", { class: "form" },
      h("div", { class: "card" }, h("label", { class: "card__title", for: "studio-lang" }, t.language), language),
      h("h2", {}, t.keys_title), h("p", { class: "muted" }, t.keys_help), ...cards,
      ...systemCards(ctx),
    );
  },
};

export const SECTIONS: Section[] = [hours, ...CONTENT_SECTIONS, history, settings];
