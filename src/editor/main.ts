// The editor at /edit/: post a photo, change the opening hours, see the real page, send
// the change for publishing, say yes or no to someone else's change. No framework: a
// handful of screens drawn with the DOM. Everything that can be decided without a
// screen lives in changes.ts, github.ts and version.ts; the words are in strings.ts.
//
// The site's files arrive in one bundle the build wrote next to this script
// (edit/site.json), so looking and trying needs no login. The unsent change is kept on
// the device (store.ts). GitHub is asked only when a change is sent or decided.
import { renderSite, type Files, type Photo } from "../render";
import { DAYS, weekFromYaml, weekToYaml, validateWeek, hoursEditable, validateMoment, momentChanges, momentId, slugify, branchName, describe, staleChanges, localLabel, whatChanged, verdict, type Change, type Week, type NewMoment, type Verdict } from "./changes";
import { github, GitHubError, type Pull } from "./github";
import { cleanInBrowser, type CleanPhoto } from "./photo";
import { loadDraft, saveDraft } from "./store";
import { STRINGS, pickLang, type Lang } from "./strings";
import { updateState, type UpdateState, type VersionInfo } from "./version";
import { parse as parseYaml } from "yaml";

declare const EDITOR_VERSION: string; // set by the build from src/editor/version.json

type Bundle = { built_at: string; commit: string | null; build: string; base: string; preview_root: string; version: string; repo: string; branch: string; files: Files; photos: Record<string, Photo> };
type Child = Node | string | null | undefined | false;

const TOKEN_KEY = "robins-editor-token";
const LANG_KEY = "robins-editor-lang";
const HOURS = "data/hours.yml";
const root = document.getElementById("editor")!;
const notice = document.createElement("div"); // the update notice: stays on top of every screen
let bundle: Bundle;
let draft: Change[] = [];
let draftPhotos: Record<string, Photo> = {};
let kept = true; // false when this browser could not keep the draft
let update: UpdateState = "current";
let token: string | null = null;
let who: { login: string; canWrite: boolean; owner: boolean } | null = null;
let lang: Lang = "en";
try {
  token = localStorage.getItem(TOKEN_KEY);
  lang = pickLang(localStorage.getItem(LANG_KEY), navigator.language);
} catch { lang = pickLang(null, navigator.language); /* private window: sign in each time */ }
let t = STRINGS[lang];

function h(tag: string, attrs: Record<string, any> = {}, ...children: Child[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, "");
    else if (v !== false && v != null) el.setAttribute(k, String(v));
  }
  el.append(...children.filter((c): c is Node | string => c !== null && c !== undefined && c !== false));
  return el;
}
const button = (label: string, onclick: () => void, neon = false) => h("button", { type: "button", class: neon ? "btn btn--neon" : "btn", onclick }, label);
const linkButton = (label: string, onclick: () => void) => h("button", { type: "button", class: "ed-link", onclick }, label);
const outside = (label: string, href: string) => h("a", { href, target: "_blank", rel: "noopener" }, label);
const problemsBox = (problems: string[]) => h("ul", { class: "ed-problems", role: "alert" }, ...problems.map((p) => h("li", {}, p)));
const field = (label: string, input: HTMLElement, hint?: string) => h("label", {}, label, input, hint ? h("small", {}, hint) : null);
const say = (e: unknown) => (e instanceof Error ? e.message : String(e));
/** A button that asks once more before it acts: the second tap is the answer. */
function twice(label: string, sure: string, act: () => void) {
  let asked = false;
  const b = button(label, () => { if (asked) return act(); asked = true; b.textContent = sure; });
  return b;
}

function screen(title: string, ...body: Child[]) {
  const heading = h("h1", { class: "h-xl", tabindex: "-1" }, title);
  root.lang = lang;
  root.replaceChildren(notice, heading, ...body.filter((c): c is Node | string => !!c));
  heading.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}
const back = () => h("p", {}, button(t.back, home));

