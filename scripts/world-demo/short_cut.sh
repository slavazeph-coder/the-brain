#!/bin/sh
# A short 4:5 feed clip (1080 x 1350) from chosen moments of a 16:9 demo recording: title band, the moments with hard cuts,
# and a footer that says what the run was. Take the moments from the "captions in the output video" list the recorder prints.
# usage: short_cut.sh in.mp4 out.mp4 'line under the title' 'footer' START+SECONDS [START+SECONDS ...]
IN=$1; OUT=$2; SUB=$3; FOOT=$4; shift 4
F=/usr/share/fonts/opentype/inter; M=/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf
n=0; parts=; labels=
for seg in "$@"; do
  start=${seg%+*}; len=${seg#*+}
  parts="$parts[0:v]trim=start=$start:duration=$len,setpts=PTS-STARTPTS[s$n];"; labels="$labels[s$n]"; n=$((n + 1))
done
ffmpeg -y -loglevel error -i "$IN" -filter_complex "$parts${labels}concat=n=$n:v=1:a=0[cut];\
color=c=0x06060a:s=1080x1350:r=30[bg];[cut]scale=1080:-2[v];[bg][v]overlay=0:(H-h)/2:shortest=1,\
drawtext=fontfile=$M:text='BRAINSNN · WORLD BUILDER':fontcolor=0x00f5ff:fontsize=26:x=(w-tw)/2:y=150,\
drawtext=fontfile=$F/Inter-SemiBold.otf:text='Phone walkthrough → simulation → BIM':fontcolor=0xf1f1f6:fontsize=54:x=(w-tw)/2:y=205,\
drawtext=fontfile=$F/Inter-Medium.otf:text='$SUB':fontcolor=0x9aa0b4:fontsize=34:x=(w-tw)/2:y=285,\
drawtext=fontfile=$M:text='GLB · OpenUSD · IFC4 · app and API':fontcolor=0x9aa0b4:fontsize=28:x=(w-tw)/2:y=1050,\
drawtext=fontfile=$M:text='$FOOT':fontcolor=0x6f7489:fontsize=24:x=(w-tw)/2:y=1100,format=yuv420p" \
  -c:v libx264 -preset slow -crf 20 -movflags +faststart "$OUT"
