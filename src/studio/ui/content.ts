// The content screens of the Studio: photos with their albums, the menu, events.
// One shape for all three: the thing to do next is a button at the top and opens its form
// right there; below it is what the site has now, with pictures and dates a person can
// read. A background update redraws the list only, never an open form, so typing is kept.
// They only draw and ask; every rule lives on the server (src/studio/content-api.ts), in
// src/content.ts and in src/studio/calendar.ts. Every word comes from strings.ts.
import { dayShort, dayWords, whenWords, WEEK, type CalendarDay, type CalendarMonth } from "../calendar";
import type { StudioState } from "../server";
import type { Strings } from "../strings";
import { h, type Ctx, type Kid, type Section } from "./dom";

type Res = { status: number; data: any };
type Texts = { en: string; de: string };
const problem = (t: Strings, res: Res): HTMLElement => {
  const known = (code: unknown) => (t as unknown as Record<string, unknown>)["e_" + String(code)];
  const lines: string[] = (res.data.problems as string[] | undefined)?.map((p) => String(known(p) ?? p)) ?? [String(known(res.data.error) ?? t.failed(String(res.data.error ?? res.status)))];
  if (res.data.detail) lines.push(String(res.data.detail));
  return h("ul", { class: "problem" }, ...lines.map((line) => h("li", {}, line)));
};
const field = (label: string, ...kids: Kid[]) => h("label", { class: "field" }, h("span", { class: "field__label" }, label), ...kids);
const text = (props: Record<string, unknown> = {}) => h("input", { type: "text", ...props });
const area = () => h("textarea", { rows: 2 });
/** One text in both languages, side by side. */
function pair(t: Strings, label: string, make: () => HTMLInputElement | HTMLTextAreaElement = text, start?: Partial<Texts> | null) {
  const en = make(), de = make();
  en.lang = "en";
  de.lang = "de";
  en.value = start?.en ?? "";
  de.value = start?.de ?? "";
  const el = h("div", { class: "field" }, h("span", { class: "field__label" }, label), h("div", { class: "field__pair" }, field(t.in_english, en), field(t.in_german, de)));
  return { el, en, de, value: (): Texts => ({ en: en.value.trim(), de: de.value.trim() }) };
}
const options = (list: [string, string][], chosen = "") => list.map(([value, label]) => h("option", { value, selected: value === chosen }, label));
const base64 = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(file);
});
/** A picture of the working copy, served to this screen only. */
const photoSrc = (path: string) => `/_studio/photo/${path}`;
const thumb = (photo: string | null | undefined) => (photo ? h("img", { class: "thumb", src: photoSrc(photo), alt: "", loading: "lazy" }) : h("span", { class: "thumb thumb--none" }));
const okay = (words: string) => h("p", { class: "ok" }, words);

/** A button that asks before it does: the question and a yes appear in its place. */
function askFirst(t: Strings, label: string, question: string, yes: string, run: () => Promise<void>): HTMLElement {
  const holder = h("span", { class: "ask" });
  const closed = () => holder.replaceChildren(h("button", { class: "button button--quiet", type: "button", onclick: open }, label));
  const open = () => holder.replaceChildren(h("span", { class: "ask__box", role: "group" },
    h("span", { class: "ask__question" }, question),
    h("button", { class: "button button--danger", type: "button", onclick: async () => { closed(); await run(); } }, yes),
    h("button", { class: "button button--quiet", type: "button", onclick: closed }, t.cancel),
  ));
  closed();
  return holder;
}

/**
 * The picture of a form: the one that is there now, and a file field to put a new one.
 * A new one is looked at by the Mac first (where to cut, faces, an alt text draft, the
 * day it was taken); the form sends it along with everything else when it is saved.
 */
