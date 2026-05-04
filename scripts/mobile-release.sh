#!/usr/bin/env bash
# Elefant Mobile — Release Build Guide
# This script prints instructions for building a signed release APK.
# Actual signing requires a keystore — see instructions below.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ANDROID_DIR="$REPO_ROOT/mobile/android"

cat <<'INSTRUCTIONS'
══════════════════════════════════════════════════════════════
  Elefant Mobile — Signed Release APK
══════════════════════════════════════════════════════════════

This script guides you through building a signed release APK
for distribution (Play Store, direct APK, enterprise MDM).

STEP 1 — Create a keystore (one-time setup)
─────────────────────────────────────────────
  keytool -genkey -v \
    -keystore elefant-release.keystore \
    -alias elefant \
    -keyalg RSA -keysize 2048 \
    -validity 10000

  Keep elefant-release.keystore somewhere SAFE and SECRET.
  Never commit it to git.

STEP 2 — Configure signing in gradle
─────────────────────────────────────────────
  In mobile/android/app/build.gradle, add a signingConfigs block:

  signingConfigs {
    release {
      storeFile file(System.getenv("KEYSTORE_PATH") ?: "elefant-release.keystore")
      storePassword System.getenv("KEYSTORE_PASSWORD") ?: ""
      keyAlias System.getenv("KEY_ALIAS") ?: "elefant"
      keyPassword System.getenv("KEY_PASSWORD") ?: ""
    }
  }

  buildTypes {
    release {
      signingConfig signingConfigs.release
      minifyEnabled false
      proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
    }
  }

STEP 3 — Build the release APK
─────────────────────────────────────────────
  export KEYSTORE_PATH=/path/to/elefant-release.keystore
  export KEYSTORE_PASSWORD=your_password
  export KEY_ALIAS=elefant
  export KEY_PASSWORD=your_key_password

  cd mobile/android
  ./gradlew assembleRelease

  Output: mobile/android/app/build/outputs/apk/release/app-release.apk

STEP 4 — Verify signing
─────────────────────────────────────────────
  apksigner verify --verbose mobile/android/app/build/outputs/apk/release/app-release.apk

══════════════════════════════════════════════════════════════
INSTRUCTIONS

echo ""
echo "To build release now (requires env vars set):"
echo ""
echo "  KEYSTORE_PATH=... KEYSTORE_PASSWORD=... KEY_ALIAS=elefant KEY_PASSWORD=..."
echo "  cd $ANDROID_DIR && ./gradlew assembleRelease"
echo ""
