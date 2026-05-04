#!/usr/bin/env bash
# Elefant Mobile — Full Build Pipeline
# Builds the Android debug APK from source.
#
# Usage: ./scripts/mobile-build.sh [--release]
# Output: mobile/android/app/build/outputs/apk/debug/app-debug.apk

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DESKTOP_DIR="$REPO_ROOT/desktop"
MOBILE_DIR="$REPO_ROOT/mobile"
ANDROID_DIR="$MOBILE_DIR/android"

# ── Tooling checks ──────────────────────────────────────────────────────────

check_tool() {
  local tool="$1" hint="$2"
  if ! command -v "$tool" &>/dev/null; then
    echo "✗ $tool not found. $hint" >&2
    exit 1
  fi
}

check_tool bun     "Install Bun: https://bun.sh"
check_tool node    "Install Node.js 20+: https://nodejs.org"
check_tool java    "Install JDK 21: https://adoptium.net"

if [ -z "${ANDROID_HOME:-}" ] && [ -z "${ANDROID_SDK_ROOT:-}" ]; then
  echo "✗ ANDROID_HOME or ANDROID_SDK_ROOT not set." >&2
  echo "  Install Android Studio and set ANDROID_HOME to the SDK directory." >&2
  exit 1
fi

echo "✓ Tools: bun $(bun --version)  node $(node --version)  java $(java --version 2>&1 | head -1)"
echo ""

# ── Step 1: Build desktop web app ───────────────────────────────────────────

echo "▶ Step 1/3  Building Svelte frontend..."
cd "$DESKTOP_DIR"
bun run build
echo "✓ Web build complete → desktop/dist/"
echo ""

# ── Step 2: Sync web assets to Android ──────────────────────────────────────

echo "▶ Step 2/3  Syncing to Android (cap sync)..."
cd "$MOBILE_DIR"
npx cap sync android
echo "✓ Cap sync complete"
echo ""

# ── Step 3: Build APK ───────────────────────────────────────────────────────

echo "▶ Step 3/3  Building Android APK (assembleDebug)..."
cd "$ANDROID_DIR"
./gradlew assembleDebug --no-daemon

APK="$ANDROID_DIR/app/build/outputs/apk/debug/app-debug.apk"
if [ ! -f "$APK" ]; then
  echo "✗ APK not found at expected location: $APK" >&2
  exit 1
fi

SIZE=$(du -sh "$APK" | cut -f1)
echo ""
echo "══════════════════════════════════════"
echo "✓ Build complete!"
echo "  APK: mobile/android/app/build/outputs/apk/debug/app-debug.apk"
echo "  Size: $SIZE"
echo "══════════════════════════════════════"
echo ""
echo "  To install: ./scripts/mobile-deploy.sh"