function picker(ctx: Ctx, opts: { label: string; current?: string | null; removable?: boolean; quiet?: boolean; onLooked?: (seen: any) => void; onChange?: () => void }) {
  const { t, api } = ctx;
  let current = opts.current ?? null;
  let shot: { base64: string; focus: [number, number] | null } | null = null;
  const view = h("div", { class: "picker__view" });
  const input = h("input", { type: "file", accept: "image/*" });
  const ask = h("span", { class: "field__label" });
  const off = h("button", { class: "button button--quiet", type: "button", onclick: () => { current = null; shot = null; input.value = ""; draw(); opts.onChange?.(); } }, t.picture_off);
  const draw = (notes: Kid[] = [], fresh?: string) => {
    const src = fresh ?? (current ? photoSrc(current) : null);
    ask.textContent = src ? t.picture_replace : t.picture_put;
    off.hidden = !opts.removable || !src;
    const dot = fresh && shot?.focus ? h("span", { class: "shot-dot" }) : null;
    if (dot && shot?.focus) { dot.style.left = `${shot.focus[0] * 100}%`; dot.style.top = `${shot.focus[1] * 100}%`; }
    view.replaceChildren(...[src ? h("div", { class: "shot-wrap" }, h("img", { class: "shot", src, alt: "" }), dot) : opts.quiet ? null : h("p", { class: "muted" }, t.picture_none), ...notes].filter((kid): kid is Node | string => !!kid));
  };
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    shot = null;
    view.replaceChildren(h("p", { class: "muted" }, t.photo_looking));
    const data = await base64(file);
    const res = await api("POST", "look", { base64: data, modified: file.lastModified });
    if (res.status !== 200) { input.value = ""; draw([problem(t, res)]); return opts.onChange?.(); }
    shot = { base64: data, focus: res.data.focus };
    draw([res.data.note ? h("p", { class: "problem" }, t.photo_no_vision(res.data.note)) : null, res.data.faces ? h("p", { class: "problem" }, t.photo_faces(res.data.faces)) : null], URL.createObjectURL(file));
    opts.onLooked?.(res.data);
    opts.onChange?.();
  };
  draw();
  return {
    el: h("div", { class: "field picker" }, h("span", { class: "field__label" }, opts.label), view, h("label", { class: "field" }, ask, input), off),
    /** The new picture, or null when none was picked. */
    value: () => shot,
    /** The picture that was there and stays, or null. */
    current: () => (shot ? null : current),
    has: () => !!(shot || current),
  };
}

type Ui = {
  /** What the site has now, as the server's overview; null until it is loaded. */
  content: any;
  /** Puts a form at the top of the screen, or takes it away. */
  open: (form: HTMLElement | null) => void;
  say: (...kids: Kid[]) => void;
  reload: () => Promise<void>;
};
type Parts = { top: (HTMLButtonElement | null)[]; list: (content: any) => Kid[]; bottom?: HTMLElement; onState?: (state: StudioState) => void };
const changesOf = (state: StudioState | null) => (state ? JSON.stringify(state.changes) : "");

/** A screen: buttons at the top, the open form under them, then what is there. */
function screen(id: string, title: (t: Strings) => string, make: (ctx: Ctx, ui: Ui) => Parts): Section {
  return {
    id, title,
    render(ctx) {
      const formAt = h("div", { class: "screen__form" });
      const said = h("div", { role: "status" });
      const list = h("div", { class: "screen__list" }, h("p", { class: "muted" }, ctx.t.loading));
      let drawn = "";
      const ui: Ui = {
        content: null,
        open(form) {
          formAt.replaceChildren(...(form ? [form] : []));
          if (!form) return;
          said.replaceChildren();
          form.scrollIntoView({ block: "start" });
          form.querySelector<HTMLElement>("input, textarea, select")?.focus({ preventScroll: true });
        },
        say: (...kids) => said.replaceChildren(...kids.filter((kid): kid is Node | string => !!kid)),
        async reload() {
          const res = await ctx.api("GET", "content");
          if (res.status !== 200) { drawn = ""; return list.replaceChildren(problem(ctx.t, res)); }
          // Drawn again only when something differs: pictures are not fetched twice for nothing.
          const now = JSON.stringify(res.data);
          ui.content = res.data;
          for (const button of parts.top) if (button) button.disabled = false;
          if (now === drawn) return;
          drawn = now;
          list.replaceChildren(...parts.list(res.data).filter((kid): kid is Node | string => !!kid));
        },
      };
      const parts = make(ctx, ui);
      for (const button of parts.top) if (button) button.disabled = true;
      // A discard, a restore or a hand edit changes the files under the list: read them again.
      let live = changesOf(ctx.state());
      ctx.onState((state) => {
        const now = changesOf(state);
        if (now !== live) void ui.reload();
        live = now;
        parts.onState?.(state);
      });
      void ui.reload();
      return h("div", { class: "screen" }, h("div", { class: "screen__top" }, ...parts.top), formAt, said, list, parts.bottom);
    },
  };
}

