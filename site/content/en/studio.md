---
title: "Install ROBIN's Studio"
description: "How to put ROBIN's Studio, the editor of the bar's website, on a Mac."
noindex: true
---
ROBIN's Studio is the app the bar uses to change this website: opening hours, photos, the drinks menu and events. It runs on a Mac. Putting it on takes about ten minutes, most of it waiting.

## What you need

- **A Mac** with macOS 12 or newer. To check, click the Apple sign at the top left of the screen, then **About This Mac**.
- **macOS 26 (Tahoe) or newer for the translations.** You write every text in English; the Mac turns it into German, French and Italian. On an older Mac the Studio still works, and the website shows English where a translation is missing.
- **An internet connection**, for the install and each time you publish.
- **An email address** you can open now. GitHub sends a code to it.
- **A free GitHub account that Harry has invited, and a key from it.** GitHub is the service that keeps the website's files. The three steps under "Prerequisites" set this up. Without them you can install the Studio and look around, but you cannot publish.
- **Time**: about ten minutes for the install, and a few minutes for each of the three steps before it. One of them waits for Harry.

You need no password for the Mac, and nothing costs money.

The Studio can also list the bar's events from Eventfrog. For that it needs the bar's Eventfrog key, which you paste in the Studio's settings later. Everything else works without it.

## Prerequisites

Do these three steps in order, before you install. You do them once, in the browser.

### Step 1: Make a GitHub account

If you already have a GitHub account, sign in and go to step 2.

