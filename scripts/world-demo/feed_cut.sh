#!/bin/sh
# 4:5 feed version (1080 x 1350) of a 16:9 demo: title band, the recording, a footer. usage: feed_cut.sh in.mp4 out.mp4
# The texts default to the scan-to-model demo; set TITLE, SUBTITLE, FOOTER and NOTE for another (no colons: ffmpeg reads them as separators).
IN=$1; OUT=$2; TITLE=${TITLE:-Test walkthrough → simulation → BIM}; SUBTITLE=${SUBTITLE:-A real run on brainsnn.com}
FOOTER=${FOOTER:-GLB · OpenUSD · IFC4 · app and API}; NOTE=${NOTE:-Test capture · scale self-reported, not verified}; F=/usr/share/fonts/opentype/inter; M=/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf
ffmpeg -y -loglevel error -i "$IN" -filter_complex "\
color=c=0x06060a:s=1080x1350:r=30[bg];[0:v]scale=1080:-2[v];[bg][v]overlay=0:(H-h)/2:shortest=1,\
drawtext=fontfile=$M:text='BRAINSNN · WORLD BUILDER':fontcolor=0x00f5ff:fontsize=26:x=(w-tw)/2:y=150,\
drawtext=fontfile=$F/Inter-SemiBold.otf:text='$TITLE':fontcolor=0xf1f1f6:fontsize=54:x=(w-tw)/2:y=205,\
drawtext=fontfile=$F/Inter-Medium.otf:text='$SUBTITLE':fontcolor=0x9aa0b4:fontsize=34:x=(w-tw)/2:y=285,\
drawtext=fontfile=$M:text='$FOOTER':fontcolor=0x9aa0b4:fontsize=28:x=(w-tw)/2:y=1050,\
drawtext=fontfile=$M:text='$NOTE':fontcolor=0x6f7489:fontsize=24:x=(w-tw)/2:y=1100,format=yuv420p" \
  -c:v libx264 -preset slow -crf 20 -movflags +faststart "$OUT"
