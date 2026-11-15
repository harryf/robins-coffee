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

- **The token sits in the browser's storage** when "Remember it on this device" is ticked. Any script on the same address could read it. Until the DNS cut-over the address is shared with Harry's other GitHub Pages sites; after it the editor has `robins-coffee.ch` to itself. The site ships one script of its own and no third-party script.
- **A token can do what its owner can do.** `main` is protected: nothing reaches the live site without a pull request and the `build` check. The editor only ever creates a branch named `edit/...` and a pull request.
- **An editor change may touch only content, photos, events and data.** CI fails an `edit/...` pull request that touches anything else (`scripts/check-edit-scope.ts`).
- **Photos are redrawn in the browser** at 2400 px at most, which drops every bit of metadata. The test that checks committed photos for metadata runs on every pull request, so a photo that slipped through fails the check.
- **Who may publish.** The editor has a "Publish now" button that merges the pull request once the checks have passed. GitHub decides whether that is allowed. Since 16 Nov 2026 the rule on `main` asks for one approval, so nobody can publish their own change alone: a second person approves it first. The repository's admin (Harry) can still merge without an approval; that bypass is part of the rule. The editor has no approve button yet (milestone 8), so for now an approval is given on github.com.

## Also decided

- **No framework, no Vite, no Octokit.** The editor is about 300 lines of plain TypeScript with five fetch calls, bundled by `bun build` inside the normal site build. It adds no dependency.
- **The editor reads one file, `edit/site.json`,** which the build writes: every text file of the site and the list of photos. That is what lets it run the real renderer (`src/render.ts`) in the browser. Before sending, it compares each file it changed with the current one on GitHub and stops if someone else changed it.
- **Not in this first version:** drafts that survive a reload, editing pages and events, a German interface, the before and after view for approvers. They are milestone 8.
