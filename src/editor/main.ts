// The editor at /edit/: post a photo, change the opening hours, see the real page, send
// the change for publishing. No framework: a handful of screens drawn with the DOM.
// Everything that can be decided without a screen lives in changes.ts and github.ts.
//
// The site's files arrive in one bundle the build wrote next to this script
// (edit/site.json), so looking and trying needs no login. GitHub is asked only when a
// change is sent.
import { renderSite, type Files, type Photo } from "../render";
import { DAYS, weekFromYaml, weekToYaml, validateWeek, validateMoment, momentChanges, momentId, slugify, branchName, describe, type Change, type Week, type NewMoment } from "./changes";
import { github, GitHubError, type Pull } from "./github";
import { cleanInBrowser, type CleanPhoto } from "./photo";
import { parse as parseYaml } from "yaml";

type Bundle = { built_at: string; base: string; preview_root: string; version: string; repo: string; branch: string; files: Files; photos: Record<string, Photo> };
type Child = Node | string | null | undefined | false;

const TOKEN_KEY = "robins-editor-token";
const root = document.getElementById("editor")!;
let bundle: Bundle;
let draft: Change[] = [];
const draftPhotos: Record<string, Photo> = {};
let token: string | null = null;
let who: { login: string; canWrite: boolean } | null = null;
try { token = localStorage.getItem(TOKEN_KEY); } catch { /* private window: sign in each time */ }

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
const problemsBox = (problems: string[]) => h("ul", { class: "ed-problems", role: "alert" }, ...problems.map((p) => h("li", {}, p)));
const field = (label: string, input: HTMLElement, hint?: string) => h("label", {}, label, input, hint ? h("small", {}, hint) : null);
const say = (e: unknown) => (e instanceof Error ? e.message : String(e));

function screen(title: string, ...body: Child[]) {
  root.replaceChildren(h("h1", { class: "h-xl", tabindex: "-1" }, title), ...body.filter((c): c is Node | string => !!c));
  (root.firstElementChild as HTMLElement).focus({ preventScroll: true });
  window.scrollTo(0, 0);
}
const back = () => h("p", {}, button("Back", home));

/** The site's files with the change laid on top: what the renderer and the forms read. */
const files = (): Files => ({ ...bundle.files, ...Object.fromEntries(draft.filter((c) => c.text !== undefined).map((c) => [c.path, c.text!])) });
const setChange = (c: Change) => { draft = [...draft.filter((d) => d.path !== c.path), c]; };

// ---- home ----
function home() {
  const waiting = h("div", { class: "ed-waiting" }, h("p", { class: "ed-note" }, "Looking for changes that wait to be published…"));
  screen("Editor",
    h("p", { class: "lead" }, "Change the site here. Nothing goes live until it is published."),
    h("div", { class: "ed-actions" },
      button("Post a photo", photoForm, true),
      button("Opening hours", hoursForm)),
    draft.length ? h("div", { class: "card" },
      h("h2", { class: "eyebrow" }, "Your change, not sent yet"),
      h("ul", { class: "ed-list" }, ...[...new Set(draft.map((c) => c.label))].map((l) => h("li", {}, l))),
      h("p", { class: "ed-row" }, button("See it on the site", () => preview()), button("Send for publishing", send, true), button("Throw away", () => { if (draft.length) { draft = []; home(); } }))) : null,
    h("h2", { class: "h-lg" }, "Waiting to be published"), waiting,
    h("p", { class: "ed-note" }, who ? `Signed in as ${who.login}. ` : "", who ? h("button", { type: "button", class: "ed-link", onclick: signOut }, "Sign out") : null,
      ` Site data from ${bundle.built_at.slice(0, 16).replace("T", " ")} UTC.`));
  github(bundle.repo, token).editorPulls().then(
    (pulls) => waiting.replaceChildren(pulls.length ? h("ul", { class: "ed-list" }, ...pulls.map((p) => h("li", {}, h("button", { type: "button", class: "ed-link", onclick: () => status(p.number) }, p.title), ` (by ${p.user.login})`))) : h("p", { class: "ed-note" }, "Nothing is waiting.")),
    (e) => waiting.replaceChildren(h("p", { class: "ed-note" }, `The list could not be loaded: ${say(e)}`)));
}

