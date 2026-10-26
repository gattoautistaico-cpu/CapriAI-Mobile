#!/usr/bin/env bash
# Compila e firma CapriAI.apk. Uso: ./build-apk.sh [versionCode] [versionName]
set -euo pipefail
cd "$(dirname "$0")"
VC="${1:-500}"; VN="${2:-0.5.0}"
./tc/setup-toolchain.sh
./tc/build.sh app com.cyberai.capri "Capri AI" \
  --perm android.permission.INTERNET --perm android.permission.ACCESS_NETWORK_STATE \
  --perm android.permission.RECORD_AUDIO --perm android.permission.SYSTEM_ALERT_WINDOW \
  --perm android.permission.FOREGROUND_SERVICE --perm android.permission.MODIFY_AUDIO_SETTINGS \
  --perm android.permission.READ_CONTACTS --perm android.permission.CALL_PHONE \
  --cleartext --service .BubbleService --a11y .ScreenReader \
  --version-code "$VC" --version-name "$VN"
