// The editing screen's shell: sections on the left, the open section in the middle,
// unpublished changes and Publish on the right. It only draws; every rule lives in the
// server and the pure files next to it. Sections come from the registry in sections.ts.
import { describeChanges } from "../describe";
import type { PublishResult } from "../publish";
import type { StudioState } from "../server";
import { STRINGS, type Lang, type Strings } from "../strings";
import { h, type Api, type Ctx, type Kid } from "./dom";
import { SECTIONS } from "./sections";

const token = document.querySelector<HTMLMetaElement>('meta[name="studio-token"]')?.content ?? "";
const api: Api = async (method, path, body) => {
  const res = await fetch(`/_studio/api/${path}`, { method, headers: { "X-Studio-Token": token, ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: res.status, data: await res.json().catch(() => ({})) };
};

const stored = (() => {
  try {
    return localStorage.getItem("studio-lang");
  } catch {
    return null;
  }
})();
let lang: Lang = stored === "en" || stored === "de" ? stored : navigator.language.toLowerCase().startsWith("de") ? "de" : "en";
let t: Strings = STRINGS[lang];
let state: StudioState | null = null;
let current = SECTIONS.find((s) => s.id === location.hash.slice(1)) ?? SECTIONS[0]!;
let listeners: ((state: StudioState) => void)[] = [];
let confirming: string | null = null;
let notice: string | null = null;

const app = document.getElementById("app")!;
const nav = h("nav", { class: "side__nav" });
const sideHead = h("p", { class: "side__brand" });
const title = h("h1", { class: "bar__title" });
const buildPill = h("p", { class: "pill", role: "status" });
const previewButton = h("button", { class: "button", type: "button", onclick: () => void api("POST", "open", { path: "/" }) });
const buildProblem = h("section", { class: "problem", hidden: true });
const body = h("div", { class: "section" });
const changes = h("aside", { class: "changes" });
app.append(
  h("div", { class: "shell" },
    h("aside", { class: "side" }, sideHead, nav),
    h("main", { class: "main" }, h("header", { class: "bar" }, title, buildPill, previewButton), buildProblem, body),
    changes,
  ),
);

const ctx = (): Ctx => ({
  t, lang, api,
  state: () => state,
  onState: (listener) => listeners.push(listener),
  setLang(next) {
    lang = next;
    t = STRINGS[lang];
    try {
      localStorage.setItem("studio-lang", lang);
    } catch {}
    openSection();
    draw();
  },
});

function openSection() {
  listeners = [];
  body.replaceChildren(current.render(ctx()));
}

function failText(result: Extract<PublishResult, { ok: false }>): string {
  const detail = result.detail ?? "";
  switch (result.reason) {
    case "nothing": return t.fail_nothing;
    case "out_of_scope": return t.fail_out_of_scope(detail);
    case "wrong_branch": return t.fail_wrong_branch(detail);
    case "no_key": return t.fail_no_key;
    case "no_write": return t.fail_no_write(detail);
    case "git": return t.fail_git(detail);
    case "github": return t.fail_github(detail);
    case "check_failed": return t.fail_check_failed;
    case "check_timeout": return t.fail_check_timeout;
    case "busy": return t.fail_busy;
    case "build": return t.fail_build;
  }
}

function drawChanges() {
  const list = state?.changes ?? [];
  const mine = list.filter((c) => c.publishable);
  const outside = list.filter((c) => !c.publishable);
  const running = !!state?.publish.running;
  const kids: Kid[] = [h("h2", { class: "changes__title" }, t.changes_title)];

  if (!mine.length) kids.push(h("p", { class: "muted" }, t.changes_none));
  else {
    kids.push(h("p", { class: "muted" }, t.changes_summary), h("p", { class: "changes__summary" }, describeChanges(mine, t)));
    kids.push(h("ul", { class: "changes__list" }, ...mine.map((c) => {
      const name = c.path.replace(/^site\//, "");
      const row = h("li", { class: "change" },
        h("div", { class: "change__text" }, h("span", { class: "change__what" }, describeChanges([c], t)), h("span", { class: "change__path" }, `${name} (${t[`status_${c.status}`]})`)),
      );
      if (confirming === c.path) {
        row.append(h("div", { class: "change__confirm" },
          h("p", {}, t.discard_sure(name)),
          h("button", { class: "button button--danger", type: "button", onclick: async () => {
            confirming = null;
            const res = await api("POST", "discard", { path: c.path });
            notice = res.status === 200 ? null : t.failed(String(res.data.error ?? res.status));
            await refresh();
          } }, t.discard_yes),
          h("button", { class: "button button--quiet", type: "button", onclick: () => { confirming = null; drawChanges(); } }, t.cancel),
        ));
      } else row.append(h("button", { class: "button button--quiet", type: "button", disabled: running, onclick: () => { confirming = c.path; drawChanges(); } }, t.discard));
      return row;
    })));
  }

  if (outside.length) kids.push(h("div", { class: "problem" }, h("h3", {}, t.outside_title), h("p", {}, t.outside_help), h("ul", {}, ...outside.map((c) => h("li", { class: "change__path" }, c.path)))));

  kids.push(h("button", { class: "button button--primary changes__publish", type: "button", disabled: running || !mine.length || outside.length > 0, onclick: async () => {
    notice = null;
    const res = await api("POST", "publish");
    if (res.status !== 202 && res.data.reason !== "build") notice = t.fail_busy;
    await refresh();
  } }, running ? t.publishing : t.publish));

  const pub = state?.publish;
  if (pub && (pub.running || pub.result)) {
    kids.push(h("ol", { class: "steps" }, ...pub.steps.map((step, i) => h("li", { class: i === pub.steps.length - 1 && pub.running ? "steps__now" : "steps__done" }, t[`step_${step}`]))));
    const result = pub.result;
    if (result?.ok) {
      kids.push(h("p", { class: "ok", role: "status" }, result.state === "live" ? t.done_live : t.done_waiting));
      if (result.syncProblem) kids.push(h("p", { class: "problem" }, t.done_sync_note(result.syncProblem)));
    } else if (result) kids.push(h("p", { class: "problem", role: "alert" }, failText(result)));
    if (result?.pull) kids.push(h("p", {}, h("a", { href: result.pull.url, target: "_blank", rel: "noopener" }, `${t.see_pull} (#${result.pull.number})`)));
  }
  if (notice) kids.push(h("p", { class: "problem", role: "alert" }, notice));
  changes.replaceChildren(...kids.filter((kid): kid is Node | string => !!kid));
}

function draw() {
  document.documentElement.lang = lang;
  document.title = t.app_name;
  sideHead.textContent = t.app_name;
  nav.setAttribute("aria-label", t.nav_label);
  nav.replaceChildren(...SECTIONS.map((s) => h("button", { class: "side__link", type: "button", "aria-current": s === current ? "page" : undefined, onclick: () => {
    current = s;
    history.replaceState(null, "", `#${s.id}`);
    openSection();
    draw();
  } }, s.title(t))));
  title.textContent = current.title(t);
  previewButton.textContent = t.open_preview;
  previewButton.title = t.preview_hint;
  const build = state?.build;
  buildPill.textContent = !build ? t.loading : build.status === "ok" ? t.build_ok : build.status === "failed" ? t.build_failed : t.build_building;
  buildPill.dataset.status = build?.status ?? "building";
  buildProblem.hidden = build?.status !== "failed";
  if (build?.status === "failed") buildProblem.replaceChildren(h("h2", {}, t.build_failed), h("p", {}, t.build_failed_help), h("pre", {}, build.log));
  drawChanges();
}

let asking = false;
let askAgain = false;
async function refresh() {
  if (asking) {
    askAgain = true;
    return;
  }
  asking = true;
  do {
    askAgain = false;
    const res = await api("GET", "state").catch(() => null);
    if (res?.status === 200) {
      state = res.data as StudioState;
      draw();
      for (const listener of listeners) listener(state);
    }
  } while (askAgain);
  asking = false;
}

openSection();
draw();
void refresh();
const events = new EventSource("/_studio/events");
events.addEventListener("state", () => void refresh());
events.addEventListener("reload", () => void refresh());
