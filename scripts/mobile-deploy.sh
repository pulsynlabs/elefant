#!/usr/bin/env bash
# Elefant Mobile — ADB Deploy Script
# Installs the debug APK to a connected Android device/emulator.
#
# Usage: ./scripts/mobile-deploy.sh [--launch]
#   --launch  Launch the app immediately after install

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APK="$REPO_ROOT/mobile/android/app/build/outputs/apk/debug/app-debug.apk"
APP_ID="com.elefant.app"
MAIN_ACTIVITY="$APP_ID/com.getcapacitor.BridgeActivity"
LAUNCH=false

for arg in "$@"; do
  case "$arg" in
    --launch) LAUNCH=true ;;
  esac
done

# ── Check prerequisites ──────────────────────────────────────────────────────

if ! command -v adb &>/dev/null; then
  echo "✗ adb not found. Install Android Platform Tools and add to PATH." >&2
  exit 1
fi

if [ ! -f "$APK" ]; then
  echo "✗ APK not found: $APK" >&2
  echo "  Run ./scripts/mobile-build.sh first." >&2
  exit 1
fi

# ── Check connected devices ──────────────────────────────────────────────────

DEVICES=$(adb devices | grep -v "List of devices" | grep "device$" | awk '{print $1}')
DEVICE_COUNT=$(echo "$DEVICES" | grep -c "." 2>/dev/null || true)

if [ "$DEVICE_COUNT" -eq 0 ]; then
  echo "✗ No Android device or emulator connected." >&2
  echo "  Connect a device with USB debugging enabled, or start an emulator." >&2
  adb devices >&2
  exit 1
fi

if [ "$DEVICE_COUNT" -gt 1 ]; then
  echo "⚠ Multiple devices connected. Using first: $(echo "$DEVICES" | head -1)"
fi

echo "▶ Installing APK to Android device..."
adb install -r "$APK"
echo "✓ APK installed successfully"

if [ "$LAUNCH" = true ]; then
  echo "▶ Launching Elefant..."
  adb shell am start -n "$MAIN_ACTIVITY"
  echo "✓ App launched"
fi

echo ""
echo "  APK: $APK"
