// The change history: what `git log` says about the content paths on origin/main, as
// rows for the screen. The parser is pure; src/studio/git.ts runs the command.

export type HistoryEntry = { sha: string; date: string; who: string; what: string; pull: number | null };

/** Fields are split by the unit separator and commits by the record separator, so a subject may hold anything else. */
export const HISTORY_FORMAT = "%H%x1f%aI%x1f%an%x1f%s%x1e";
export const HISTORY_LIMIT = 50;

/** Newest first, as git prints it. The " (#12)" GitHub adds to a squashed subject is taken off and kept as `pull`. */
export function parseHistory(log: string): HistoryEntry[] {
  const out: HistoryEntry[] = [];
  for (const record of log.split("\x1e")) {
    const [sha, date, who, subject] = record.replace(/^\s+/, "").split("\x1f");
    if (!sha || !date || subject === undefined) continue;
    const pull = / \(#(\d+)\)$/.exec(subject);
    out.push({ sha, date, who: who ?? "", what: pull ? subject.slice(0, pull.index) : subject, pull: pull ? Number(pull[1]) : null });
  }
  return out.slice(0, HISTORY_LIMIT);
}