1. Open [github.com/signup](https://github.com/signup).
2. Type your email address, a password and a user name. The user name is how Harry finds you, so pick one you can remember.
3. GitHub sends a code to your email. Type it in.
4. Write down your user name.

### Step 2: Ask Harry to invite you

1. Send Harry your GitHub user name.
2. Wait for Harry to invite you. (Harry: the how is under "For Harry" at the end of this page.)
3. GitHub sends you an email with the invitation. Click **View invitation** in it, then **Accept invitation**. If you cannot find the email, open [github.com/harryf/robins-coffee/invitations](https://github.com/harryf/robins-coffee/invitations).

An invitation stops working after 7 days. If yours is older, ask Harry for a new one.

### Step 3: Make your key

The Studio publishes through GitHub, and GitHub wants a key (it calls it a "token") that says the Studio may do this for you.

1. Sign in to GitHub.
2. Open [github.com/settings/tokens/new](https://github.com/settings/tokens/new). GitHub may ask for your password again. By hand: your picture at the top right, **Settings**, **Developer settings** at the bottom left, **Personal access tokens**, **Tokens (classic)**, **Generate new token (classic)**.
3. **Note**: type `ROBINs Studio`.
4. **Expiration**: pick a date. On that day publishing stops until you make a new key, so pick a long time.
5. Under **Select scopes** there is a long list of boxes. Tick one box only: **public_repo**. Leave all the others empty.
6. Click **Generate token** at the bottom of the page.
7. GitHub shows the key once: a long line that starts with `ghp_`. Leave this page open. You paste the key into the Studio after the install.

Treat the key like a password: do not send it to anyone and do not save it in a note. If you lose it, delete it on the same GitHub page and make a new one.

## Install the app

1. Open the app **Terminal**. Press Command and Space, type `Terminal`, press Enter. A window with text opens.
2. Copy the line below, paste it into that window and press Enter.

```
curl -fsSL https://raw.githubusercontent.com/harryf/robins-coffee/main/scripts/install-studio.sh | bash
```

3. If a window from Apple asks to install "command line developer tools", click **Install** and wait until it says it is done. The Terminal window carries on by itself.
4. Wait until the Terminal says **Done**. The Studio opens.

It asks for no password. The first start takes a minute, because the Studio builds the site once.

### Find it again

The app is called **ROBINs Studio** and sits in the Applications folder inside your home folder. Press Command and Space, type `Studio`, press Enter. Drag its icon to the Dock to keep it there.

### Add the languages for the translations

The Studio translates on this Mac with Apple's own translation, so nothing you write is sent anywhere. The Mac needs three languages downloaded for it, once:

1. Open **System Settings**, then **General**, then **Language & Region**.
2. Near the bottom, click **Translation Languages**.
3. Click the download button next to **German**, **French** and **Italian**. Wait until each one is done.

The Studio also tells you when a language is missing, with a button that opens this page. Until a language is there, the website shows the English text in it.

## Publish for the first time

1. In the Studio, open **Settings**.
2. Go back to the GitHub page from step 3 and copy the key. Paste it into the field "GitHub key" and save. The key stays in this Mac's Keychain.
3. Change something small.
4. Press **Open preview** and look at it.
5. Press **Publish**. This usually takes 1 to 2 minutes.

If the Studio says GitHub refused the key, check two things. First, that you accepted Harry's invitation (step 2). Second, that **public_repo** is ticked: open [your keys on GitHub](https://github.com/settings/tokens), click `ROBINs Studio`, tick the box and click **Update token**. You do not need to paste the key again. The Studio's message names two permissions, Contents and Pull requests; on your kind of key, public_repo gives both.

## Good to know

- The Studio keeps itself up to date. Each time it starts it looks for a newer version.
- Write in English. The translations are in a closed fold under each text; open it to read them or to change a word. Leave one empty and the Mac makes it again when you save.
- Nothing goes live until you press Publish. Until then your changes are only on this Mac.
- To install again, or to repair it, run the same line again. It keeps your unpublished changes.
- To remove it: drag ROBINs Studio from Applications to the Trash, and delete the folder `Library/Application Support/ROBINs Studio` in your home folder.

## How it works

### From a change to the live website

<ol class="flow">
<li><strong>Change</strong> You change something in ROBINs Studio, on your Mac.</li>
<li><strong>Preview</strong> You look at the result. It is still only on your Mac.</li>
<li><strong>Happy?</strong> If not, change it again. Nobody else sees it yet.</li>
<li><strong>Publish</strong> The Studio sends your change to GitHub.</li>
<li><strong>Live</strong> Visitors see it on the website a few minutes later.</li>
</ol>

Publish usually takes 1 to 2 minutes, because GitHub checks the change first. The Studio tells you when it is done.

### Where everything lives

<ol class="flow">
<li><strong>Your Mac</strong> ROBINs Studio, a copy of the website and your changes.</li>
<li><strong>GitHub</strong> Keeps the website's files and every earlier version, and builds the website from them.</li>
<li><strong>GitHub Pages</strong> Puts the finished website on the internet.</li>
<li><strong>A visitor</strong> Opens the website in a browser, on a phone or a computer.</li>
</ol>

The website has no other server and no database. Because GitHub keeps every earlier version, a change can be taken back: the Studio lists them under its history.

### What the install line does

It downloads a short script from this website's own repository and runs it. The script installs Apple's tools if they are missing, installs bun (the program the Studio runs on), downloads a copy of the website into your Library folder, and builds the app on your Mac. You can [read the script](https://github.com/harryf/robins-coffee/blob/main/scripts/install-studio.sh) first.

## For Harry

### Invite someone

1. Open [github.com/harryf/robins-coffee/settings/access](https://github.com/harryf/robins-coffee/settings/access).
2. Click **Add people**, type the person's GitHub user name and pick them from the list.
3. Click **Add to repository**. GitHub sends them the invitation.

### Your own key

The repository is in your own account, so you can make the newer kind of key, which works on this one repository only.

1. Open [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new). By hand: your picture at the top right, **Settings**, **Developer settings** at the bottom left, **Personal access tokens**, **Fine-grained tokens**, **Generate new token**.
2. **Token name**: type `ROBINs Studio`.
3. **Expiration**: pick a date. On that day publishing stops until you make a new key, so pick a long time.
4. **Resource owner**: your own account.
5. **Repository access**: choose **Only select repositories** and pick `robins-coffee` from the list.
6. **Permissions**, then **Repository permissions**: set **Contents** to **Read and write**, and **Pull requests** to **Read and write**. "Metadata" switches itself to read-only; leave everything else as it is.
7. Click **Generate token**. GitHub shows the key once: a long line that starts with `github_pat_`. Copy it.

If the Studio says GitHub refused this key, open [your keys on GitHub](https://github.com/settings/personal-access-tokens), click the key, check the two permissions from step 6 and save.
