# The editor signs in with an access token, and runs without a server

16 Nov 2026. Changes section 10 of the spec.

## Decision

The editor at `/edit/` has no server of its own: no Cloudflare Worker, no GitHub App. A person signs in by pasting a personal access token from their own GitHub account, once per device. Looking at the site and trying a change needs no login at all; the token is asked for only when a change is sent.

## Why

Harry asked for the editor without a Cloudflare account. GitHub's login redirect and its device login both end at endpoints on `github.com` that refuse calls from a web page (checked 16 Nov 2026: the preflight request to `/login/device/code` and `/login/oauth/access_token` gets a 404 with no CORS header). `api.github.com` does answer a web page. So a page with no server can use a token but cannot obtain one through a login screen.

## What each person needs

| Who | Token | Reach of the token |
|---|---|---|
| The owner of the repository | Fine-grained, this repository only, Contents and Pull requests read and write | This repository |
| An invited collaborator (Elias) | Classic, scope `public_repo` | Every public repository that person can write to |

GitHub's fine-grained tokens do not yet work for a collaborator on another person's repository (GitHub lists this as a known gap). That is why an invited person needs the classic kind. If the repository moves to an organisation, members can use fine-grained tokens too.

## Risks, and what holds them

A second, independent review of the editor ran before it was merged. It found no way for the token to leave for another host and no way for typed text to become code. The points below include what it did find.

- **A token can do what its owner can do.** `main` is protected: a pull request, the `build` check and one approval (since 16 Nov 2026). The repository's admin (Harry) can merge without the approval; that bypass is part of the rule. The editor itself only creates an `edit/...` branch and a pull request, and merges and removes that branch when "Publish now" is pressed.
- **OPEN: the published branch is not protected.** The live site is served from the branch `gh-pages`, which only the workflows should write. No rule enforces that yet, so anyone with write access, or a stolen token, could change the live site directly, with no pull request. This needs a rule on `gh-pages` before a second person gets write access.
- **Where the token is kept.** By default only in the page's memory: closing or reloading the editor forgets it. With "Remember it on this device" it goes into the browser's storage, where any script served from the same address could read it. Scripts on that address are: the site's own script, every pull request preview (which is built from a branch before anyone has reviewed it), and until the DNS cut-over Harry's other GitHub Pages sites. A text file of the site may contain HTML, script included, so a hostile change to a page's text could carry one. "Sign out" is offered whenever a sign-in is remembered.
- **The editor's own preview is sandboxed.** It shows the page in a frame with no access to the editor's storage, so a script in the previewed page cannot read a remembered sign-in.
- **An editor change may touch only content, photos, events and data.** CI fails an `edit/...` pull request that touches anything else. It runs before anything from the pull request is installed, with the rule as the base branch has it. This catches an editor that went wrong, not a person who means harm: a person can give their branch another name. The approval covers that.
- **Photos are redrawn in the browser** at 2400 px at most, which drops every bit of metadata. The test that checks committed photos for metadata runs on every pull request.
- **"Publish now" merges exactly what was looked at.** The button appears only when the pull request preview says it was built from the commit the branch is at now, and the merge names that commit; GitHub refuses if the branch moved. Since milestone 8a the editor has a yes and a no (`2026-11-16-editor-inbox-updates.md`).
- **The hours form refuses a file it cannot keep whole** (two time spans on one day, an extra note, a hand-written comment inside the list) and changes nothing.

## Also decided

- **No framework, no Vite, no Octokit.** The editor is about 550 lines of plain TypeScript with a dozen kinds of GitHub call, bundled by `bun build` inside the normal site build. It adds no dependency.
- **The editor reads one file, `edit/site.json`,** which the build writes: every text file of the site and the list of photos. That is what lets it run the real renderer (`src/render.ts`) in the browser. Before sending, it compares each file it changed with the current one on GitHub and stops if someone else changed it.
- **Not in this first version:** drafts that survive a reload, changing a photo post after it is kept, two open changes to the same file, editing pages and events, cleaning HTML out of page text, a German interface, the approve button and the before and after view. They are milestone 8.
