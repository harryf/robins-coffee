// The few GitHub REST calls the editor needs. `api.github.com` answers browser
// requests; GitHub's login endpoints do not, which is why the editor signs in with a
// personal access token and not with a login redirect (docs/decisions).
// The token travels only in the Authorization header, only to api.github.com.
import type { Change } from "./changes";

const API = "https://api.github.com";
export class GitHubError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export type Pull = { number: number; title: string; html_url: string; state: string; merged: boolean; mergeable_state?: string; head: { ref: string; sha: string }; user: { login: string } };

export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

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
    async access(): Promise<{ login: string; canWrite: boolean }> {
      const user = await json("GET", "/user");
      const info = await json("GET", r);
      return { login: user.login, canWrite: !!info.permissions?.push };
    },
    /** A file's text on a branch, or null when it is not there. */
    async fileText(repoPath: string, ref: string): Promise<string | null> {
      const res = await call("GET", `${r}/contents/${repoPath.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(ref)}`, undefined, "application/vnd.github.raw+json");
      return res.status === 404 ? null : res.text();
    },
    /** One commit with every file of the change, on a new branch cut from `base`. Returns the commit. */
    async commit(branch: string, base: string, message: string, changes: Change[]): Promise<string> {
      const head: string = (await json("GET", `${r}/git/ref/heads/${base}`)).object.sha;
      const baseTree: string = (await json("GET", `${r}/git/commits/${head}`)).tree.sha;
      const tree = [];
      for (const c of changes) {
        const blob = await json("POST", `${r}/git/blobs`, c.bytes ? { content: toBase64(c.bytes), encoding: "base64" } : { content: c.text ?? "", encoding: "utf-8" });
        tree.push({ path: `site/${c.path}`, mode: "100644", type: "blob", sha: blob.sha });
      }
      const newTree = await json("POST", `${r}/git/trees`, { base_tree: baseTree, tree });
      const commit = await json("POST", `${r}/git/commits`, { message, tree: newTree.sha, parents: [head] });
      await json("POST", `${r}/git/refs`, { ref: `refs/heads/${branch}`, sha: commit.sha });
      return commit.sha;
    },
    openPull: (branch: string, base: string, title: string, body: string): Promise<Pull> => json("POST", `${r}/pulls`, { head: branch, base, title, body }),
    pull: (n: number): Promise<Pull> => json("GET", `${r}/pulls/${n}`),
    /** Open pull requests that came from the editor. */
    async editorPulls(): Promise<Pull[]> {
      return ((await json("GET", `${r}/pulls?state=open&per_page=50`)) as Pull[]).filter((p) => p.head.ref.startsWith("edit/"));
    },
    /** Squash and merge. GitHub refuses while a required check or review is missing; the message says which. */
    async publish(n: number, branch: string): Promise<void> {
      await json("PUT", `${r}/pulls/${n}/merge`, { merge_method: "squash" });
      await call("DELETE", `${r}/git/refs/heads/${branch}`).catch(() => undefined); // the repository may already have removed it
    },
  };
}