/** A form in a card: its fields, Save and Cancel. A refusal is said inside the form; a save closes it and reads the list again. */
function card(ctx: Ctx, ui: Ui, o: { title?: string; kids: Kid[]; submit: () => Promise<Res | null>; done: string; more?: Kid[]; save?: HTMLButtonElement; plain?: boolean }): HTMLFormElement {
  const { t } = ctx;
  const wrong = h("div", { role: "alert" });
  const save = o.save ?? h("button", { class: "button button--primary", type: "submit" }, t.save);
  return h("form", { class: o.plain ? "form" : "card card--form", onsubmit: async (event: Event) => {
    event.preventDefault();
    save.disabled = true;
    const res = await o.submit();
    save.disabled = false;
    if (!res) return;
    if (res.status !== 200) return wrong.replaceChildren(problem(t, res));
    ui.open(null);
    ui.say(okay(o.done));
    await ui.reload();
  } }, o.title ? h("h2", { class: "card__title" }, o.title) : null, ...o.kids, wrong,
    h("div", { class: "form__actions" }, save, h("button", { class: "button button--quiet", type: "button", onclick: () => ui.open(null) }, t.cancel), ...(o.more ?? [])));
}

const photos = screen("photos", (t) => t.sec_photos, (ctx, ui) => {
  const { t, api } = ctx;
  const loc = (v: Partial<Texts> | null | undefined) => v?.[ctx.lang] || v?.en || "";
  const NEW = "+";
  /** The album of a photo: one of those there, none, or a new one named right here. */
  const albumChoice = (chosen: string | null) => {
    const select = h("select", {}, ...options([["", t.photo_no_album], ...ui.content.albums.map((a: any): [string, string] => [a.slug, loc(a.title)]), [NEW, t.album_choose_new]], chosen ?? ""));
    const title = pair(t, t.album_title);
    title.el.hidden = true;
    select.onchange = () => { title.el.hidden = select.value !== NEW; };
    return { kids: [field(t.photo_album, select), title.el], value: () => (select.value === NEW ? { newAlbum: title.value() } : { album: select.value }) };
  };
  const feedSwitch = (on: boolean) => {
    const box = h("input", { type: "checkbox", checked: on });
    return { box, el: h("label", { class: "row__check" }, box, t.photo_feed) };
  };

  const addForm = () => {
    const caption = pair(t, t.photo_caption), alt = pair(t, t.photo_alt, area);
    const date = h("input", { type: "date" });
    const dateFrom = h("span", { class: "muted" });
    const album = albumChoice(null);
    const feed = feedSwitch(true);
    const save = h("button", { class: "button button--primary", type: "submit", disabled: true }, t.save);
    const rest = h("div", { class: "form", hidden: true }, field(t.photo_date_label, date, dateFrom), caption.el, alt.el, h("p", { class: "muted" }, t.photo_alt_draft), ...album.kids, feed.el);
    const picture = picker(ctx, { label: t.photo_pick, quiet: true, onLooked(seen) {
      date.value = seen.date;
      dateFrom.textContent = t[`photo_date_from_${seen.date_from as "picture" | "file" | "today"}`];
      if (!alt.en.value) alt.en.value = seen.draft.en;
      if (!alt.de.value) alt.de.value = seen.draft.de;
    }, onChange() {
      rest.hidden = save.disabled = !picture.value();
    } });
    return card(ctx, ui, { title: t.photo_add, kids: [h("p", { class: "muted" }, t.photo_help), picture.el, rest], save, done: t.photo_added, submit: async () => {
      const shot = picture.value();
      return shot ? api("POST", "photo", { ...shot, date: date.value, caption: caption.value(), alt: alt.value(), ...album.value(), feed: feed.box.checked }) : null;
    } });
  };

  const albumForm = () => {
    const title = pair(t, t.album_title);
    return card(ctx, ui, { title: t.album_new, kids: [title.el], done: t.album_added, submit: () => api("POST", "album", { title: title.value() }) });
  };

  const editForm = (m: any) => {
    const caption = pair(t, t.photo_caption, text, m.caption), alt = pair(t, t.photo_alt, area, m.alt);
    const album = albumChoice(m.album);
    const feed = feedSwitch(m.feed);
    const remove = askFirst(t, t.remove, t.photo_remove_sure, t.remove_yes, async () => {
      const res = await api("DELETE", "photo", { id: m.id });
      if (res.status !== 200) return ui.say(problem(t, res));
      ui.open(null);
      ui.say(okay(t.photo_removed));
      await ui.reload();
    });
    return card(ctx, ui, {
      title: t.photo_edit_title, done: t.photo_saved, more: [remove],
      kids: [m.photo ? h("img", { class: "shot", src: photoSrc(m.photo), alt: "" }) : null, h("p", { class: "muted" }, t.photo_date_is(dayWords(m.date, t))), caption.el, alt.el, ...album.kids, feed.el],
      submit: () => api("PUT", "photo", { id: m.id, caption: caption.value(), alt: alt.value(), ...album.value(), feed: feed.box.checked }),
    });
  };

  const tile = (m: any) => h("button", { class: "tile", type: "button", "aria-label": t.photo_open(loc(m.caption)), onclick: () => ui.open(editForm(m)) },
    m.photo ? h("img", { class: "tile__img", src: photoSrc(m.photo), alt: "", loading: "lazy" }) : null,
    h("span", { class: "tile__caption" }, loc(m.caption)),
    h("span", { class: "muted" }, dayShort(m.date, t)),
    m.feed ? null : h("span", { class: "tag" }, t.photo_not_on_home),
  );
  const group = (title: string, list: any[]) => h("section", { class: "group" },
    h("h3", { class: "group__title" }, title, h("span", { class: "muted" }, t.photos_count(list.length))),
    list.length ? h("div", { class: "tiles" }, ...list.map(tile)) : h("p", { class: "muted" }, t.album_empty),
  );

  return {
    top: [
      h("button", { class: "button button--primary", type: "button", onclick: () => ui.open(addForm()) }, t.photo_add),
      h("button", { class: "button", type: "button", onclick: () => ui.open(albumForm()) }, t.album_new),
    ],
    list: (content) => {
      const known = new Set<string>(content.albums.map((a: any) => a.slug));
      const loose = content.moments.filter((m: any) => !m.album || !known.has(m.album));
      return [
        h("p", { class: "muted" }, t.photos_help),
        ...content.albums.map((a: any) => group(loc(a.title), content.moments.filter((m: any) => m.album === a.slug))),
        loose.length || !content.albums.length ? group(t.photos_no_album, loose) : null,
      ];
    },
  };
});

