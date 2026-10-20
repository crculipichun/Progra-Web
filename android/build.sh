#!/usr/bin/env bash
# Compila el APK sin Gradle, con las herramientas de Android de Debian/Ubuntu:
#   sudo apt install android-sdk-platform-23 aapt apksigner zipalign dalvik-exchange
# Uso: android/build.sh  → android/build/planos.apk
set -euo pipefail
cd "$(dirname "$0")"

ANDROID_JAR=${ANDROID_JAR:-/usr/lib/android-sdk/platforms/android-23/android.jar}
DX=${DX:-dalvik-exchange}
VERSION_CODE=${VERSION_CODE:-1}
VERSION_NAME=${VERSION_NAME:-1.0}
KEYSTORE=${KEYSTORE:-debug.keystore}
KS_PASS=${KS_PASS:-android}

rm -rf build
mkdir -p build/gen build/classes build/assets/www

# 1. Copiar la app web a assets/www
cp -r ../index.html ../manifest.webmanifest ../css ../js ../icons build/assets/www/

# 2. Recursos + manifest → APK sin código
aapt package -f -m \
  -M AndroidManifest.xml -S res -A build/assets -I "$ANDROID_JAR" \
  -J build/gen -F build/unsigned.apk \
  --min-sdk-version 24 --target-sdk-version 34 \
  --version-code "$VERSION_CODE" --version-name "$VERSION_NAME"

# 3. Java → .class → classes.dex
javac -nowarn --release 8 -Xlint:-options -classpath "$ANDROID_JAR" -d build/classes \
  build/gen/com/planos/app/R.java src/com/planos/app/*.java
"$DX" --dex --min-sdk-version=24 --output=build/classes.dex build/classes
(cd build && aapt add -f unsigned.apk classes.dex >/dev/null)

# 4. Alinear y firmar
zipalign -f -p 4 build/unsigned.apk build/aligned.apk
if [ ! -f "$KEYSTORE" ]; then
  keytool -genkeypair -keystore "$KEYSTORE" -storepass "$KS_PASS" -keypass "$KS_PASS" \
    -alias planos -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Planos" >/dev/null 2>&1
fi
apksigner sign --ks "$KEYSTORE" --ks-pass "pass:$KS_PASS" --out build/planos.apk build/aligned.apk
apksigner verify build/planos.apk
echo "APK listo: $(pwd)/build/planos.apk"