/** The site's files with the change laid on top: what the renderer and the forms read. */
const files = (): Files => ({ ...bundle.files, ...Object.fromEntries(draft.filter((c) => c.text !== undefined).map((c) => [c.path, c.text!])) });
/** Every change to the draft goes through here, so the device's copy follows. */
async function setDraft(next: Change[], photos: Record<string, Photo> = draftPhotos) {
  draft = next;
  draftPhotos = Object.fromEntries(Object.entries(photos).filter(([p]) => next.some((c) => `${c.path}` === p)));
  kept = await saveDraft(bundle.base, { changes: draft, photos: draftPhotos, saved_at: new Date().toISOString() });
}
const withChange = (c: Change) => [...draft.filter((d) => d.path !== c.path), c];

// ---- the update notice ----
function drawNotice() {
  notice.replaceChildren(update === "current" ? "" : h("div", { class: "ed-banner", role: "status" },
    h("p", {}, update === "required" ? t.update_required : t.update_newer),
    h("p", {}, button(t.update_now, () => location.reload(), true))));
}
async function checkVersion() {
  const latest: VersionInfo | null = await fetch(root.dataset.version!, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null), () => null);
  const next = updateState({ version: EDITOR_VERSION, build: bundle.build }, latest);
  if (next !== update) { update = next; drawNotice(); }
}

// ---- home ----
function home() {
  const waiting = h("div", { class: "ed-waiting" }, h("p", { class: "ed-note" }, t.waiting_loading));
  const stale = staleChanges(draft, bundle.files);
  const other: Lang = lang === "en" ? "de" : "en";
  screen(t.home_title,
    h("p", { class: "lead" }, t.home_lead),
    h("div", { class: "ed-actions" },
      button(t.post_photo, photoForm, true),
      button(t.hours_title, hoursForm)),
    draft.length ? h("div", { class: "card" },
      h("h2", { class: "eyebrow" }, t.draft_title),
      h("ul", { class: "ed-list" }, ...[...new Set(draft.map((c) => c.label))].map((l) => h("li", {}, localLabel(l, t)))),
      stale.length ? problemsBox([...new Set(stale.map((c) => (c.base === null ? t.stale_photo : t.stale)(localLabel(c.label, t))))]) : null,
      h("p", { class: "ed-note" }, kept ? t.draft_kept : t.draft_not_kept),
      h("p", { class: "ed-row" }, button(t.see_on_site, () => preview()), button(t.send, send, true), twice(t.throw_away, t.throw_away_sure, async () => { await setDraft([], {}); home(); }))) : null,
    !token ? h("div", { class: "card" }, h("h2", { class: "eyebrow" }, t.setup_card_title), h("p", {}, t.setup_card_text), h("p", {}, button(t.setup_card_button, () => signIn(home)))) : null,
    waiting,
    h("p", { class: "ed-note" }, who ? t.signed_in_as(who.login) : token ? t.sign_in_kept : "", token ? linkButton(t.sign_out, signOut) : null),
    h("p", { class: "ed-note" }, t.version_line(EDITOR_VERSION, bundle.build.slice(0, 7), bundle.built_at.slice(0, 16).replace("T", " ")), " ",
      linkButton(STRINGS[other].lang_name, () => { lang = other; t = STRINGS[lang]; try { localStorage.setItem(LANG_KEY, lang); } catch { /* not stored */ } drawNotice(); home(); })));
  drawWaiting(waiting);
}

