#!/usr/bin/env bash
# Zense first-time installer for macOS.
# Usage: curl -fsSL https://<worker-domain>/install.sh | bash
#
# The app is not Apple-notarized, so after copying it into /Applications we
# strip the quarantine attribute instead. In-app updates afterwards are
# delivered + verified by the Tauri updater (minisign) and are not subject
# to Gatekeeper again.
set -euo pipefail

# The publish script rewrites this placeholder to the real origin.
BASE_URL="${ZENSE_DOWNLOAD_URL:-https://zense-dl.YOUR-ACCOUNT.workers.dev}"
APP_NAME="zense.app"
INSTALL_DIR="/Applications"
TMP_DMG="$(mktemp -t zense-install).dmg"
MOUNT_POINT=""

cleanup() {
  [ -n "$MOUNT_POINT" ] && hdiutil detach "$MOUNT_POINT" -quiet 2>/dev/null || true
  rm -f "$TMP_DMG"
}
trap cleanup EXIT

arch="$(uname -m)"
case "$arch" in
  arm64)  TAURI_ARCH="aarch64" ;;
  x86_64) TAURI_ARCH="x64" ;;
  *) echo "Unsupported architecture: $arch" >&2; exit 1 ;;
esac

echo "→ Fetching release info…"
version="$(curl -fsSL "$BASE_URL/latest.json" | sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
version="${version#v}"
if [ -z "$version" ]; then
  echo "Could not determine latest version from $BASE_URL/latest.json" >&2
  exit 1
fi

dmg_name="zense_${version}_${TAURI_ARCH}.dmg"
echo "→ Downloading ${dmg_name}…"
curl -fSL --progress-bar "$BASE_URL/download/$dmg_name" -o "$TMP_DMG"

echo "→ Installing to ${INSTALL_DIR}…"
MOUNT_POINT="$(hdiutil attach "$TMP_DMG" -nobrowse -quiet | tail -1 | awk -F'\t' '{print $NF}' | sed 's/^ *//')"
rm -rf "$INSTALL_DIR/$APP_NAME"
cp -R "$MOUNT_POINT/$APP_NAME" "$INSTALL_DIR/"
hdiutil detach "$MOUNT_POINT" -quiet
MOUNT_POINT=""

# Skip Gatekeeper: the binary was fetched over HTTPS from our own endpoint.
xattr -dr com.apple.quarantine "$INSTALL_DIR/$APP_NAME" 2>/dev/null || true

echo "✓ Zense $version installed → $INSTALL_DIR/$APP_NAME"
open "$INSTALL_DIR/$APP_NAME"
