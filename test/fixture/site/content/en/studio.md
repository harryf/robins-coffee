---
title: "Install ROBIN's Studio"
description: "How to put ROBIN's Studio, the editor of the bar's website, on a Mac."
noindex: true
---
ROBIN's Studio is the app the bar uses to change this website: opening hours, photos, the drinks menu and events. It runs on a Mac. Putting it on takes about ten minutes, most of it waiting.

## What you need

1. A Mac with macOS 12 or newer, and an internet connection.
2. To publish changes later: a GitHub account that Harry has invited. You can install and look around without one.

## Install

1. Open the app **Terminal**. Press Command and Space, type `Terminal`, press Enter. A window with text opens.
2. Copy the line below, paste it into that window and press Enter.

```
curl -fsSL https://raw.githubusercontent.com/harryf/robins-coffee/main/scripts/install-studio.sh | bash
```

3. If a window from Apple asks to install "command line developer tools", click **Install** and wait until it says it is done. The Terminal window carries on by itself.
4. Wait until the Terminal says **Done**. The Studio opens.

It asks for no password. The first start takes a minute, because the Studio builds the site once.

## Find it again

The app is called **ROBINs Studio** and sits in the Applications folder inside your home folder. Press Command and Space, type `Studio`, press Enter. Drag its icon to the Dock to keep it there.

## Make your GitHub key

The Studio publishes through GitHub, and GitHub wants a key (it calls it a "token") that says the Studio may do this for you. You make it once, in the browser. Sign in to GitHub first.

**If the website's repository is in your own GitHub account** (that is Harry):

1. Open [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new). By hand: your picture at the top right, **Settings**, **Developer settings** at the bottom left, **Personal access tokens**, **Fine-grained tokens**, **Generate new token**.
2. **Token name**: type `ROBINs Studio`.
3. **Expiration**: pick a date. On that day publishing stops until you make a new key, so pick a long time.
4. **Resource owner**: your own account.
5. **Repository access**: choose **Only select repositories** and pick `robins-coffee` from the list.
6. **Permissions**, then **Repository permissions**: set **Contents** to **Read and write**, and **Pull requests** to **Read and write**. "Metadata" switches itself to read-only; leave everything else as it is.
7. Click **Generate token**. GitHub shows the key once: a long line that starts with `github_pat_`. Copy it.

**If Harry invited you to the repository** (that is everyone else): GitHub does not let the key above work on a repository in someone else's account, so you make the older kind.

1. Accept Harry's invitation first: it is in your email, or at [github.com/harryf/robins-coffee/invitations](https://github.com/harryf/robins-coffee/invitations).
2. Open [github.com/settings/tokens/new](https://github.com/settings/tokens/new). By hand: your picture, **Settings**, **Developer settings**, **Personal access tokens**, **Tokens (classic)**, **Generate new token (classic)**.
3. **Note**: type `ROBINs Studio`. **Expiration**: pick a long time.
4. Under **Select scopes**, tick one box only: **public_repo**.
5. Click **Generate token** at the bottom. Copy the line that starts with `ghp_`.

Treat the key like a password: do not send it to anyone and do not save it in a note. If you lose it, delete it on the same GitHub page and make a new one.

## Publish for the first time

1. In the Studio, open **Settings**.
2. Paste your key into the field "GitHub key" and save. The key stays in this Mac's Keychain.
3. Change something, look at it under **Open preview**, then press **Publish**.

If the Studio says GitHub refused the key, a permission is missing. Open [your keys on GitHub](https://github.com/settings/personal-access-tokens), click the key, check the two permissions from step 6 and save. You do not need to paste it again.

## Good to know

- The Studio keeps itself up to date. Each time it starts it looks for a newer version.
- Nothing goes live until you press Publish. Until then your changes are only on this Mac.
- To install again, or to repair it, run the same line again. It keeps your unpublished changes.
- To remove it: drag ROBINs Studio from Applications to the Trash, and delete the folder `Library/Application Support/ROBINs Studio` in your home folder.

## What the line does

It downloads a short script from this website's own repository and runs it. The script installs Apple's tools if they are missing, installs bun (the program the Studio runs on), downloads a copy of the website into your Library folder, and builds the app on your Mac. You can [read the script](https://github.com/harryf/robins-coffee/blob/main/scripts/install-studio.sh) first.
