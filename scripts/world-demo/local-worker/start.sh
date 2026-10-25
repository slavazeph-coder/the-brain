#!/usr/bin/env bash
# A World Builder worker on your own computer, so brainsnn.com (or the local site) can turn a walkthrough video into a
# measured model today: video -> COLMAP reconstruction -> scale -> scene (GLB, USD, IFC, DXF, 3DM, CSV, fit check).
#
# usage: scripts/world-demo/local-worker/start.sh [--tunnel] [--port 8040]
#   (no flag)  the worker listens on http://127.0.0.1:PORT. Open https://brainsnn.com/world/ in Chrome or Edge on this
#              same computer and connect to that address.
#   --tunnel   also opens a free Cloudflare quick tunnel and prints its https:// address, so a phone (or any browser)
#              can connect too. The address changes every time; it is for testing, not for production.
# Linux (x86_64 or arm64) or macOS. On Windows, run it inside WSL (Ubuntu). Needs internet the first time (about 1.5 GB
# of Python packages, mostly Blender's bpy module; uv fetches Python 3.11 and 3.12 if they are missing), FFmpeg, and
# about 4 GB of free disk.
#
# Everything lives in $WORLD_LOCAL_DIR (default ~/.brainsnn-worker): the Python environment, the token, uploads and
# job outputs (deleted after 24 hours). The token is printed here, in your own terminal, once. Never paste it into a
# chat, an issue or a file in the repository; type or copy it straight into the site's Worker connection dialog.
set -euo pipefail

PORT=8040; TUNNEL=0
while [ $# -gt 0 ]; do
  case "$1" in
    --tunnel) TUNNEL=1 ;;
    --port) PORT="$2"; shift ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
DIR=${WORLD_LOCAL_DIR:-$HOME/.brainsnn-worker}
mkdir -p "$DIR/data"; chmod 700 "$DIR"

# 1. Tools.
if ! command -v ffmpeg >/dev/null || ! command -v ffprobe >/dev/null; then
  echo "FFmpeg is missing. Install it, then run this again:"
  echo "  macOS:  brew install ffmpeg        Ubuntu/WSL:  sudo apt-get install -y ffmpeg"
  exit 1
fi
if ! command -v uv >/dev/null; then
  echo "Installing uv (a Python package manager) into ~/.local/bin ..."
  curl -LsSf https://astral.sh/uv/install.sh | sh
  export PATH="$HOME/.local/bin:$PATH"
fi

# 2. Two Python environments: the worker, COLMAP and the CAD exports on Python 3.12 (their pinned numpy needs it), and
#    Blender's bpy module on Python 3.11 (Blender 4.2 needs it), which the scene engine runs as its `blender`.
PY="$DIR/venv/bin/python"; BPY="$DIR/bpy/bin/python"
if [ ! -x "$PY" ] || ! "$PY" -c 'import pycolmap, fastapi, ezdxf, rhino3dm' 2>/dev/null; then
  echo "Setting up the worker environment (first run only) ..."
  uv venv --allow-existing --python 3.12 "$DIR/venv"
  uv pip install --python "$PY" -r "$ROOT/robotics/world_worker/requirements.txt" \
    -r "$ROOT/robotics/world_worker/requirements-colmap.txt" -r "$ROOT/robotics/world_worker/requirements-cad.txt"
fi
if [ ! -x "$BPY" ] || ! "$BPY" -c 'import bpy' 2>/dev/null; then
  echo "Setting up Blender's Python module (first run only; about 400 MB) ..."
  uv venv --allow-existing --python 3.11 "$DIR/bpy"
  uv pip install --python "$BPY" bpy==4.2.23
fi

# 3. A stand-in for the blender binary: the scene engine runs its compile script through Blender's Python module.
cat > "$DIR/blender" <<EOF
#!$BPY
"""Runs \`blender -b --python script -- args\` with the bpy module (Blender 4.2 as a Python module)."""
import os, runpy, sys
argv = sys.argv[1:]
if '--version' in argv:
    import bpy
    print('Blender %d.%d.%d (bpy module)' % bpy.app.version); sys.stdout.flush(); os._exit(0)
script = argv[argv.index('--python') + 1]
sys.argv = ['blender', '--', *(argv[argv.index('--') + 1:] if '--' in argv else [])]
code = 0
try:
    runpy.run_path(script, run_name='__main__')
except SystemExit as e:
    code = e.code if isinstance(e.code, int) else (0 if e.code is None else 1)
except BaseException:
    import traceback; traceback.print_exc(); code = 1
sys.stdout.flush(); sys.stderr.flush()
os._exit(code)  # bpy can crash while the interpreter shuts down, after every file is written
EOF
chmod 755 "$DIR/blender"

