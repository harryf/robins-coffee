#!/bin/bash
# Installs ROBIN's Studio, the editor of the bar's website, on a Mac.
#
#   curl -fsSL https://raw.githubusercontent.com/harryf/robins-coffee/main/scripts/install-studio.sh | bash
#
# What it does, in order, and nothing else:
#   1. asks Apple for its command line tools (git and the Swift compiler) if they are missing
#   2. installs bun (the program the Studio runs on) from bun.sh if it is missing
#   3. puts a copy of the website into ~/Library/Application Support/ROBINs Studio/site
#   4. installs the Studio's packages there
#   5. builds the app "ROBINs Studio" into ~/Applications, on this Mac, from that copy
#   6. remembers both places, then opens the app
# It asks for no password and changes nothing outside those two folders and ~/.bun.
# Running it again is safe: it updates what is there. The instructions for people are at
# https://harryf.github.io/robins-coffee/studio/ . It is a shell script because it has to
# run before bun exists; everything after this is TypeScript.
set -euo pipefail

REPO_URL="${ROBINS_STUDIO_REPO:-https://github.com/harryf/robins-coffee.git}"
BRANCH="${ROBINS_STUDIO_BRANCH:-main}"
SUPPORT="$HOME/Library/Application Support/ROBINs Studio"
SITE_DIR="$SUPPORT/site"
APP_DIR="$HOME/Applications"
APP="$APP_DIR/ROBINs Studio.app"

say() { printf '\n\033[1m%s\033[0m\n' "$1"; }
stop() { printf '\n%s\n' "$1" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || stop "This installer is for a Mac."

say "1 of 5: Apple's tools"
if ! xcode-select -p >/dev/null 2>&1; then
  xcode-select --install >/dev/null 2>&1 || true
  echo "A window from Apple has opened. Click \"Install\" and wait until it says it is done."
  echo "This can take ten minutes. This window carries on by itself afterwards."
  waited=0
  until xcode-select -p >/dev/null 2>&1; do
    sleep 10
    waited=$((waited + 10))
    [ "$waited" -lt 3600 ] || stop "Apple's tools did not arrive within an hour. Run the same line again once they are installed."
  done
fi
command -v git >/dev/null 2>&1 || stop "git is missing even with Apple's tools. Run the same line again in a minute."
echo "ready"

say "2 of 5: bun"
BUN="$(command -v bun || true)"
[ -n "$BUN" ] || { [ -x "$HOME/.bun/bin/bun" ] && BUN="$HOME/.bun/bin/bun"; } || true
if [ -z "$BUN" ]; then
  curl -fsSL https://bun.sh/install | bash >/dev/null
  BUN="$HOME/.bun/bin/bun"
fi
[ -x "$BUN" ] || stop "bun could not be installed. Look at https://bun.sh and run the same line again."
echo "ready ($("$BUN" --version))"

say "3 of 5: a copy of the website"
if [ -d "$SITE_DIR/.git" ]; then
  git -C "$SITE_DIR" pull --quiet --ff-only || echo "(could not update the copy now; the Studio tries again each time it starts)"
else
  mkdir -p "$SUPPORT"
  git clone --quiet --branch "$BRANCH" "$REPO_URL" "$SITE_DIR"
fi
echo "ready"

say "4 of 5: the Studio's packages"
(cd "$SITE_DIR" && "$BUN" install --frozen-lockfile >/dev/null)
echo "ready"

say "5 of 5: the app"
mkdir -p "$APP_DIR"
(cd "$SITE_DIR" && "$BUN" scripts/build-app.ts --out "$APP_DIR" >/dev/null)
[ -d "$APP" ] || stop "The app could not be built."
# The app and its updates find the copy and each other through this small file.
(cd "$SITE_DIR" && "$BUN" -e 'await Bun.write(process.argv[1], JSON.stringify({ folder: process.argv[2], app: process.argv[3] }, null, 2) + "\n")' "$SUPPORT/config.json" "$SITE_DIR" "$APP")
echo "ready"

say "Done. ROBINs Studio is in your Applications folder (the one in your home folder)."
echo "Find it with Spotlight (press Command and Space, type Studio) and drag it to the Dock if you like."
echo "It keeps itself up to date from now on."
[ -n "${ROBINS_STUDIO_NO_OPEN:-}" ] || open "$APP"
