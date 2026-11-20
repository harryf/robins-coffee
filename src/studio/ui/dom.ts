// What the shell and every section share: the element builder and the section contract.
import type { StudioState } from "../server";
import type { Lang, Strings } from "../strings";

export type Kid = Node | string | null | false | undefined;

/** A small element builder: `class`, `on<event>` handlers, everything else as a property or attribute. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...kids: Kid[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") el.className = String(value);
    else if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2), value as EventListener);
    else if (key in el && !key.startsWith("aria-")) (el as any)[key] = value;
    else el.setAttribute(key, String(value));
  }
  for (const kid of kids) if (kid) el.append(kid);
  return el;
}

export type Api = (method: string, path: string, body?: unknown) => Promise<{ status: number; data: any }>;

/** What a section gets to work with. */
export type Ctx = {
  t: Strings;
  lang: Lang;
  api: Api;
  state: () => StudioState | null;
  /** Called with every new state while this section is open. */
  onState: (listener: (state: StudioState) => void) => void;
  setLang: (lang: Lang) => void;
};

/**
 * One entry of the sidebar. A new form (photos, albums, menu, events) is one more of
 * these in the list in sections.ts; the shell does not change.
 */
export type Section = { id: string; title: (t: Strings) => string; render: (ctx: Ctx) => HTMLElement };
