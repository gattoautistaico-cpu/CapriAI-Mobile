#!/usr/bin/env bash
# Uso: ./build.sh <cartella-progetto> <package> "<Etichetta>" [opzioni mkapk...]
set -euo pipefail
TC="$(cd "$(dirname "$0")" && pwd)"
P="$(cd "$1" && pwd)"; PKG="$2"; LABEL="$3"; shift 3
W="$P/build"; rm -rf "$W"; mkdir -p "$W/classes"
find "$P/src" -name '*.java' > "$W/srcs.txt"
javac -nowarn -encoding UTF-8 -source 8 -target 8 -bootclasspath "$TC/android.jar" -cp "$TC/android.jar" -d "$W/classes" @"$W/srcs.txt" 2>&1 | grep -v -E "JAVA_TOOL|warning|^Note" || true
java -cp "$TC/dxclasses" com.android.dx.command.Main --dex --min-sdk-version=24 --output="$W/classes.dex" "$W/classes" 2>&1 | grep -v JAVA_TOOL || true
A=(); [ -d "$P/assets" ] && A=(--assets "$P/assets")
python3 "$TC/mkapk.py" "$W/unsigned.apk" "$W/classes.dex" "$P/ic_launcher.png" --pkg "$PKG" --label "$LABEL" "${A[@]}" "$@"
KS="$TC/release.jks"
[ -f "$KS" ] || keytool -genkeypair -keystore "$KS" -storepass android -keypass android -alias app -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Android App, O=Dev, C=IT" 2>&1 | grep -v JAVA_TOOL || true
OUT="$P/$(echo "$LABEL" | tr -cd 'A-Za-z0-9').apk"
cp "$W/unsigned.apk" "$OUT"
jarsigner -sigalg SHA256withRSA -digestalg SHA-256 -keystore "$KS" -storepass android "$OUT" app 2>&1 | grep -v -E "JAVA_TOOL|warning|jar signed|^$|Warning|signer|self-signed|certificate|chain|POSIX|For" || true
jarsigner -verify "$OUT" 2>&1 | grep -E "verified" || true
echo "APK: $OUT ($(stat -c %s "$OUT") bytes)"