/** The lists under the home screen: what waits for this person's yes or no, and their own changes. */
async function drawWaiting(into: HTMLElement) {
  const gh = github(bundle.repo, token);
  const item = (p: Pull, v?: Verdict) => h("li", {}, linkButton(localLabel(p.title, t), () => status(p.number)), t.by(p.user.login), v ? `: ${v.state === "approved" ? t.state_approved : v.state === "rejected" ? t.state_rejected : t.state_waiting}` : "");
  const list = (title: string, empty: string, rows: HTMLElement[]) => [h("h2", { class: "h-lg" }, title), rows.length ? h("ul", { class: "ed-list" }, ...rows) : h("p", { class: "ed-note" }, empty)];
  try {
    const pulls = await gh.editorPulls();
    if (!who) return into.replaceChildren(...list(t.waiting_title, t.waiting_empty, pulls.map((p) => item(p))));
    // Signed in: one more question per change, to say where each one stands.
    const verdicts = await Promise.all(pulls.map((p) => gh.reviews(p.number).then((r) => verdict(r, p.user.login, p.head.sha), (): Verdict => ({ state: "waiting" }))));
    const rows = pulls.map((p, i) => ({ p, v: verdicts[i]! }));
    const me = who.login;
    into.replaceChildren(
      ...list(t.inbox_title, t.inbox_empty, rows.filter(({ p, v }) => p.user.login !== me && !(v.state === "rejected" && v.by === me)).map(({ p, v }) => item(p, v))),
      ...list(t.mine_title, t.mine_empty, rows.filter(({ p }) => p.user.login === me).map(({ p, v }) => item(p, v))));
  } catch (e) {
    into.replaceChildren(h("p", { class: "ed-note" }, t.list_failed(say(e))));
  }
}

// ---- opening hours ----
function hoursForm() {
  // The form shows the draft, but writes onto the site's file as it is now: a draft kept
  // from before the site changed is carried over, never laid on top of old text.
  const original = bundle.files[HOURS]!;
  if (!hoursEditable(original)) return screen(t.hours_title, h("p", {}, t.hours_closed_form), back());
  const week: Week = weekFromYaml(files()[HOURS]!);
  const names: Record<string, string> = parseYaml(bundle.files["data/i18n.yml"]!)[lang].days;
  const out = h("div", {});
  const rows = DAYS.map((d) => {
    const open = h("input", { type: "time", value: week[d].open, "aria-label": t.opens(names[d]!) }) as HTMLInputElement;
    const close = h("input", { type: "time", value: week[d].close ?? "", "aria-label": t.closes(names[d]!) }) as HTMLInputElement;
    const closed = h("input", { type: "checkbox" }) as HTMLInputElement;
    closed.checked = week[d].closed;
    const sync = () => { open.disabled = close.disabled = closed.checked; };
    closed.addEventListener("change", sync);
    sync();
    return { d, open, close, closed, el: h("fieldset", { class: "ed-day" }, h("legend", {}, names[d]), open, h("span", {}, t.to), close, h("label", { class: "ed-check" }, closed, t.closed)) };
  });
  const read = (): Week => Object.fromEntries(rows.map((r) => [r.d, { closed: r.closed.checked, open: r.open.value, close: r.close.value || null }])) as Week;
  const keep = async (then: () => void) => {
    const next = read();
    const problems = validateWeek(next, t).map((p) => p.replace(/^(\w\w):/, (_, d) => names[d] + ":"));
    if (problems.length) return out.replaceChildren(problemsBox(problems));
    const text = weekToYaml(original, next);
    await setDraft(text === original ? draft.filter((c) => c.path !== HOURS) : withChange({ path: HOURS, label: "Opening hours", text, base: original }));
    then();
  };
  screen(t.hours_title,
    h("p", {}, t.hours_help),
    h("form", { class: "form ed-hours", onsubmit: (e: Event) => e.preventDefault() }, ...rows.map((r) => r.el)),
    out,
    h("p", { class: "ed-row" }, button(t.see_on_site, () => keep(() => preview("#visit")), true), button(t.keep_back, () => keep(home)), button(t.cancel, home)));
}

