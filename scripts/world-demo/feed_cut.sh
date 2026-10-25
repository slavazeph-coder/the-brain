#!/bin/sh
# 4:5 feed version (1080 x 1350) of a 16:9 demo: title band, the recording, a footer. usage: feed_cut.sh in.mp4 out.mp4
IN=$1; OUT=$2; F=/usr/share/fonts/opentype/inter; M=/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf
ffmpeg -y -loglevel error -i "$IN" -filter_complex "\
color=c=0x06060a:s=1080x1350:r=30[bg];[0:v]scale=1080:-2[v];[bg][v]overlay=0:(H-h)/2:shortest=1,\
drawtext=fontfile=$M:text='BRAINSNN · WORLD BUILDER':fontcolor=0x00f5ff:fontsize=26:x=(w-tw)/2:y=150,\
drawtext=fontfile=$F/Inter-SemiBold.otf:text='Test walkthrough → simulation → BIM':fontcolor=0xf1f1f6:fontsize=54:x=(w-tw)/2:y=205,\
drawtext=fontfile=$F/Inter-Medium.otf:text='A real run on brainsnn.com':fontcolor=0x9aa0b4:fontsize=34:x=(w-tw)/2:y=285,\
drawtext=fontfile=$M:text='GLB · OpenUSD · IFC4 · app and API':fontcolor=0x9aa0b4:fontsize=28:x=(w-tw)/2:y=1050,\
drawtext=fontfile=$M:text='Test capture · scale self-reported, not verified':fontcolor=0x6f7489:fontsize=24:x=(w-tw)/2:y=1100,format=yuv420p" \
  -c:v libx264 -preset slow -crf 20 -movflags +faststart "$OUT"