// ---- opening hours ----
function hoursForm() {
  const original = files()["data/hours.yml"]!;
  const week: Week = weekFromYaml(original);
  const names: Record<string, string> = parseYaml(bundle.files["data/i18n.yml"]!).en.days;
  const out = h("div", {});
  const rows = DAYS.map((d) => {
    const open = h("input", { type: "time", value: week[d].open, "aria-label": `${names[d]} opens` }) as HTMLInputElement;
    const close = h("input", { type: "time", value: week[d].close ?? "", "aria-label": `${names[d]} closes` }) as HTMLInputElement;
    const closed = h("input", { type: "checkbox" }) as HTMLInputElement;
    closed.checked = week[d].closed;
    const sync = () => { open.disabled = close.disabled = closed.checked; };
    closed.addEventListener("change", sync);
    sync();
    return { d, open, close, closed, el: h("fieldset", { class: "ed-day" }, h("legend", {}, names[d]), open, h("span", {}, "to"), close, h("label", { class: "ed-check" }, closed, "Closed")) };
  });
  const read = (): Week => Object.fromEntries(rows.map((r) => [r.d, { closed: r.closed.checked, open: r.open.value, close: r.close.value || null }])) as Week;
  const keep = (then: () => void) => {
    const next = read();
    const problems = validateWeek(next).map((p) => p.replace(/^(\w\w):/, (_, d) => names[d] + ":"));
    if (problems.length) return out.replaceChildren(problemsBox(problems));
    const text = weekToYaml(original, next);
    if (text === bundle.files["data/hours.yml"]) draft = draft.filter((c) => c.path !== "data/hours.yml");
    else setChange({ path: "data/hours.yml", label: "Opening hours", text });
    then();
  };
  screen("Opening hours",
    h("p", {}, "Zürich time. A closing time after midnight belongs to the day the evening started: Friday 16:00 to 02:00. Leave the closing time empty for \"until late\"."),
    h("form", { class: "form ed-hours", onsubmit: (e: Event) => e.preventDefault() }, ...rows.map((r) => r.el)),
    out,
    h("p", { class: "ed-row" }, button("See it on the site", () => keep(() => preview("#visit")), true), button("Keep and go back", () => keep(home)), button("Cancel", home)));
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
  const [capEn, capDe, altEn, altDe] = [input({ maxlength: 140 }), input({ maxlength: 140, lang: "de" }), input({ maxlength: 250 }), input({ maxlength: 250, lang: "de" })];
  const album = h("select", {}, h("option", { value: "" }, "No album"), ...albums.map((a) => h("option", { value: a.slug }, a.title.en ?? a.slug))) as HTMLSelectElement;
  const feed = input({ type: "checkbox" });
  feed.checked = true;
  file.addEventListener("change", async () => {
    photo = null;
    const picked = file.files?.[0];
    if (!picked) return thumb.replaceChildren();
    thumb.replaceChildren(h("p", { class: "ed-note" }, "Preparing the photo…"));
    try {
      photo = await cleanInBrowser(picked);
      thumb.replaceChildren(h("img", { src: photo.url, alt: "The photo you picked", width: photo.width, height: photo.height }), h("p", { class: "ed-note" }, `${photo.width} x ${photo.height} px, ${Math.round(photo.bytes.length / 1024)} KB. Location and phone details are removed.`));
    } catch (e) {
      thumb.replaceChildren(problemsBox([`This photo could not be read (${say(e)}). Try a JPEG.`]));
    }
  });
  const keep = (then: () => void) => {
    const m: NewMoment = { date: date.value, slug: slugify(capEn.value), caption: { en: capEn.value.trim(), de: capDe.value.trim() }, alt: { en: altEn.value.trim(), de: altDe.value.trim() }, ...(album.value ? { album: album.value } : {}), ...(feed.checked ? {} : { feed: false }) };
    const existing = Object.keys(files()).filter((p) => /^moments\/.+\.md$/.test(p)).map((p) => p.slice(8, -3));
    const problems = [...(photo ? [] : ["Pick a photo first."]), ...validateMoment(m, existing, albums.map((a) => a.slug))];
    if (problems.length || !photo) return out.replaceChildren(problemsBox(problems));
    for (const c of momentChanges(m, photo.bytes)) setChange(c);
    const variant = [{ w: photo.width, path: photo.url }];
    draftPhotos[`moments/${momentId(m)}.jpg`] = { width: photo.width, height: photo.height, jpg: variant, webp: variant };
    then();
  };
  screen("Post a photo",
    h("p", {}, "Only post a photo that may be public for good, and only of people who are fine with it."),
    h("form", { class: "form", onsubmit: (e: Event) => e.preventDefault() },
      field("Photo", file), thumb,
      field("Date of the photo", date),
      field("Caption, English", capEn, "One line, as you would say it at the bar."),
      field("Caption, German", capDe, "Swiss spelling: ss, not ß."),
      field("What the photo shows, English", altEn, "For people who cannot see it: who or what, doing what."),
      field("What the photo shows, German", altDe),
      field("Album", album),
      h("label", { class: "ed-check" }, feed, "Also show it on the home page")),
    out,
    h("p", { class: "ed-row" }, button("See it on the site", () => keep(() => preview("#moments")), true), button("Keep and go back", () => keep(home)), button("Cancel", home)));
}