// ---- post a photo ----
function photoForm() {
  let photo: CleanPhoto | null = null;
  const albums: { slug: string; title: Record<string, string> }[] = parseYaml(files()["data/albums.yml"] ?? "")?.albums ?? [];
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(new Date());
  const thumb = h("div", { class: "ed-thumb" });
  const out = h("div", {});
  const input = (attrs: Record<string, any> = {}) => h("input", { type: "text", ...attrs }) as HTMLInputElement;
  const file = input({ type: "file", accept: "image/jpeg,image/png,image/webp" });
  const date = input({ type: "date", value: today, required: true });
  const [capEn, capDe, altEn, altDe] = [input({ maxlength: 140, lang: "en" }), input({ maxlength: 140, lang: "de" }), input({ maxlength: 250, lang: "en" }), input({ maxlength: 250, lang: "de" })];
  const album = h("select", {}, h("option", { value: "" }, t.no_album), ...albums.map((a) => h("option", { value: a.slug }, a.title[lang] ?? a.title.en ?? a.slug))) as HTMLSelectElement;
  const feed = input({ type: "checkbox" });
  feed.checked = true;
  let pick = 0;
  file.addEventListener("change", async () => {
    photo = null;
    const mine = ++pick; // a slower, earlier pick must not replace a later one
    const picked = file.files?.[0];
    if (!picked) return thumb.replaceChildren();
    thumb.replaceChildren(h("p", { class: "ed-note" }, t.photo_preparing));
    try {
      const cleaned = await cleanInBrowser(picked);
      if (mine !== pick) return;
      photo = cleaned;
      thumb.replaceChildren(h("img", { src: photo.url, alt: t.photo_alt, width: photo.width, height: photo.height }), h("p", { class: "ed-note" }, t.photo_facts(photo.width, photo.height, Math.round(photo.bytes.length / 1024))));
    } catch (e) {
      if (mine !== pick) return;
      thumb.replaceChildren(problemsBox([t.photo_unreadable(say(e))]));
    }
  });
  const keep = async (then: () => void) => {
    const m: NewMoment = { date: date.value, slug: slugify(capEn.value), caption: { en: capEn.value.trim(), de: capDe.value.trim() }, alt: { en: altEn.value.trim(), de: altDe.value.trim() }, ...(album.value ? { album: album.value } : {}), ...(feed.checked ? {} : { feed: false }) };
    const existing = Object.keys(files()).filter((p) => /^moments\/.+\.md$/.test(p)).map((p) => p.slice(8, -3));
    const problems = [...(photo ? [] : [t.pick_first]), ...validateMoment(m, existing, albums.map((a) => a.slug), t)];
    if (problems.length || !photo) return out.replaceChildren(problemsBox(problems));
    const added = momentChanges(m, photo.bytes);
    const variant = [{ w: photo.width, path: photo.url }];
    await setDraft([...draft.filter((d) => !added.some((a) => a.path === d.path)), ...added], { ...draftPhotos, [`moments/${momentId(m)}.jpg`]: { width: photo.width, height: photo.height, jpg: variant, webp: variant } });
    then();
  };
  screen(t.post_photo,
    h("p", {}, t.photo_warning),
    h("form", { class: "form", onsubmit: (e: Event) => e.preventDefault() },
      field(t.photo_field, file), thumb,
      field(t.photo_date, date),
      field(t.cap_en, capEn, t.cap_en_hint),
      field(t.cap_de, capDe, t.cap_de_hint),
      field(t.alt_en, altEn, t.alt_en_hint),
      field(t.alt_de, altDe),
      field(t.album, album),
      h("label", { class: "ed-check" }, feed, t.also_home)),
    out,
    h("p", { class: "ed-row" }, button(t.see_on_site, () => keep(() => preview("#moments")), true), button(t.keep_back, () => keep(home)), button(t.cancel, home)));
}