const menu = screen("menu", (t) => t.sec_menu, (ctx, ui) => {
  const { t, api } = ctx;
  const loc = (v: Partial<Texts> | null | undefined) => v?.[ctx.lang] || v?.en || "";
  const NEW = "+";

  const drinkForm = (was: { part: string; drink: any } | null) => {
    const d = was?.drink;
    const part = h("select", {}, ...options([...ui.content.menu.map((s: any): [string, string] => [s.slug, loc(s.title)]), [NEW, t.menu_part_new]], was?.part ?? ""));
    const partTitle = pair(t, t.menu_part_title);
    const name = text({ value: d?.name ?? "" });
    const what = pair(t, t.drink_text, text, d?.text);
    const price = h("input", { type: "number", min: "0", step: "0.5", value: d ? String(d.price_chf) : "" });
    const alt = pair(t, t.photo_alt, area, d?.alt);
    const picture = picker(ctx, { label: t.drink_photo, current: d?.photo, removable: true, onLooked(seen) {
      // A draft for a new picture; the words of the old picture would describe the wrong one.
      alt.en.value = seen.draft.en;
      alt.de.value = seen.draft.de;
    }, onChange: () => sync() });
    const sync = () => { partTitle.el.hidden = part.value !== NEW; alt.el.hidden = !picture.has(); };
    part.onchange = sync;
    sync();
    return card(ctx, ui, {
      title: d ? t.drink_edit_title(d.name) : t.drink_add, done: t.drink_saved,
      kids: [field(t.drink_name, name), what.el, field(t.drink_price, price), field(t.menu_part, part), partTitle.el, picture.el, alt.el],
      submit: () => {
        const shot = picture.value(), kept = picture.current();
        const drink = { name: name.value, text: what.value(), price_chf: price.value === "" ? null : Number(price.value), ...(kept ? { photo: kept } : {}), ...(shot || kept ? { alt: alt.value() } : {}) };
        return api("POST", "drink", { ...(part.value === NEW ? { partTitle: partTitle.value() } : { part: part.value }), drink, ...(was ? { was: { part: was.part, name: d.name } } : {}), ...(shot ? { picture: shot } : {}) });
      },
    });
  };

  return {
    top: [h("button", { class: "button button--primary", type: "button", onclick: () => ui.open(drinkForm(null)) }, t.drink_add)],
    list: (content) => [
      h("p", { class: "muted" }, t.menu_help),
      ...content.menu.map((s: any) => h("section", { class: "group" },
        h("h3", { class: "group__title" }, loc(s.title)),
        s.drinks.length ? h("ul", { class: "rows" }, ...s.drinks.map((d: any) => h("li", { class: "row item" },
          thumb(d.photo),
          h("span", { class: "row__main" }, h("strong", {}, d.name), h("span", { class: "muted" }, loc(d.text))),
          h("span", { class: "item__price" }, t.price(d.price_chf)),
          h("span", { class: "item__actions" },
            h("button", { class: "button", type: "button", onclick: () => ui.open(drinkForm({ part: s.slug, drink: d })) }, t.edit),
            askFirst(t, t.remove, t.drink_remove_sure(d.name), t.remove_yes, async () => {
              const res = await api("DELETE", "drink", { part: s.slug, name: d.name });
              ui.say(res.status === 200 ? okay(t.drink_removed) : problem(t, res));
              await ui.reload();
            }),
          ),
        ))) : h("p", { class: "muted" }, t.none_yet),
      )),
    ],
  };
});

