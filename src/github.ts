// The few GitHub REST calls the Studio's Publish needs (src/studio/checks.ts adds the
// build check). The token travels only in the Authorization header, only to api.github.com.

const API = "https://api.github.com";
export class GitHubError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export type Pull = { number: number; title: string; html_url: string; state: string; merged: boolean; mergeable_state?: string; head: { ref: string; sha: string; repo: { full_name: string } | null }; user: { login: string } };

export function github(repo: string, token: string | null, doFetch: typeof fetch = fetch) {
  const call = async (method: string, path: string, body?: unknown, accept = "application/vnd.github+json"): Promise<Response> => {
    const res = await doFetch(API + path, {
      method,
      headers: { Accept: accept, "X-GitHub-Api-Version": "2022-11-28", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok && res.status !== 404) {
      const detail = await res.json().then((j: any) => j.message as string, () => "");
      throw new GitHubError(res.status, res.status === 401 ? "GitHub did not accept the token. It may have expired." : `GitHub said no (${res.status}): ${detail}`);
    }
    return res;
  };
  const json = async (method: string, path: string, body?: unknown) => {
    const res = await call(method, path, body);
    if (res.status === 404) throw new GitHubError(404, `GitHub cannot find ${path.split("?")[0]}, or the token may not see it.`);
    return res.json() as Promise<any>;
  };
  const r = `/repos/${repo}`;

  return {
    /** Who the token belongs to and whether that person may write to the repository. */
    async access(): Promise<{ login: string; canWrite: boolean; owner: boolean }> {
      const user = await json("GET", "/user");
      const info = await json("GET", r);
      return { login: user.login, canWrite: !!info.permissions?.push, owner: !!info.permissions?.admin };
    },
    openPull: (branch: string, base: string, title: string, body: string): Promise<Pull> => json("POST", `${r}/pulls`, { head: branch, base, title, body }),
    /** Open pull requests from an edit/ branch of this repository, never from a fork. */
    async editPulls(): Promise<Pull[]> {
      return ((await json("GET", `${r}/pulls?state=open&per_page=50`)) as Pull[]).filter((p) => p.head.ref.startsWith("edit/") && p.head.repo?.full_name === repo);
    },
    /**
     * Squash and merge exactly the commit that was published (`sha`); GitHub refuses if the
     * branch moved since, and while a required check or review is missing. Its message says which.
     */
    async publish(n: number, branch: string, sha: string): Promise<void> {
      await json("PUT", `${r}/pulls/${n}/merge`, { merge_method: "squash", sha });
      await this.removeBranch(branch);
    },
    /** Best effort: the repository may already have removed it. */
    async removeBranch(branch: string): Promise<void> {
      await call("DELETE", `${r}/git/refs/heads/${branch}`).catch(() => undefined);
    },
  };
}