// ---- preview: the real renderer on the real files plus the change ----
async function preview(anchor = "") {
  const all = [["index.html", t.p_home_en], ["de/index.html", t.p_home_de], ["gallery/index.html", t.p_photos_en], ["de/gallery/index.html", t.p_photos_de]];
  const pages = lang === "de" ? [all[1]!, all[0]!, all[3]!, all[2]!] : all;
  // Sandboxed without "allow-same-origin": whatever script the previewed page carries runs
  // in a throwaway origin and cannot read this page's storage, where a sign-in may be kept.
  const frame = h("iframe", { class: "ed-frame", sandbox: "allow-scripts", title: t.preview_frame }) as HTMLIFrameElement;
  const out = h("div", {});
  const pick = h("select", { "aria-label": t.page }, ...pages.map(([v, l]) => h("option", { value: v }, l))) as HTMLSelectElement;
  const width = h("select", { "aria-label": t.width }, h("option", { value: "phone" }, t.phone), h("option", { value: "full" }, t.full_width)) as HTMLSelectElement;
  const draw = async () => {
    try {
      const rendered = await renderSite(files(), { base: bundle.base, photos: { ...bundle.photos, ...draftPhotos }, version: bundle.version, origin: location.origin, now: new Date() });
      const html = rendered.find((p) => p.out === pick.value)!.html;
      // The page is asked to jump to the changed part once it has loaded (inside the frame only, so the editor itself stays put).
      frame.srcdoc = anchor ? html.replace("</body>", `<script>addEventListener("load",function(){var e=document.querySelector(${JSON.stringify(anchor)});if(e)scrollTo(0,e.getBoundingClientRect().top+scrollY);});</script></body>`) : html;
      frame.dataset.width = width.value;
      out.replaceChildren();
    } catch (e) {
      out.replaceChildren(problemsBox([t.preview_failed(say(e))]));
    }
  };
  pick.addEventListener("change", draw);
  width.addEventListener("change", draw);
  screen(t.preview_title,
    h("p", {}, draft.length ? t.preview_with : t.preview_without),
    h("p", { class: "ed-row" }, pick, width),
    out, frame,
    h("p", { class: "ed-row" }, draft.length ? button(t.send, send, true) : null, button(t.back, home)));
  await draw();
}

// ---- set up this device: sign in with a key from GitHub ----
function signIn(then: () => void, problem = "") {
  const input = h("input", { type: "password", autocomplete: "off", spellcheck: "false", required: true }) as HTMLInputElement;
  const remember = h("input", { type: "checkbox" }) as HTMLInputElement;
  // Off unless asked for: a remembered sign-in can be read by any script on this address.
  const out = h("div", {}, problem ? problemsBox([problem]) : null);
  const go = async () => {
    const candidate = input.value.trim();
    if (!candidate) return;
    out.replaceChildren(h("p", { class: "ed-note" }, t.checking));
    try {
      const access = await github(bundle.repo, candidate).access();
      if (!access.canWrite) return out.replaceChildren(problemsBox([t.not_invited(access.login, bundle.repo)]));
      token = candidate;
      who = access;
      try { remember.checked ? localStorage.setItem(TOKEN_KEY, candidate) : localStorage.removeItem(TOKEN_KEY); } catch { /* not stored */ }
      then();
    } catch (e) {
      out.replaceChildren(problemsBox([say(e)]));
    }
  };
  // GitHub fills in its "new token" form from the address: the one scope a guest of a public repository needs, and a name.
  const newKey = `https://github.com/settings/tokens/new?scopes=public_repo&description=${encodeURIComponent("Website editor")}`;
  screen(t.signin_title,
    h("p", {}, t.signin_intro),
    h("ol", { class: "ed-steps" },
      h("li", {}, t.step_account),
      h("li", {}, t.step_invite_a, outside(t.step_invite_link, `https://github.com/${bundle.repo}/invitations`), t.step_invite_b),
      h("li", {}, t.step_token_a, outside(t.step_token_link, newKey), t.step_token_b),
      h("li", {}, t.step_copy)),
    h("details", {}, h("summary", {}, t.owner_summary), h("p", {}, t.owner_text_a, outside("github.com/settings/personal-access-tokens", "https://github.com/settings/personal-access-tokens"), t.owner_text_b)),
    h("form", { class: "form", onsubmit: (e: Event) => { e.preventDefault(); go(); } },
      field(t.token_label, input),
      h("label", { class: "ed-check" }, remember, t.remember),
      h("p", { class: "ed-row" }, h("button", { type: "submit", class: "btn btn--neon" }, t.sign_in), button(t.cancel, home))),
    out,
    h("p", { class: "ed-note" }, t.signin_note));
}
function signOut() {
  token = null;
  who = null;
  try { localStorage.removeItem(TOKEN_KEY); } catch { /* nothing stored */ }
  home();
}