const events = screen("events", (t) => t.sec_events, (ctx, ui) => {
  const { t, api } = ctx;
  const kinds = (): [string, string][] => [["other", t.event_kind_other], ["music", t.event_kind_music], ["comedy", t.event_kind_comedy]];
  const maybe = (label: string) => `${label} (${t.optional})`;

  /** The form of one event: empty to add by hand, filled in to edit. */
  const eventForm = (was: { path: string; fields: any } | null, plain = false) => {
    const f = was?.fields ?? {};
    const title = text({ value: f.title ?? "" });
    const short = text({ value: f.name ?? "" });
    const when = h("select", {}, ...options([["day", t.event_when_day], ["dates", t.event_when_dates], ["weekly", t.event_when_weekly]], f.every ? "weekly" : f.dates ? "dates" : "day"));
    const day = h("input", { type: "date", value: f.every ? "" : f.date ?? "" });
    const days = area();
    days.value = (f.dates ?? []).join("\n");
    const weekday = h("select", {}, ...options(WEEK.map((d): [string, string] => [d, t[`day_${d}`]]), f.every ?? ""));
    const until = h("input", { type: "date", value: f.until ?? "" });
    const from = text({ class: "time", maxLength: 5, placeholder: "--:--", value: f.from ?? "" });
    const to = text({ class: "time", maxLength: 5, placeholder: "--:--", value: f.to ?? "" });
    const words = pair(t, maybe(t.event_text), area, f.text);
    const link = h("input", { type: "url", placeholder: "https://", value: f.ticket_url ?? "" });
    const price = h("input", { type: "number", min: "0", step: "0.5", value: f.price_chf == null ? "" : String(f.price_chf) });
    const kind = h("select", {}, ...options(kinds(), f.category ?? "other"));
    const picture = picker(ctx, { label: maybe(t.event_picture), current: f.image, removable: true });
    const fDay = field(t.event_day, day), fDays = field(t.event_days, days), fWeekday = field(t.event_weekday, weekday), fUntil = field(maybe(t.event_until), until);
    const sync = () => { fDay.hidden = when.value !== "day"; fDays.hidden = when.value !== "dates"; fWeekday.hidden = fUntil.hidden = when.value !== "weekly"; };
    when.onchange = sync;
    sync();
    // An import knows its exact times; they are shown in words and kept as they are.
    const whenKids: Kid[] = f.start
      ? [h("div", { class: "field" }, h("span", { class: "field__label" }, t.event_when), h("p", {}, whenWords(f, t).line), h("p", { class: "muted" }, t.event_exact))]
      : [field(t.event_when, when), fDay, fDays, fWeekday, fUntil, h("div", { class: "field__pair" }, field(maybe(t.event_from), from), field(maybe(t.event_to), to))];
    const whenValue = () => {
      if (f.start) return { start: f.start, end: f.end };
      const times = { ...(from.value.trim() ? { from: from.value.trim() } : {}), ...(to.value.trim() ? { to: to.value.trim() } : {}) };
      if (when.value === "day") return { date: day.value, ...times };
      if (when.value === "dates") return { dates: days.value.split(/[\s,]+/).filter(Boolean), ...times };
      // A weekly evening that starts on a later day keeps that day.
      return { every: weekday.value, ...(f.every && f.date ? { date: f.date } : {}), ...(until.value ? { until: until.value } : {}), ...times };
    };
    return card(ctx, ui, {
      plain, title: was ? t.event_edit_title(f.title ?? "") : undefined, done: was ? t.event_saved : t.event_added,
      kids: [field(t.event_title, title), ...whenKids, words.el, field(maybe(t.event_link), link, h("span", { class: "muted" }, t.event_link_help)), field(maybe(t.event_price), price), field(t.event_kind, kind), picture.el,
        field(maybe(t.event_name), short, h("span", { class: "muted" }, t.event_name_help))],
      submit: () => {
        const said = words.value(), shot = picture.value(), kept = picture.current();
        const event = { title: title.value, ...(short.value.trim() ? { name: short.value.trim() } : {}), ...whenValue(), ...(said.en || said.de ? { text: said } : {}), ticket_url: link.value.trim(), price_chf: price.value === "" ? null : Number(price.value), ...(kept ? { image: kept } : {}), category: kind.value };
        return api(was ? "PUT" : "POST", "event", { ...(was ? { path: was.path } : {}), event, ...(shot ? { picture: shot } : {}) });
      },
    });
  };

  /** Dates from Eventfrog: a pasted address, or the bar's own list with the key. */
  const fromEventfrog = () => {
    const address = h("input", { type: "url", placeholder: "https://eventfrog.ch/…", "aria-label": t.ef_address });
    const found = h("div", { class: "form" });
    const kind = h("select", {}, ...options(kinds()));
    const show = (res: Res) => {
      if (res.status !== 200) return found.replaceChildren(problem(t, res));
      const now = Date.now();
      const list: any[] = res.data.events.filter((e: any) => new Date(e.end).getTime() > now);
      const boxes = list.map(() => h("input", { type: "checkbox", checked: true }));
      found.replaceChildren(
        h("p", { class: "muted" }, t.ef_found(list.length)),
        h("ul", { class: "rows" }, ...list.map((e, i) => h("li", { class: "row" }, h("label", { class: "row__check" }, boxes[i], h("span", { class: "row__main" }, h("strong", {}, e.title), h("span", { class: "muted" }, whenWords({ start: e.start, end: e.end }, t).line)))))),
        field(t.event_kind, kind),
        h("div", { class: "form__actions" }, h("button", { class: "button button--primary", type: "button", onclick: async () => {
          const res2 = await api("POST", "eventfrog/add", { events: list.filter((_, i) => boxes[i]!.checked), category: kind.value });
          if (res2.status !== 200) return found.replaceChildren(problem(t, res2));
          ui.open(null);
          ui.say(okay(t.ef_added(res2.data.added, res2.data.skipped)));
          await ui.reload();
        } }, t.ef_add), h("button", { class: "button button--quiet", type: "button", onclick: () => ui.open(null) }, t.cancel)),
      );
    };
    return h("form", { class: "form", onsubmit: async (event: Event) => {
      event.preventDefault();
      found.replaceChildren(h("p", { class: "muted" }, t.ef_reading));
      show(await api("POST", "eventfrog/page", { address: address.value }));
    } }, h("p", { class: "muted" }, t.ef_help),
      h("div", { class: "card__row" }, address, h("button", { class: "button", type: "submit" }, t.ef_read)),
      h("div", { class: "form__actions" }, h("button", { class: "button button--quiet", type: "button", onclick: async () => {
        found.replaceChildren(h("p", { class: "muted" }, t.ef_reading));
        show(await api("GET", "eventfrog/list"));
      } }, t.ef_ours), h("button", { class: "button button--quiet", type: "button", onclick: () => ui.open(null) }, t.cancel)),
      found);
  };

  /** "Add an event": one card, two ways in. */
  const addForm = () => {
    const body = h("div", {});
    const ways: [HTMLButtonElement, () => HTMLElement][] = [
      [h("button", { class: "switch__way", type: "button" }, t.event_way_hand), () => eventForm(null, true)],
      [h("button", { class: "switch__way", type: "button" }, t.event_way_eventfrog), fromEventfrog],
    ];
    const pick = (at: number) => {
      ways.forEach(([button], i) => button.setAttribute("aria-pressed", String(i === at)));
      body.replaceChildren(ways[at]![1]());
    };
    ways.forEach(([button], i) => button.addEventListener("click", () => pick(i)));
    pick(0);
    return h("div", { class: "card card--form" }, h("h2", { class: "card__title" }, t.event_add), h("div", { class: "switch", role: "group", "aria-label": t.event_way }, ...ways.map(([button]) => button)), body);
  };

  // The calendar: what the preview's own events.json holds, so it is what the site will show.
  const calendar = h("section", { class: "cal" });
  let calendarDrawn = "";
  const dayCell = (d: CalendarDay, code: (typeof WEEK)[number]) => h("div", { class: ["cal__day", !d.inMonth && "cal__day--out", d.past && "cal__day--past", d.today && "cal__day--today", !d.events.length && "cal__day--empty"].filter(Boolean).join(" ") },
    d.inMonth ? h("span", { class: "cal__num" }, h("span", { class: "cal__dow" }, t.day_short(code)), String(d.number)) : null,
    ...d.events.map((e) => {
      const label = [e.time ? h("span", { class: "cal__time" }, e.time) : null, e.name];
      if (!e.file) return h("span", { class: "cal__event" }, ...label);
      return h("button", { class: "cal__event cal__event--mine", type: "button", title: t.cal_open(e.name), onclick: () => {
        const mine = ui.content?.events.find((x: any) => x.path === `site/events/${e.file}.md`);
        if (mine) ui.open(eventForm(mine));
      } }, ...label);
    }),
  );
  const month = (m: CalendarMonth) => h("div", { class: "cal__month" },
    h("h4", { class: "cal__name" }, t.month_title(t.month(m.month), m.year)),
    h("div", { class: "cal__grid" }, ...WEEK.map((d) => h("span", { class: "cal__head" }, t.day_short(d))), ...m.weeks.flat().map((d, i) => dayCell(d, WEEK[i % 7]!))),
  );
  const drawCalendar = async () => {
    const res = await api("GET", "calendar");
    if (res.status !== 200) return;
    const now = JSON.stringify(res.data);
    if (now === calendarDrawn) return;
    calendarDrawn = now;
    const months: CalendarMonth[] = res.data.months;
    calendar.replaceChildren(h("h3", { class: "group__title" }, t.cal_title), h("p", { class: "muted" }, !res.data.built ? t.cal_waiting : months.length ? t.cal_help : t.cal_empty), ...months.map(month));
  };
  void drawCalendar();

  return {
    top: [h("button", { class: "button button--primary", type: "button", onclick: () => ui.open(addForm()) }, t.event_add)],
    list: (content) => [
      h("p", { class: "muted" }, t.events_help),
      h("section", { class: "group" },
        h("h3", { class: "group__title" }, t.events_yours),
        content.events.length ? h("ul", { class: "rows" }, ...content.events.map((e: any) => {
          const when = whenWords(e.fields, t);
          return h("li", { class: "row item" },
            thumb(e.fields.image),
            h("span", { class: "row__main" },
              h("strong", {}, e.title),
              h("span", {}, when.line),
              when.days.length ? h("ul", { class: "days" }, ...when.days.map((d) => h("li", {}, d))) : null,
              e.source === "eventfrog" ? h("span", { class: "tag" }, t.event_from_eventfrog) : null,
            ),
            h("span", { class: "item__actions" },
              h("button", { class: "button", type: "button", onclick: () => ui.open(eventForm(e)) }, t.edit),
              askFirst(t, t.remove, t.event_remove_sure(e.title), t.remove_yes, async () => {
                const res = await api("DELETE", "event", { path: e.path });
                ui.say(res.status === 200 ? okay(t.event_removed) : problem(t, res));
                await ui.reload();
              }),
            ),
          );
        })) : h("p", { class: "muted" }, t.none_yet),
      ),
    ],
    bottom: calendar,
    // Every build may change what is coming up; the calendar is drawn again only when it differs.
    onState: () => void drawCalendar(),
  };
});

/** What the Studio uses on this Mac, as a block of the settings screen. */
export function toolsBlock(ctx: Ctx): HTMLElement {
  const { t } = ctx;
  const why = (key: string) => (t as unknown as Record<string, string>)[key] ?? "";
  const holder = h("div", { class: "form" }, h("p", { class: "muted" }, t.loading));
  void ctx.api("GET", "content").then((res) => {
    if (res.status !== 200) return holder.replaceChildren(problem(t, res));
    holder.replaceChildren(...res.data.tools.map((tool: any) => h("div", { class: "card" },
      h("h3", { class: "card__title" }, h("code", {}, tool.name), h("span", { class: "pill", "data-status": tool.found ? "ok" : "none" }, tool.found ? t.tools_found : t.tools_missing), tool.needed && !tool.found ? h("span", { class: "pill" }, t.tools_needed) : null),
      h("p", { class: "muted" }, why(tool.why)),
      tool.found ? null : h("code", { class: "install" }, tool.install),
    )));
  });
  return h("section", { class: "form" }, h("h2", {}, t.sec_tools), h("p", { class: "muted" }, t.tools_help), holder);
}

export const CONTENT_SECTIONS: Section[] = [photos, menu, events];
