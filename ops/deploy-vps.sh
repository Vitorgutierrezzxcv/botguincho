#!/usr/bin/env bash
set -Eeuo pipefail

INSTALL_DIR="${BOTGUINCHO_INSTALL_DIR:-/opt/botguincho}"
ENV_FILE="$INSTALL_DIR/.env.vps"
REPO_BRANCH="${BOTGUINCHO_GIT_BRANCH:-main}"

if [ "$(id -u)" -ne 0 ]; then
  echo "Execute este atualizador como root."
  exit 1
fi

if [ ! -d "$INSTALL_DIR/.git" ] || [ ! -f "$ENV_FILE" ]; then
  echo "Instalação do BotGuincho não encontrada em $INSTALL_DIR."
  exit 1
fi

git -C "$INSTALL_DIR" fetch --prune origin "$REPO_BRANCH"
git -C "$INSTALL_DIR" switch "$REPO_BRANCH"
git -C "$INSTALL_DIR" pull --ff-only origin "$REPO_BRANCH"

cd "$INSTALL_DIR"
docker compose --env-file "$ENV_FILE" -f compose.vps.yml up -d --build --remove-orphans
docker image prune -f --filter 'until=168h'
docker compose --env-file "$ENV_FILE" -f compose.vps.yml ps