// ---- send: one commit on a new branch, one pull request ----
async function send() {
  if (!draft.length) return home();
  if (!token) return signIn(send);
  const out = h("div", {}, h("p", { class: "ed-note" }, t.sending));
  screen(t.sending_title, out);
  try {
    await checkVersion();
    if (update === "required") throw new Error(t.update_required);
    const gh = github(bundle.repo, token);
    who ??= await gh.access();
    if (!who.canWrite) throw new Error(t.may_not(who.login, bundle.repo));
    // The editor never overwrites someone else's work: a file that is not on GitHub what it was when the change was written stops the send.
    for (const c of draft.filter((d) => d.text !== undefined)) {
      const now = await gh.fileText(`site/${c.path}`, bundle.branch);
      const was = c.base !== undefined ? c.base : bundle.files[c.path] ?? null;
      if (now !== was) throw new Error(was === null ? t.photo_taken : t.conflict(localLabel(c.label, t)));
    }
    for (const c of draft.filter((d) => d.bytes)) if ((await gh.fileText(`site/${c.path}`, bundle.branch)) !== null) throw new Error(t.photo_taken);
    const { title, body } = describe(draft, who.login);
    const slug = slugify(title.replace(/^Photo: /, "")) || "change";
    const branch = branchName(who.login, slug, new Date());
    await gh.commit(branch, bundle.branch, title, draft);
    // A branch with no pull request would sit in the public repository for ever: take it back if the second step fails.
    const pull = await gh.openPull(branch, bundle.branch, title, body).catch(async (e) => { await gh.removeBranch(branch); throw e; });
    await setDraft([], {});
    status(pull.number, true);
  } catch (e) {
    if (e instanceof GitHubError && e.status === 401) { token = null; who = null; return signIn(send, say(e)); }
    out.replaceChildren(problemsBox([say(e)]), h("p", { class: "ed-row" }, button(t.try_again, send, true), button(t.back, home)));
  }
}

