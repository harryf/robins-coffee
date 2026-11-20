// The one GitHub call the Studio needs beyond src/editor/github.ts: where the required
// `build` check of a commit stands. Kept here so the phone editor's file stays as it is.
// The token travels only in the Authorization header, only to api.github.com.
import { github, GitHubError } from "../editor/github";
import type { CheckState, PublishGitHub } from "./publish";

export const CHECK_NAME = "build";

export function checkState(runs: { status: string; conclusion: string | null; started_at?: string | null }[]): CheckState {
  if (!runs.length) return "waiting";
  // A re-run adds a second run for the same commit: the newest one counts.
  const latest = [...runs].sort((a, b) => (b.started_at ?? "").localeCompare(a.started_at ?? ""))[0]!;
  if (latest.status !== "completed") return "waiting";
  return latest.conclusion === "success" ? "passed" : "failed";
}

export function studioGitHub(repo: string, token: string, doFetch: typeof fetch = fetch): PublishGitHub {
  const base = github(repo, token, doFetch);
  return {
    access: () => base.access(),
    editorPulls: () => base.editorPulls(),
    openPull: (branch, into, title, body) => base.openPull(branch, into, title, body),
    publish: (n, branch, sha) => base.publish(n, branch, sha),
    async check(sha) {
      const res = await doFetch(`https://api.github.com/repos/${repo}/commits/${encodeURIComponent(sha)}/check-runs?check_name=${CHECK_NAME}&per_page=20`, {
        headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new GitHubError(res.status, `GitHub said no (${res.status}) when asked for the build check.`);
      return checkState(((await res.json()) as any).check_runs ?? []);
    },
  };
}
