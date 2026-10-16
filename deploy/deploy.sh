#!/usr/bin/env bash
# Publica o Sentinela no servidor de desenvolvimento (tudo em Docker).
# Uso: deploy/deploy.sh            (envia o HEAD commitado + modelo + vídeo e sobe)
# Variáveis: DEPLOY_HOST (root@77.42.24.7), DEPLOY_DIR (/opt/sentinela)
set -euo pipefail

HOST="${DEPLOY_HOST:-root@77.42.24.7}"
DIR="${DEPLOY_DIR:-/opt/sentinela}"
cd "$(dirname "$0")/.."

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Aviso: há alterações não commitadas; só o HEAD é publicado." >&2
fi

echo "→ Enviando código ($(git rev-parse --short HEAD)) para $HOST:$DIR"
ssh "$HOST" "mkdir -p '$DIR/api/models' '$DIR/samples'"
git archive --format=tar HEAD | ssh "$HOST" "tar -x -C '$DIR'"

if [[ -f api/models/yolo.onnx ]]; then
  echo "→ Enviando modelo YOLO"
  scp -q api/models/yolo.onnx "$HOST:$DIR/api/models/yolo.onnx"
fi
if [[ -f samples/prateleira-sintetica.mp4 ]]; then
  echo "→ Enviando vídeo sintético"
  scp -q samples/prateleira-sintetica.mp4 "$HOST:$DIR/samples/"
fi

echo "→ Subindo containers"
ssh "$HOST" "cd '$DIR' && test -f deploy/.env || { echo 'Crie $DIR/deploy/.env a partir de deploy/.env.example'; exit 1; }
  docker compose -f deploy/docker-compose.server.yml --env-file deploy/.env up -d --build --remove-orphans
  docker compose -f deploy/docker-compose.server.yml --env-file deploy/.env ps"