// ---- one change: what it is, where it stands, yes or no, publish ----
async function status(number: number, fresh = false) {
  const out = h("div", { class: "ed-change" });
  const previewUrl = `${bundle.preview_root}pr-preview/pr-${number}/`;
  let timer = 0;
  let touched = false; // someone is typing a reason: do not redraw under their fingers
  const started = Date.now();
  const leave = () => { clearTimeout(timer); home(); };
  screen(t.change_title(number), fresh ? h("p", { class: "lead" }, t.sent) : null, out, h("p", {}, button(t.back, leave)));
  const gh = github(bundle.repo, token);
  const draw = async () => {
    if (!out.isConnected) return;
    try {
      const pull: Pull = await gh.pull(number);
      if (pull.merged) return out.replaceChildren(h("p", { class: "lead" }, t.published));
      if (pull.state !== "open") return out.replaceChildren(h("p", {}, t.closed_unpublished));
      const [paths, reviews] = await Promise.all([gh.changedFiles(number).catch(() => []), gh.reviews(number).catch(() => [])]);
      const v = verdict(reviews, pull.user.login, pull.head.sha);
      // The preview is published only after the tests, the build and the link check have passed,
      // and it says which commit it was built from. Ready means: built from the commit the branch is at now.
      const built: string | null = await fetch(previewUrl + "edit/site.json", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j) => j?.commit ?? null, () => null);
      const ready = built !== null && built === pull.head.sha;
      const slow = !ready && Date.now() - started > 5 * 60 * 1000;
      const mine = !!who && who.login === pull.user.login;
      const note = h("div", {});
      const act = (label: string, work: () => Promise<void>, neon = false) => {
        const b = button(label, async () => {
          b.setAttribute("disabled", "");
          try { await work(); } catch (e) { b.removeAttribute("disabled"); note.replaceChildren(problemsBox([t.cannot_publish(say(e))])); }
        }, neon);
        return b;
      };
      const publish = () => gh.publish(number, pull.head.ref, pull.head.sha).then(draw);
      const reason = h("input", { type: "text", maxlength: 200, oninput: () => { touched = true; } }) as HTMLInputElement;
      const actions: Child[] = !token ? [button(t.sign_in_to_decide, () => signIn(() => status(number)), true)]
        : mine ? [
          ready && v.state === "approved" ? act(t.publish_now, publish, true) : null,
          ready && v.state !== "approved" && who?.owner ? act(t.publish_alone, publish) : null,
          twice(t.take_back, t.take_back_sure, async () => { try { await gh.withdraw(number, pull.head.ref); clearTimeout(timer); out.replaceChildren(h("p", { class: "lead" }, t.taken_back)); } catch (e) { note.replaceChildren(problemsBox([say(e)])); } })]
        : [
          ready ? act(t.yes, async () => { if (v.state !== "approved") await gh.approve(number, pull.head.sha); await publish(); }, true) : null,
          v.state === "rejected" && v.by === who?.login ? null : act(t.no_confirm, async () => { await gh.reject(number, reason.value); clearTimeout(timer); out.replaceChildren(h("p", { class: "lead" }, t.said_no)); })];
      out.replaceChildren(...[
        h("p", {}, h("strong", {}, localLabel(pull.title, t)), t.by(pull.user.login)),
        paths.length ? h("div", {}, h("p", {}, t.what_changed), h("ul", { class: "ed-list" }, ...whatChanged(paths, t).map((w) => h("li", {}, w)))) : null,
        v.state === "rejected" ? h("p", {}, t.rejected_by(v.by, v.reason), " ", outside(t.open_on_github, pull.html_url)) : v.state === "approved" ? h("p", {}, t.approved_by(v.by)) : mine ? h("p", { class: "ed-note" }, t.needs_other) : null,
        ready ? h("p", {}, t.checks_passed, outside(t.look_at_built, previewUrl), ".") : h("p", { class: "ed-note" }, slow ? t.slow : t.still_building),
        token && !mine && !(v.state === "rejected" && v.by === who?.login) ? h("div", { class: "form" }, field(t.no_reason, reason)) : null,
        h("p", { class: "ed-row" }, ...actions), note].filter((c): c is HTMLElement => c !== null));
      if (!ready) timer = window.setTimeout(() => (touched ? undefined : draw()), 15000);
    } catch (e) {
      out.replaceChildren(problemsBox([say(e)]));
    }
  };
  draw();
}

// ---- start ----
(async () => {
  try {
    bundle = await (await fetch(root.dataset.bundle!, { cache: "no-store" })).json();
  } catch (e) {
    return root.replaceChildren(problemsBox([t.load_failed(say(e))]));
  }
  const saved = await loadDraft(bundle.base);
  if (saved) { draft = saved.changes; draftPhotos = saved.photos; }
  // Only a draft this browser could not keep is worth a "leave this page?" question.
  addEventListener("beforeunload", (e) => { if (draft.length && !kept) e.preventDefault(); });
  if ("serviceWorker" in navigator && root.dataset.sw) navigator.serviceWorker.register(root.dataset.sw).catch(() => undefined);
  if (token) who = await github(bundle.repo, token).access().catch((e) => { if (e instanceof GitHubError && e.status === 401) { token = null; try { localStorage.removeItem(TOKEN_KEY); } catch { /* nothing stored */ } } return null; });
  home();
  checkVersion();
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") checkVersion(); });
  setInterval(checkVersion, 15 * 60 * 1000);
})();
