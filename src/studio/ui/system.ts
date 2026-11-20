// The Settings blocks about the Studio itself: its version and last update, and the
// folder the Mac app edits. They only draw and ask; the rules are in src/studio/config.ts
// and src/studio/update.ts.
import type { Strings } from "../strings";
import { h, type Ctx } from "./dom";

/** One line about the last look for a newer version, or null when there is nothing to say. */
export function updateLine(t: Strings, version: { update: { result: string; reason?: string; appRebuilt?: boolean } | null } | undefined): { text: string; tone: "ok" | "problem" | "muted" } | null {
  const update = version?.update;
  if (!update) return null;
  const why = (t as unknown as Record<string, string>)[`update_why_${update.reason ?? ""}`] ?? "";
  if (update.result === "updated") return { text: update.appRebuilt ? t.update_done_reopen : t.update_done, tone: "ok" };
  if (update.result === "current") return { text: t.update_current, tone: "muted" };
  if (update.result === "failed") return { text: t.update_failed(why), tone: "problem" };
  return update.reason === "offline" ? null : { text: t.update_waiting(why), tone: "problem" };
}

export function systemCards(ctx: Ctx): HTMLElement[] {
  const { t, api } = ctx;
  const version = h("p", {});
  const updated = h("p", {});
  const showVersion = () => {
    const v = ctx.state()?.version;
    version.textContent = v ? t.version_line(v.number, v.commit) : t.loading;
    const line = updateLine(t, v);
    updated.textContent = line?.text ?? "";
    updated.className = line?.tone ?? "muted";
    updated.hidden = !line;
  };
  showVersion();
  ctx.onState(showVersion);

  const current = h("code", { class: "install" });
  const input = h("input", { type: "text", spellcheck: false, autocomplete: "off", placeholder: "~/Code/personal/robins-coffee-studio" });
  const said = h("div", { role: "status" });
  const load = async () => {
    const res = await api("GET", "folder");
    if (res.status !== 200) return;
    current.textContent = res.data.current;
    if (res.data.saved && res.data.saved !== res.data.current) said.replaceChildren(h("p", { class: "ok" }, t.folder_next(res.data.saved)));
  };
  void load();
  const folder = h("form", { class: "card", onsubmit: async (event: Event) => {
    event.preventDefault();
    const res = await api("PUT", "folder", { path: input.value });
    if (res.status !== 200) return said.replaceChildren(h("p", { class: "problem" }, (t as unknown as Record<string, string>)[`e_${res.data.error}`] ?? t.failed(String(res.data.error ?? res.status))));
    input.value = "";
    said.replaceChildren(h("p", { class: "ok" }, t.folder_next(res.data.folder)));
  } }, h("h3", { class: "card__title" }, t.folder_title), h("p", { class: "muted" }, t.folder_help), h("p", { class: "muted" }, t.folder_now), current,
    h("div", { class: "card__row" }, input, h("button", { class: "button", type: "submit" }, t.folder_change)), said);

  return [h("div", { class: "card" }, h("h3", { class: "card__title" }, t.version_title), version, updated, h("p", { class: "muted" }, t.update_help)), folder];
}