# 4. The engines: reconstruction from photos or a video, and the scene compiler. This is your own test worker, so the
#    engines are switched on here; a shared worker gets a reviewed adapters file instead (robotics/world_worker/deploy).
"$PY" - "$ROOT" "$DIR" "$PY" <<'EOF'
import json, sys
root, home, py = sys.argv[1:4]
worker = f'{root}/robotics/world_worker'
engines = [
    {'id': 'colmap-sparse', 'label': 'Multi-view spatial reconstruction (CPU)', 'enabled': True, 'license_reviewed': True,
     'input_kinds': ['image', 'video'], 'max_inputs': 12, 'timeout_seconds': 1800,
     'command': [py, f'{worker}/sparse_colmap.py', '--input-manifest', '{input_manifest}']},
    {'id': 'scene-usd', 'label': 'Simulation scene (GLB/USD/IFC) from a walkthrough', 'enabled': True, 'license_reviewed': True,
     'input_kinds': ['video', 'cloud'], 'max_inputs': 1, 'timeout_seconds': 1800, 'source_job': True,
     'command': [py, f'{worker}/scene_usd.py', '--input-manifest', '{input_manifest}', '--blender', f'{home}/blender']},
]
json.dump(engines, open(f'{home}/adapters.json', 'w'), indent=1)
EOF

# 5. The token (made once; at least 32 characters, as the site requires).
if [ ! -s "$DIR/token" ]; then
  "$PY" -c 'import secrets; print(secrets.token_hex(24))' > "$DIR/token"; chmod 600 "$DIR/token"
fi

# 6. The worker. Browser calls are allowed from brainsnn.com and from the local site only.
pkill -f "uvicorn robotics.world_worker.app:create_app --factory --host 127.0.0.1 --port $PORT" 2>/dev/null || true
( cd "$ROOT" && WORLD_WORKER_TOKEN="$(cat "$DIR/token")" WORLD_WORKER_DIR="$DIR/data" WORLD_ADAPTERS_FILE="$DIR/adapters.json" \
  WORLD_ALLOWED_ORIGINS="https://brainsnn.com,https://www.brainsnn.com,http://127.0.0.1:4181,http://localhost:4181" \
  nohup "$PY" -m uvicorn robotics.world_worker.app:create_app --factory --host 127.0.0.1 --port "$PORT" > "$DIR/worker.log" 2>&1 & )
for _ in $(seq 1 60); do curl -fs "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1 && break; sleep 1; done
curl -fs "http://127.0.0.1:$PORT/healthz" >/dev/null || { echo "The worker did not start; see $DIR/worker.log"; exit 1; }
URL="http://127.0.0.1:$PORT"

# 7. Optional: an https:// address for phones, through a Cloudflare quick tunnel (no account needed).
if [ "$TUNNEL" = 1 ]; then
  CF=$(command -v cloudflared || true)
  if [ -z "$CF" ]; then
    case "$(uname -s)-$(uname -m)" in
      Linux-x86_64) asset=cloudflared-linux-amd64 ;; Linux-aarch64|Linux-arm64) asset=cloudflared-linux-arm64 ;;
      *) echo "Install cloudflared (macOS: brew install cloudflared), then run this again with --tunnel."; exit 1 ;;
    esac
    curl -fsSL -o "$DIR/cloudflared" "https://github.com/cloudflare/cloudflared/releases/latest/download/$asset"; chmod 755 "$DIR/cloudflared"; CF="$DIR/cloudflared"
  fi
  pkill -f "cloudflared tunnel --url http://127.0.0.1:$PORT" 2>/dev/null || true
  nohup "$CF" tunnel --url "http://127.0.0.1:$PORT" > "$DIR/tunnel.log" 2>&1 &
  for _ in $(seq 1 60); do grep -qo 'https://[a-z0-9-]*\.trycloudflare\.com' "$DIR/tunnel.log" 2>/dev/null && break; sleep 1; done
  URL=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$DIR/tunnel.log" | head -1)
  [ -n "$URL" ] || { echo "The tunnel did not start; see $DIR/tunnel.log"; exit 1; }
fi

cat <<EOF

World Builder worker is running.

  Worker URL:  $URL
  Token:       $(cat "$DIR/token")

In the site (https://brainsnn.com/world/, or http://127.0.0.1:4181/world/ if you serve it locally):
  1. Capture -> "Process a walkthrough / use an API worker" -> Connect processing worker.
  2. Paste the URL and the token there (only there), then Connect.
  3. Choose photos, video or map -> pick your walkthrough video (2 to 120 seconds).
  4. Engine: "Multi-view spatial reconstruction (CPU)", tick the consent box, Process all capture files.
     A one-minute video takes 2 to 5 minutes on a laptop.
  5. When the points appear, measure one distance you taped, then build the scene to get IFC, Rhino, DXF and CSV.

Logs: $DIR/worker.log$( [ "$TUNNEL" = 1 ] && echo " and $DIR/tunnel.log" )
Stop: pkill -f "port $PORT"$( [ "$TUNNEL" = 1 ] && echo "; pkill -f cloudflared" )
EOF
