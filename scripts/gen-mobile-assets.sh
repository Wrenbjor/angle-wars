#!/usr/bin/env bash
#
# gen-mobile-assets.sh — deterministic native icon + splash generator.
#
# Rasterizes the single brand source resources/icon.svg into every iOS +
# Android launcher-icon and splash density required by the Capacitor native
# shells, replacing the default Capacitor placeholder assets with branded ones.
#
# Design invariants (see spec-7-6-store-release-scaffolding):
#   * One source, generated fan-out. The Capacitor density table is hard-coded
#     below so output dimensions are exact, not inferred.
#   * Neon glow is applied here at raster time (blur + screen composite), NOT in
#     the SVG — IM6's internal MSVG renderer has no feGaussianBlur.
#   * Alpha rules are load-bearing:
#       - opaque icons + all splashes are flattened onto the brand background
#         with the alpha channel STRIPPED (App Store rejects icons with alpha);
#       - the Android adaptive foreground keeps its alpha (it composites over a
#         separate background layer).
#   * Every PNG is 8-bit (-depth 8).
#   * ImageMagick is a BUILD-TIME tool only. The generated PNGs are committed,
#     so no consumer needs `convert`. Re-running is idempotent w.r.t. dimensions.
#
# Usage: npm run assets:mobile   (or: bash scripts/gen-mobile-assets.sh)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

SRC="$ROOT/resources/icon.svg"
BG="#05060a"                       # near-black brand background
ANDROID_RES="$ROOT/android/app/src/main/res"
IOS_ASSETS="$ROOT/ios/App/App/Assets.xcassets"

# --- preconditions -----------------------------------------------------------
if ! command -v convert >/dev/null 2>&1; then
  echo "ERROR: ImageMagick 'convert' not found on PATH." >&2
  echo "       Install ImageMagick to regenerate mobile assets (build-time only;" >&2
  echo "       the generated PNGs are committed, so runtime never needs it)." >&2
  exit 1
fi
if [ ! -f "$SRC" ]; then
  echo "ERROR: brand source not found: $SRC" >&2
  exit 1
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

MASTER=1024

# --- master renders ----------------------------------------------------------
# flat: the brand mark rasterized at full resolution (opaque, has brand bg).
convert -background none "$SRC" -resize "${MASTER}x${MASTER}" "$WORK/flat.png"

# glow: opaque master with the neon glow (blurred clone screened over itself).
convert "$WORK/flat.png" \( +clone -blur 0x16 \) -compose screen -composite \
  -depth 8 "$WORK/glow.png"

# fg: transparent emblem+glow (brand bg knocked out) for the adaptive foreground
# and for splash compositing.
convert "$WORK/glow.png" -fuzz 6% -transparent "$BG" -depth 8 "$WORK/fg.png"

# --- emitters ----------------------------------------------------------------
# Opaque square icon: alpha stripped, flattened onto the brand background.
gen_icon() { # size out
  mkdir -p "$(dirname "$2")"
  convert "$WORK/glow.png" -resize "${1}x${1}" \
    -background "$BG" -flatten -alpha off -depth 8 "$2"
}

# Adaptive foreground: KEEPS alpha (transparent around the emblem).
gen_fg() { # size out
  mkdir -p "$(dirname "$2")"
  convert "$WORK/fg.png" -resize "${1}x${1}" -depth 8 "$2"
}

# Splash: opaque WxH brand canvas with the emblem centered, alpha stripped.
gen_splash() { # w h out
  local w="$1" h="$2" out="$3" emblem
  mkdir -p "$(dirname "$out")"
  # emblem occupies ~55% of the shorter edge, centered.
  if [ "$w" -lt "$h" ]; then emblem=$(( w * 55 / 100 )); else emblem=$(( h * 55 / 100 )); fi
  convert -size "${w}x${h}" "xc:${BG}" \
    \( "$WORK/fg.png" -resize "${emblem}x${emblem}" \) \
    -gravity center -compose over -composite \
    -alpha off -depth 8 "$out"
}

# --- Android launcher icons --------------------------------------------------
# mipmap density -> icon edge (px)
declare -a ICON_DENS=(mdpi hdpi xhdpi xxhdpi xxxhdpi)
declare -a ICON_SIZE=(48   72   96    144    192)
declare -a FG_SIZE=(108   162  216   324    432)

for i in "${!ICON_DENS[@]}"; do
  d="${ICON_DENS[$i]}"
  dir="$ANDROID_RES/mipmap-$d"
  mkdir -p "$dir"
  gen_icon "${ICON_SIZE[$i]}" "$dir/ic_launcher.png"
  gen_icon "${ICON_SIZE[$i]}" "$dir/ic_launcher_round.png"
  gen_fg   "${FG_SIZE[$i]}"   "$dir/ic_launcher_foreground.png"
  echo "  android icon  $d  (${ICON_SIZE[$i]}px, fg ${FG_SIZE[$i]}px)"
done

# --- Android splashes --------------------------------------------------------
# default drawable/ splash (mdpi landscape baseline)
mkdir -p "$ANDROID_RES/drawable"
gen_splash 480 320 "$ANDROID_RES/drawable/splash.png"
echo "  android splash drawable (480x320)"

# landscape: dir  w    h
gen_splash 480  320  "$ANDROID_RES/drawable-land-mdpi/splash.png"
gen_splash 800  480  "$ANDROID_RES/drawable-land-hdpi/splash.png"
gen_splash 1280 720  "$ANDROID_RES/drawable-land-xhdpi/splash.png"
gen_splash 1600 960  "$ANDROID_RES/drawable-land-xxhdpi/splash.png"
gen_splash 1920 1280 "$ANDROID_RES/drawable-land-xxxhdpi/splash.png"
echo "  android splash landscape (mdpi..xxxhdpi)"

# portrait
gen_splash 320  480  "$ANDROID_RES/drawable-port-mdpi/splash.png"
gen_splash 480  800  "$ANDROID_RES/drawable-port-hdpi/splash.png"
gen_splash 720  1280 "$ANDROID_RES/drawable-port-xhdpi/splash.png"
gen_splash 960  1600 "$ANDROID_RES/drawable-port-xxhdpi/splash.png"
gen_splash 1280 1920 "$ANDROID_RES/drawable-port-xxxhdpi/splash.png"
echo "  android splash portrait (mdpi..xxxhdpi)"

# --- iOS ---------------------------------------------------------------------
# Single universal 1024 app icon (no alpha — Xcode derives the rest).
gen_icon 1024 "$IOS_ASSETS/AppIcon.appiconset/AppIcon-512@2x.png"
echo "  ios app icon (1024x1024, no alpha)"

# Three 2732x2732 splash variants (1x/2x/3x share one square master).
gen_splash 2732 2732 "$IOS_ASSETS/Splash.imageset/splash-2732x2732.png"
gen_splash 2732 2732 "$IOS_ASSETS/Splash.imageset/splash-2732x2732-1.png"
gen_splash 2732 2732 "$IOS_ASSETS/Splash.imageset/splash-2732x2732-2.png"
echo "  ios splash (2732x2732 x3)"

echo "Done. Regenerated branded native icons + splashes from resources/icon.svg."
