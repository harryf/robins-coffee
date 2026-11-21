// The change history: what `git log` says about origin/main, as rows for the screen.
// The parser is pure; src/studio/git.ts runs the command.
//
// A row is a change to the content and nothing else: a commit is shown only when every
// file it touched is inside the Studio's reach (`inEditScope`), the same rule that
// decides what Publish may send. So everything the Studio published
// is here, a caption mended by hand is here, and work on the code is not, even when it
// carried a text or a photo along.
import { inEditScope } from "../scope";

export type HistoryEntry = {
  sha: string;
  date: string;
  who: string;
  what: string;
  pull: number | null;
  /** The lines under the title: what exactly changed, as the publish wrote it down. */
  notes: string[];
  /** Where the pull request can be looked at; the server adds it, it knows the repository. */
  url?: string;
  /** True when the live content is exactly this version; the server works it out for the newest row. */
  live?: boolean;
};

/**
 * A record starts with the record separator; fields end with the unit separator; the
 * names of the changed files follow the last field (`--name-only -z`), so a subject or
 * a body may hold anything else.
 */
export const HISTORY_FORMAT = "%x1e%H%x1f%aI%x1f%an%x1f%s%x1f%b%x1f";
export const HISTORY_LIMIT = 50;
/** How far back the log is read to find those rows: most commits may be work on the code. */
export const HISTORY_SCAN = 600;
const NOTES_MAX = 12;

/** A commit body as short lines: list marks and trailers off, nothing empty, not endless. */
export function notesOf(body: string): string[] {
  const lines = body.split("\n").map((l) => l.replace(/^\s*[-*]\s+/, "").trim()).filter((l) => l && !/^(co-authored-by|signed-off-by):/i.test(l));
  return lines.slice(0, NOTES_MAX).map((l) => (l.length > 300 ? l.slice(0, 299) + "…" : l));
}

/** Newest first, as git prints it. The " (#12)" GitHub adds to a squashed subject is taken off and kept as `pull`. */
export function parseHistory(log: string): HistoryEntry[] {
  const out: HistoryEntry[] = [];
  for (const record of log.split("\x1e")) {
    const [sha, date, who, subject, body, names] = record.split("\x1f");
    if (!sha || !date || subject === undefined) continue;
    const files = (names ?? "").split(/[\0\n]/).map((f) => f.trim()).filter(Boolean);
    // A commit without files (a merge) changed nothing by itself.
    if (!files.length || !files.every(inEditScope)) continue;
    const pull = / \(#(\d+)\)$/.exec(subject);
    const what = pull ? subject.slice(0, pull.index) : subject;
    // GitHub's squash of several commits repeats the title as its first line.
    out.push({ sha: sha.trim(), date, who: who ?? "", what, pull: pull ? Number(pull[1]) : null, notes: notesOf(body ?? "").filter((line) => line !== what) });
  }
  return out.slice(0, HISTORY_LIMIT);
}
