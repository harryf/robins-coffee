// The content sections of the Studio: photos, albums, the menu, events, this Mac's tools.
// They only draw and ask; every rule lives on the server (src/studio/content-api.ts) and
// in src/content.ts. Every word comes from strings.ts.
import type { Strings } from "../strings";
import { h, type Ctx, type Kid, type Section } from "./dom";

type Res = { status: number; data: any };
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
function pair(t: Strings, label: string, make: () => HTMLInputElement | HTMLTextAreaElement = text) {
  const en = make(), de = make();
  en.lang = "en";
  de.lang = "de";
  const el = h("div", { class: "field" }, h("span", { class: "field__label" }, label), h("div", { class: "field__pair" }, field(t.in_english, en), field(t.in_german, de)));
  return { el, en, de, value: () => ({ en: en.value.trim(), de: de.value.trim() }), clear: () => { en.value = ""; de.value = ""; } };
}
const options = (list: [string, string][], chosen = "") => list.map(([value, label]) => h("option", { value, selected: value === chosen }, label));
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const base64 = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(file);
});
const photoLabel = (path: string) => path.replace(/^photos\//, "").replace(/\.jpg$/, "");

/** A section that loads the overview first and draws again after every change. */
function withContent(id: string, title: (t: Strings) => string, draw: (ctx: Ctx, content: any, again: () => void, said: HTMLElement) => HTMLElement): Section {
  return {
    id, title,
    render(ctx) {
      const holder = h("div", {}, h("p", { class: "muted" }, ctx.t.loading));
      const said = h("div", { role: "status" });
      const root = h("div", { class: "form" }, holder, said);
      const load = async () => {
        const res = await ctx.api("GET", "content");
        holder.replaceChildren(res.status === 200 ? draw(ctx, res.data, () => void load(), said) : problem(ctx.t, res));
      };
      void load();
      return root;
    },
  };
}

const photos = withContent("photos", (t) => t.sec_photos, (ctx, content, again, said) => {
  const { t, api } = ctx;
  const pick = h("input", { type: "file", accept: "image/*" });
  const seenBox = h("div", { class: "form" });
  const kind = h("select", {}, ...options([["moment", t.photo_kind_moment], ["plain", t.photo_kind_plain]]));
  const date = h("input", { type: "date", value: today() });
  const name = text({ placeholder: t.photo_name_help });
  const caption = pair(t, t.photo_caption);
  const alt = pair(t, t.photo_alt, area);
  const album = h("select", {}, ...options([["", t.photo_no_album], ...content.albums.map((a: any): [string, string] => [a.slug, a.title[ctx.lang] ?? a.title.en])]));
  const feed = h("input", { type: "checkbox", checked: true });
  const momentOnly = h("div", { class: "form" }, field(t.photo_date, date), caption.el, alt.el, h("p", { class: "muted" }, t.photo_alt_draft), field(t.photo_album, album), h("label", { class: "row__check" }, feed, t.photo_feed));
  kind.onchange = () => { momentOnly.hidden = kind.value === "plain"; };
  const save = h("button", { class: "button button--primary", type: "submit", disabled: true }, t.add);
  let data = "";
  let focus: [number, number] | null = null;

  pick.onchange = async () => {
    const file = pick.files?.[0];
    if (!file) return;
    said.replaceChildren();
    save.disabled = true;
    seenBox.replaceChildren(h("p", { class: "muted" }, t.photo_looking));
    data = await base64(file);
    const res = await api("POST", "look", { base64: data });
    if (res.status !== 200) return seenBox.replaceChildren(problem(t, res));
    focus = res.data.focus;
    const shot = h("img", { class: "shot", src: URL.createObjectURL(file), alt: "" });
    const dot = focus ? h("span", { class: "shot-dot" }) : null;
    if (dot && focus) { dot.style.left = `${focus[0] * 100}%`; dot.style.top = `${focus[1] * 100}%`; }
    seenBox.replaceChildren(...[
      h("div", { class: "shot-wrap" }, shot, dot),
      res.data.note ? h("p", { class: "problem" }, t.photo_no_vision(res.data.note)) : null,
      res.data.faces ? h("p", { class: "problem" }, t.photo_faces(res.data.faces)) : null,
    ].filter((el): el is HTMLDivElement | HTMLParagraphElement => !!el));
    if (!alt.en.value) alt.en.value = res.data.draft.en;
    if (!alt.de.value) alt.de.value = res.data.draft.de;
    // A camera or download name made of digits says nothing: better an empty field than a bad name.
    const guess = file.name.replace(/\.[a-z0-9]+$/i, "").replace(/[^a-zA-Z]+/g, " ").trim().toLowerCase();
    if (!name.value && guess.length > 3 && !/^(img|dsc|image|photo|pxl|n)\b/.test(guess)) name.value = guess.slice(0, 40);
    save.disabled = false;
  };

  return h("form", { class: "form", onsubmit: async (event: Event) => {
    event.preventDefault();
    save.disabled = true;
    const res = await api("POST", "photo", { base64: data, kind: kind.value, slug: name.value, date: date.value, caption: caption.value(), alt: alt.value(), album: album.value, feed: feed.checked, focus });
    save.disabled = false;
    if (res.status !== 200) return said.replaceChildren(problem(t, res));
    said.replaceChildren(h("p", { class: "ok" }, t.photo_added));
    again();
  } }, h("p", { class: "muted" }, t.photo_help), field(t.photo_pick, pick), seenBox, field(t.photo_kind, kind), field(t.photo_name, name), momentOnly, h("div", { class: "form__actions" }, save));
});

const albums = withContent("albums", (t) => t.sec_albums, (ctx, content, again, said) => {
  const { t, api } = ctx;
  const title = pair(t, t.album_title);
  return h("div", { class: "form" },
    h("p", { class: "muted" }, t.albums_help),
    content.albums.length ? h("ul", { class: "rows" }, ...content.albums.map((a: any) => h("li", { class: "row" }, h("span", {}, a.title[ctx.lang] ?? a.title.en), h("span", { class: "muted" }, a.slug)))) : h("p", { class: "muted" }, t.none_yet),
    h("form", { class: "card", onsubmit: async (event: Event) => {
      event.preventDefault();
      const res = await api("POST", "album", { title: title.value() });
      if (res.status !== 200) return said.replaceChildren(problem(t, res));
      said.replaceChildren(h("p", { class: "ok" }, t.album_added));
      again();
    } }, title.el, h("div", { class: "form__actions" }, h("button", { class: "button button--primary", type: "submit" }, t.add))),
  );
});

const menu = withContent("menu", (t) => t.sec_menu, (ctx, content, again, said) => {
  const { t, api } = ctx;
  const NEW = "+";
  const part = h("select", {}, ...options([...content.menu.map((s: any): [string, string] => [s.slug, s.title[ctx.lang] ?? s.title.en]), [NEW, t.menu_part_new]]));
  const partTitle = pair(t, t.menu_part_title);
  partTitle.el.hidden = part.value !== NEW;
  part.onchange = () => { partTitle.el.hidden = part.value !== NEW; };
  const name = text();
  const what = pair(t, t.drink_text);
  const price = h("input", { type: "number", min: "0", step: "0.5" });
  const photo = h("select", {}, ...options([["", t.drink_no_photo], ...content.photos.map((p: string): [string, string] => [p, photoLabel(p)])]));
  const alt = pair(t, t.photo_alt, area);
  alt.el.hidden = true;
  photo.onchange = () => { alt.el.hidden = !photo.value; };
  const list = content.menu.flatMap((s: any) => [
    h("h3", {}, s.title[ctx.lang] ?? s.title.en),
    h("ul", { class: "rows" }, ...s.drinks.map((d: any) => h("li", { class: "row" },
      h("span", { class: "row__main" }, h("strong", {}, d.name), h("span", { class: "muted" }, `${d.text?.[ctx.lang] ?? ""} · CHF ${d.price_chf}`)),
      h("button", { class: "button button--quiet", type: "button", onclick: async () => {
        const res = await api("DELETE", "drink", { part: s.slug, name: d.name });
        if (res.status !== 200) return said.replaceChildren(problem(t, res));
        again();
      } }, t.remove),
    ))),
  ]);
  return h("div", { class: "form" },
    h("p", { class: "muted" }, t.menu_help), ...list,
    h("form", { class: "card", onsubmit: async (event: Event) => {
      event.preventDefault();
      const drink = { name: name.value, text: what.value(), price_chf: price.value === "" ? NaN : Number(price.value), ...(photo.value ? { photo: photo.value, alt: alt.value() } : {}) };
      const res = await api("POST", "drink", part.value === NEW ? { drink, partTitle: partTitle.value() } : { part: part.value, drink });
      if (res.status !== 200) return said.replaceChildren(problem(t, res));
      said.replaceChildren(h("p", { class: "ok" }, t.drink_saved));
      again();
    } }, field(t.menu_part, part), partTitle.el, field(t.drink_name, name), what.el, field(t.drink_price, price), field(t.drink_photo, photo), alt.el, h("div", { class: "form__actions" }, h("button", { class: "button button--primary", type: "submit" }, t.save))),
  );
});

const events = withContent("events", (t) => t.sec_events, (ctx, content, again, said) => {
  const { t, api } = ctx;
  const DAYS = ["mo", "tu", "we", "th", "fr", "sa", "su"] as const;
  const dayName = (d: string) => (t as unknown as Record<string, string>)[`day_${d}`] ?? d;
  const whenText = (w: any) => (w.kind === "weekly" ? t.event_weekly(dayName(w.every)) : w.kind === "dates" ? t.event_dates(w.count, w.first) : w.day);
  const kinds = (): [string, string][] => [["other", t.event_kind_other], ["music", t.event_kind_music], ["comedy", t.event_kind_comedy]];

  const yours = content.events.length
    ? h("ul", { class: "rows" }, ...content.events.map((e: any) => h("li", { class: "row" },
        h("span", { class: "row__main" }, h("strong", {}, e.title), h("span", { class: "muted" }, whenText(e.when) + (e.source === "eventfrog" ? ` · ${t.event_from_eventfrog}` : ""))),
        h("button", { class: "button button--quiet", type: "button", onclick: async () => {
          const res = await api("DELETE", "event", { path: e.path });
          if (res.status !== 200) return said.replaceChildren(problem(t, res));
          again();
        } }, t.remove),
      )))
    : h("p", { class: "muted" }, t.none_yet);

  // By hand
  const title = text();
  const when = h("select", {}, ...options([["day", t.event_when_day], ["dates", t.event_when_dates], ["weekly", t.event_when_weekly]]));
  const day = h("input", { type: "date" });
  const days = area();
  const weekday = h("select", {}, ...options(DAYS.map((d): [string, string] => [d, dayName(d)])));
  const until = h("input", { type: "date" });
  const from = text({ class: "time", maxLength: 5, placeholder: "--:--" });
  const to = text({ class: "time", maxLength: 5, placeholder: "--:--" });
  const words = pair(t, `${t.event_text} (${t.optional})`, area);
  const link = h("input", { type: "url", placeholder: "https://" });
  const price = h("input", { type: "number", min: "0", step: "0.5" });
  const picture = h("select", {}, ...options([["", t.event_no_picture], ...content.photos.map((p: string): [string, string] => [p, photoLabel(p)])]));
  const kind = h("select", {}, ...options(kinds()));
  const fDay = field(t.event_day, day), fDays = field(t.event_days, days), fWeekday = field(t.event_weekday, weekday), fUntil = field(`${t.event_until} (${t.optional})`, until);
  const sync = () => { fDay.hidden = when.value !== "day"; fDays.hidden = when.value !== "dates"; fWeekday.hidden = fUntil.hidden = when.value !== "weekly"; };
  when.onchange = sync;
  sync();
  const byHand = h("form", { class: "card", onsubmit: async (event: Event) => {
    event.preventDefault();
    const said2 = words.value();
    const res = await api("POST", "event", { event: {
      title: title.value,
      ...(when.value === "day" ? { date: day.value } : when.value === "dates" ? { dates: days.value.split(/[\s,]+/).filter(Boolean) } : { every: weekday.value, ...(until.value ? { until: until.value } : {}) }),
      ...(from.value.trim() ? { from: from.value.trim() } : {}), ...(to.value.trim() ? { to: to.value.trim() } : {}),
      ...(said2.en || said2.de ? { text: said2 } : {}),
      ticket_url: link.value.trim(), price_chf: price.value === "" ? null : Number(price.value), ...(picture.value ? { image: picture.value } : {}), category: kind.value,
    } });
    if (res.status !== 200) return said.replaceChildren(problem(t, res));
    said.replaceChildren(h("p", { class: "ok" }, t.event_added));
    again();
  } }, h("h3", { class: "card__title" }, t.event_by_hand), field(t.event_title, title), field(t.event_when, when), fDay, fDays, fWeekday, fUntil,
    h("div", { class: "field__pair" }, field(`${t.event_from} (${t.optional})`, from), field(`${t.event_to} (${t.optional})`, to)),
    words.el, field(`${t.event_link} (${t.optional})`, link, h("span", { class: "muted" }, t.event_link_help)), field(`${t.event_price} (${t.optional})`, price), field(`${t.event_picture} (${t.optional})`, picture), field(t.event_kind, kind),
    h("div", { class: "form__actions" }, h("button", { class: "button button--primary", type: "submit" }, t.add)));

  // From Eventfrog
  const address = h("input", { type: "url", placeholder: "https://eventfrog.ch/…" });
  const found = h("div", { class: "form" });
  const efKind = h("select", {}, ...options(kinds()));
  const show = (res: Res) => {
    if (res.status !== 200) return found.replaceChildren(problem(t, res));
    const now = Date.now();
    const list: any[] = res.data.events.filter((e: any) => new Date(e.end).getTime() > now);
    const boxes = list.map((e) => h("input", { type: "checkbox", checked: true }));
    const stamp = (iso: string) => new Date(iso).toLocaleString(ctx.lang === "de" ? "de-CH" : "en-GB", { dateStyle: "medium", timeStyle: "short" });
    found.replaceChildren(
      h("p", { class: "muted" }, t.ef_found(list.length)),
      h("ul", { class: "rows" }, ...list.map((e, i) => h("li", { class: "row" }, h("label", { class: "row__check" }, boxes[i], h("span", { class: "row__main" }, h("strong", {}, e.title), h("span", { class: "muted" }, stamp(e.start))))))),
      field(t.event_kind, efKind),
      h("div", { class: "form__actions" }, h("button", { class: "button button--primary", type: "button", onclick: async () => {
        const res2 = await api("POST", "eventfrog/add", { events: list.filter((_, i) => boxes[i]!.checked), category: efKind.value });
        if (res2.status !== 200) return said.replaceChildren(problem(t, res2));
        said.replaceChildren(h("p", { class: "ok" }, t.ef_added(res2.data.added, res2.data.skipped)));
        again();
      } }, t.ef_add)),
    );
  };
  const fromEventfrog = h("form", { class: "card", onsubmit: async (event: Event) => {
    event.preventDefault();
    found.replaceChildren(h("p", { class: "muted" }, t.ef_reading));
    show(await api("POST", "eventfrog/page", { address: address.value }));
  } }, h("h3", { class: "card__title" }, t.ef_title), h("p", { class: "muted" }, t.ef_help),
    h("div", { class: "card__row" }, address, h("button", { class: "button", type: "submit" }, t.ef_read)),
    h("div", { class: "form__actions" }, h("button", { class: "button button--quiet", type: "button", onclick: async () => {
      found.replaceChildren(h("p", { class: "muted" }, t.ef_reading));
      show(await api("GET", "eventfrog/list"));
    } }, t.ef_ours)),
    found);

  return h("div", { class: "form" }, h("p", { class: "muted" }, t.events_help), h("h3", {}, t.events_yours), yours, byHand, fromEventfrog);
});

const tools = withContent("tools", (t) => t.sec_tools, (ctx, content) => {
  const { t } = ctx;
  const why = (key: string) => (t as unknown as Record<string, string>)[key] ?? "";
  return h("div", { class: "form" },
    h("p", { class: "muted" }, t.tools_help),
    ...content.tools.map((tool: any) => h("div", { class: "card" },
      h("h3", { class: "card__title" }, h("code", {}, tool.name), h("span", { class: "pill", "data-status": tool.found ? "ok" : "none" }, tool.found ? t.tools_found : t.tools_missing), tool.needed && !tool.found ? h("span", { class: "pill" }, t.tools_needed) : null),
      h("p", { class: "muted" }, why(tool.why)),
      tool.found ? null : h("code", { class: "install" }, tool.install),
    )),
  );
});

export const CONTENT_SECTIONS: Section[] = [photos, albums, menu, events, tools];
