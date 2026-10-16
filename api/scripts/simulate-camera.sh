#!/usr/bin/env bash
# Simula uma câmera Mibo publicando via RTMP no MediaMTX local.
# Uso: scripts/simulate-camera.sh <streamKey> <video.mp4> [rtmp_base]
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Uso: $0 <streamKey> <video.mp4> [rtmp://localhost:1935]" >&2
  exit 1
fi

KEY="$1"
VIDEO="$2"
BASE="${3:-rtmp://localhost:1935}"

if [[ ! -f "$VIDEO" ]]; then
  echo "Arquivo não encontrado: $VIDEO" >&2
  exit 1
fi

echo "Publicando $VIDEO em loop → $BASE/live/$KEY (Ctrl+C para parar)"
exec ffmpeg -hide_banner -loglevel warning -re -stream_loop -1 -i "$VIDEO" \
  -c:v libx264 -preset veryfast -tune zerolatency -pix_fmt yuv420p \
  -g 50 -an -f flv "$BASE/live/$KEY"