// ---- preview: the real renderer on the real files plus the change ----
async function preview(anchor = "") {
  const pages = [["index.html", "Home, English"], ["de/index.html", "Home, German"], ["gallery/index.html", "Photos"], ["de/gallery/index.html", "Photos, German"]];
  const frame = h("iframe", { class: "ed-frame", title: "Preview of the site with your change" }) as HTMLIFrameElement;
  const out = h("div", {});
  const pick = h("select", { "aria-label": "Page" }, ...pages.map(([v, l]) => h("option", { value: v }, l))) as HTMLSelectElement;
  const width = h("select", { "aria-label": "Width" }, h("option", { value: "phone" }, "Phone"), h("option", { value: "full" }, "Full width")) as HTMLSelectElement;
  const draw = async () => {
    try {
      const rendered = await renderSite(files(), { base: bundle.base, photos: { ...bundle.photos, ...draftPhotos }, version: bundle.version, origin: location.origin, now: new Date() });
      const html = rendered.find((p) => p.out === pick.value)!.html;
      // The page's own script is asked to jump to the changed part once it has loaded.
      frame.srcdoc = anchor ? html.replace("</body>", `<script>addEventListener("load",function(){var e=document.querySelector(${JSON.stringify(anchor)});if(e)e.scrollIntoView();});</script></body>`) : html;
      frame.dataset.width = width.value;
      out.replaceChildren();
    } catch (e) {
      out.replaceChildren(problemsBox([`The site cannot be built with this change: ${say(e)}`]));
    }
  };
  pick.addEventListener("change", draw);
  width.addEventListener("change", draw);
  screen("Preview",
    h("p", {}, draft.length ? "This is the site as it will look. Photos you add are shown in full size here; everything else is exact." : "This is the site as it is now."),
    h("p", { class: "ed-row" }, pick, width),
    out, frame,
    h("p", { class: "ed-row" }, draft.length ? button("Send for publishing", send, true) : null, button("Back", home)));
  await draw();
}

