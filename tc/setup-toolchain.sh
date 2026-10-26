#!/usr/bin/env bash
# Scarica android.jar (API 30) e compila dx dai sorgenti AOSP. Serve solo git + JDK.
set -euo pipefail
TC="$(cd "$(dirname "$0")" && pwd)"
W="$(mktemp -d)"
if [ ! -f "$TC/android.jar" ]; then
  git clone -q --depth 1 --filter=blob:none --sparse https://github.com/Sable/android-platforms "$W/plat"
  (cd "$W/plat" && git sparse-checkout set android-30)
  cp "$W/plat/android-30/android.jar" "$TC/android.jar"
fi
if [ ! -d "$TC/dxclasses" ]; then
  git clone -q --depth 1 --filter=blob:none --sparse https://github.com/aosp-mirror/platform_dalvik "$W/dalvik"
  (cd "$W/dalvik" && git sparse-checkout set dx)
  find "$W/dalvik/dx/src" -name '*.java' > "$W/srcs.txt"
  javac -nowarn -encoding UTF-8 -proc:none -source 8 -target 8 -d "$TC/dxclasses" @"$W/srcs.txt" 2>&1 | grep -v -E "warning|^Note" || true
fi
rm -rf "$W"
echo "toolchain pronta in $TC"
