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

## Publish for the first time

1. In the Studio, open **Settings**.
2. Paste your GitHub key into the field "GitHub key" and save. The key stays in this Mac's Keychain.
3. Change something, look at it under **Open preview**, then press **Publish**.

No key yet? On GitHub, open Settings, Developer settings, Personal access tokens, and make a token for the site's repository that may read and write contents and pull requests. Harry can do this with you.

## Good to know

- The Studio keeps itself up to date. Each time it starts it looks for a newer version.
- Nothing goes live until you press Publish. Until then your changes are only on this Mac.
- To install again, or to repair it, run the same line again. It keeps your unpublished changes.
- To remove it: drag ROBINs Studio from Applications to the Trash, and delete the folder `Library/Application Support/ROBINs Studio` in your home folder.

## What the line does

It downloads a short script from this website's own repository and runs it. The script installs Apple's tools if they are missing, installs bun (the program the Studio runs on), downloads a copy of the website into your Library folder, and builds the app on your Mac. You can [read the script](https://github.com/harryf/robins-coffee/blob/main/scripts/install-studio.sh) first.
