// What a set of changed files means in plain words: "Opening hours updated, 2 events
// added". Pure: no disk, no git. The same function writes the line on the screen (in
// the screen's language) and the commit subject and pull request title (English).
import { slugify } from "../editor/changes";
import { STRINGS, type Strings } from "./strings";

export type Status = "added" | "modified" | "removed";
/**
 * One changed file by repository path. `items` is an optional hint for a list file
 * (albums.yml): how many entries came and went, which a path alone cannot say.
 */
export type FileChange = { path: string; status: Status; items?: { added: number; removed: number } };

/** The commit and pull request text under the title: who published, then one line per thing that changed (`details`, from detail.ts), or the bare paths when nobody could say more. */
export function publishNotes(changes: FileChange[], details: string[] = []): string {
  const lines = details.length ? details : changes.map((c) => `\`${c.path}\` (${c.status})`);
  return lines.map((l) => `- ${l}`).join("\n");
}

const count = (changes: FileChange[], status: Status) => changes.filter((c) => c.status === status).length;

/** One line for everything that changed, fixed order: hours, events, photos, albums, menu, venue, pages, labels, the rest. */
export function describeChanges(changes: FileChange[], t: Strings = STRINGS): string {
  const parts: string[] = [];
  const rest = new Set(changes);
  const take = (test: (path: string) => boolean) => {
    const found = changes.filter((c) => rest.has(c) && test(c.path));
    for (const c of found) rest.delete(c);
    return found;
  };
  const counted = (found: FileChange[], added: (n: number) => string, updated: (n: number) => string, removed: (n: number) => string) => {
    for (const [status, phrase] of [["added", added], ["modified", updated], ["removed", removed]] as const) {
      const n = count(found, status);
      if (n) parts.push(phrase(n));
    }
  };

  if (take((p) => p === "site/data/hours.yml").length) parts.push(t.d_hours);

  counted(take((p) => /^site\/events\/.+\.md$/.test(p) && !/\/README\.md$/i.test(p)), t.d_events_added, t.d_events_updated, t.d_events_removed);
  if (take((p) => p === "site/data/event-overrides.yml").length) parts.push(t.d_event_overrides);

  // A photo is two files (picture and text) with one name. It counts once: as added or
  // removed when either file is, as updated otherwise.
  const moments = new Map<string, Status>();
  for (const c of take((p) => /^site\/moments\/.+\.(jpg|md)$/.test(p))) {
    const id = c.path.replace(/\.(jpg|md)$/, "");
    const before = moments.get(id);
    moments.set(id, before && before !== "modified" ? before : c.status);
  }
  counted([...moments].map(([path, status]) => ({ path, status })), t.d_photos_added, t.d_photos_updated, t.d_photos_removed);

  for (const albums of take((p) => p === "site/data/albums.yml")) {
    const { added = 0, removed = 0 } = albums.items ?? {};
    if (added && !removed) parts.push(t.d_albums_added(added));
    else if (removed && !added) parts.push(t.d_albums_removed(removed));
    else parts.push(t.d_albums);
  }

  if (take((p) => p === "site/data/menu.yml").length) parts.push(t.d_menu);
  if (take((p) => p === "site/data/site.yml").length) parts.push(t.d_venue);
  if (take((p) => p.startsWith("site/content/")).length) parts.push(t.d_pages);
  if (take((p) => p === "site/data/i18n.yml").length) parts.push(t.d_labels);
  if (take((p) => p === "site/data/home.yml").length) parts.push(t.d_home);
  // Pictures for events and the menu, and where photos are cut, ride along with what
  // they belong to; alone they are named.
  const pictures = take((p) => /^site\/photos\/.+\.jpg$/.test(p) || p === "site/data/focus.yml");
  if (pictures.length && !parts.length) parts.push(t.d_pictures);
  if (rest.size) parts.push(t.d_other(rest.size));
  return t.d_join(parts);
}

/** edit/<date>-<slug>, from the English description. `suffix` keeps a second change of the same kind on one day apart. */
export function branchName(now: Date, description: string, suffix = ""): string {
  return `edit/${now.toISOString().slice(0, 10)}-${slugify(description) || "change"}${suffix ? `-${suffix}` : ""}`;
}
