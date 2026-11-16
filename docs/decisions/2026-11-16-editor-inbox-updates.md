# The editor gets an inbox, versions, drafts on the device and German

16 Nov 2026. Adds to `2026-11-16-editor-login.md` and to sections 10 and 11 of the spec.

## What Harry asked for

- The editor is installed from the website, carries a version and updates itself from the website.
- GitHub must be as painless as it can be for Elias, who is not a developer. His account exists only for this site.
- A change needs a yes from the other person. The editor shows an inbox of changes that wait, with a yes and a no. A no is handled by Harry on GitHub, outside the editor.

## Decisions

**Yes and no are GitHub reviews.** Yes is an approval of exactly the commit that was looked at, followed by the squash merge of that commit. No is a "changes requested" review with one optional line; the pull request stays open. The sender sees "not accepted" and the reason. Nothing new is stored anywhere: the inbox is the list of open `edit/...` pull requests plus their reviews.

**Nobody approves their own change.** GitHub enforces this, and the rule on `main` asks for one approval. So Elias's changes wait for Harry and Harry's wait for Elias. The owner of the repository can still publish alone ("Publish without a second look"); the editor shows that button only to the owner, and GitHub decides in the end. A sender can take an unpublished change back, which closes it and removes its branch.

**The version is a number plus a build.** `src/editor/version.json` holds `version` and `min_supported`. The build writes `edit/version.json` with both and the build's name (the commit). The running editor asks for that file on start, when it comes to the front and every 15 minutes. Another build: it offers "Update now". Its own version below `min_supported`: it refuses to send until it is updated. Raise `version` with every change to the editor; raise `min_supported` only when an old editor would send something wrong.

**The unsent change is kept on the device,** in IndexedDB, one record per site address (so a pull request preview and the live editor do not share a draft). Each changed file remembers the text it was written on. The send compares that with GitHub, so a draft kept for days cannot overwrite newer work; the home screen says when a draft has gone stale.

**The words are in `src/editor/strings.ts`,** English and German. The type check fails on a missing German line. Pull request titles and texts stay English.

**Setting up a device is one screen:** accept the invitation, open a prepared GitHub page that has the scope and name filled in, paste the key, tick "Remember". The screen suggests "No expiration" for an account that exists only for this site.

## What this changes in the risks

- The classic token of an invited person reaches every public repository that person can write to. For an account made only for this site that is this repository and nothing else, so the reach is what a fine-grained token would give. It grows if the account is ever used for other work.
- A key with no end date stays valid until it is revoked. If a phone is lost: github.com, Settings, Developer settings, delete the token. Harry can also remove the person from the repository, which ends what the key can do here at once.
- A stolen sign-in cannot publish alone, because it cannot approve its own change. It could say yes to someone else's waiting change.
- Still open: the branch `gh-pages` has no rule, and an approval is not yet tied to the latest push. Both are settings Harry decides.

## Not in this step

Editing a kept photo post, editing pages and events, a before and after view, cleaning HTML out of page text.