// ---- sign in ----
function signIn(then: () => void, problem = "") {
  const input = h("input", { type: "password", autocomplete: "off", spellcheck: "false", required: true }) as HTMLInputElement;
  const remember = h("input", { type: "checkbox" }) as HTMLInputElement;
  remember.checked = true;
  const out = h("div", {}, problem ? problemsBox([problem]) : null);
  const go = async () => {
    const candidate = input.value.trim();
    if (!candidate) return;
    out.replaceChildren(h("p", { class: "ed-note" }, "Checking with GitHub…"));
    try {
      const access = await github(bundle.repo, candidate).access();
      if (!access.canWrite) return out.replaceChildren(problemsBox([`${access.login} may not change ${bundle.repo} yet. Ask Harry for an invitation, accept it, then try again.`]));
      token = candidate;
      who = access;
      try { remember.checked ? localStorage.setItem(TOKEN_KEY, candidate) : localStorage.removeItem(TOKEN_KEY); } catch { /* not stored */ }
      then();
    } catch (e) {
      out.replaceChildren(problemsBox([say(e)]));
    }
  };
  screen("Sign in with GitHub",
    h("p", {}, "The editor saves your change to GitHub in your name. For that it needs an access token from your GitHub account: a long password made for one purpose. You make it once."),
    h("ol", { class: "ed-steps" },
      h("li", {}, "Sign in at ", h("a", { href: "https://github.com/settings/tokens", target: "_blank", rel: "noopener" }, "github.com/settings/tokens"), "."),
      h("li", {}, "If the site's repository is your own: \"Fine-grained tokens\", only the repository ", h("code", {}, bundle.repo), ", permissions Contents and Pull requests, both \"Read and write\"."),
      h("li", {}, "If you were invited to it: \"Tokens (classic)\", only the scope ", h("code", {}, "public_repo"), "."),
      h("li", {}, "Copy the token and paste it here.")),
    h("form", { class: "form", onsubmit: (e: Event) => { e.preventDefault(); go(); } },
      field("Access token", input),
      h("label", { class: "ed-check" }, remember, "Remember it on this device"),
      h("p", { class: "ed-row" }, h("button", { type: "submit", class: "btn btn--neon" }, "Sign in"), button("Cancel", home))),
    out,
    h("p", { class: "ed-note" }, "The token stays in this browser and is sent only to api.github.com. Do not tick \"Remember\" on a device other people use."));
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
  const out = h("div", {}, h("p", { class: "ed-note" }, "Sending…"));
  screen("Sending your change", out);
  try {
    const gh = github(bundle.repo, token);
    who ??= await gh.access();
    if (!who.canWrite) throw new Error(`${who.login} may not change ${bundle.repo}.`);
    // The editor never overwrites someone else's work: a file that changed on GitHub since this editor loaded stops the send.
    for (const c of draft.filter((d) => d.text !== undefined && d.path in bundle.files)) {
      const now = await gh.fileText(`site/${c.path}`, bundle.branch);
      if (now !== null && now !== bundle.files[c.path]) throw new Error(`"${c.label}" was changed by someone else a moment ago. Reload the editor and make your change again.`);
    }
    for (const c of draft.filter((d) => d.bytes)) if ((await gh.fileText(`site/${c.path}`, bundle.branch)) !== null) throw new Error("A photo with this date and caption was published a moment ago. Change the caption a little.");
    const { title, body } = describe(draft, who.login);
    const slug = slugify(title.replace(/^Photo: /, "")) || "change";
    const branch = branchName(who.login, slug, new Date());
    await gh.commit(branch, bundle.branch, title, draft);
    const pull = await gh.openPull(branch, bundle.branch, title, body);
    draft = [];
    status(pull.number, true);
  } catch (e) {
    if (e instanceof GitHubError && e.status === 401) { token = null; who = null; return signIn(send, say(e)); }
    out.replaceChildren(problemsBox([say(e)]), h("p", { class: "ed-row" }, button("Try again", send, true), button("Back", home)));
  }
}

// ---- status of one change: checked, preview ready, publish ----
async function status(number: number, fresh = false) {
  const out = h("div", {});
  const previewUrl = `${bundle.preview_root}pr-preview/pr-${number}/`;
  let timer = 0;
  const leave = () => { clearTimeout(timer); home(); };
  screen(`Change ${number}`, fresh ? h("p", { class: "lead" }, "Sent. It is being built and checked now; that takes about a minute.") : null, out, h("p", {}, button("Back", leave)));
  const gh = github(bundle.repo, token);
  const draw = async () => {
    if (!out.isConnected) return;
    try {
      const pull: Pull = await gh.pull(number);
      if (pull.merged) return out.replaceChildren(h("p", { class: "lead" }, "Published. The live site shows it in about a minute."));
      if (pull.state !== "open") return out.replaceChildren(h("p", {}, "This change was closed without being published."));
      const ready = await fetch(previewUrl, { method: "HEAD", cache: "no-store" }).then((r) => r.ok, () => false);
      const publish = button("Publish now", async () => {
        if (!token) return signIn(() => status(number));
        publish.setAttribute("disabled", "");
        try { await github(bundle.repo, token).publish(number, pull.head.ref); draw(); }
        catch (e) { publish.removeAttribute("disabled"); note.replaceChildren(problemsBox([`It cannot be published yet. ${say(e)}`])); }
      }, true);
      const note = h("div", {});
      out.replaceChildren(...[
        h("p", {}, h("strong", {}, pull.title), ` (by ${pull.user.login})`),
        ready ? h("p", {}, "It passed the checks. ", h("a", { href: previewUrl, target: "_blank", rel: "noopener" }, "Look at the built site with this change"), ".") : h("p", { class: "ed-note" }, "Still being built and checked…"),
        ready ? h("p", { class: "ed-row" }, publish) : null, note].filter((c): c is HTMLElement => c !== null));
      if (!ready) timer = window.setTimeout(draw, 15000);
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
    return root.replaceChildren(problemsBox([`The editor could not load the site's data (${say(e)}). Check the connection and reload.`]));
  }
  addEventListener("beforeunload", (e) => { if (draft.length) e.preventDefault(); });
  if ("serviceWorker" in navigator && root.dataset.sw) navigator.serviceWorker.register(root.dataset.sw).catch(() => undefined);
  home();
})();
