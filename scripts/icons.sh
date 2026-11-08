#!/bin/sh
# Render the PWA icons from public/favicon.svg (needs ImageMagick 7 with rsvg/inkscape delegate).
set -eu
cd "$(dirname "$0")/../public"
magick -background none -density 384 favicon.svg -resize 192x192 pwa-192x192.png
magick -background none -density 384 favicon.svg -resize 512x512 pwa-512x512.png
magick -background none -density 384 favicon.svg -resize 180x180 apple-touch-icon.png
# maskable: full-bleed background, artwork inside the 80% safe zone
magick -size 512x512 xc:'#0b1a28' \( -background none -density 384 favicon.svg -resize 400x400 \) \
  -gravity center -composite maskable-512x512.png
