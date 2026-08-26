#!/usr/bin/env bash
set -Eeuo pipefail

REPO_URL="${BOTGUINCHO_REPO_URL:-https://github.com/Vitorgutierrezzxcv/botguincho.git}"
REPO_BRANCH="${BOTGUINCHO_GIT_BRANCH:-main}"
INSTALL_DIR="${BOTGUINCHO_INSTALL_DIR:-/opt/botguincho}"
DATA_DIR="${BOTGUINCHO_DATA_DIR:-/opt/botguincho-data}"
ENV_FILE="$INSTALL_DIR/.env.vps"

if [ "$(id -u)" -ne 0 ]; then
  echo "Execute este instalador como root."
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends ca-certificates curl git openssl

if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi

if [ -d "$INSTALL_DIR/.git" ]; then
  git -C "$INSTALL_DIR" fetch --prune origin "$REPO_BRANCH"
  git -C "$INSTALL_DIR" switch "$REPO_BRANCH"
  git -C "$INSTALL_DIR" pull --ff-only origin "$REPO_BRANCH"
else
  if [ -e "$INSTALL_DIR" ]; then
    echo "A pasta $INSTALL_DIR já existe e não é um repositório Git."
    exit 1
  fi
  git clone --branch "$REPO_BRANCH" --single-branch "$REPO_URL" "$INSTALL_DIR"
fi

install -d -m 700 "$DATA_DIR"

PUBLIC_IP="$(curl -4 -fsS --max-time 15 https://api.ipify.org)"
if ! [[ "$PUBLIC_IP" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Não consegui identificar o IPv4 público da VPS."
  exit 1
fi
DOMAIN="botguincho.${PUBLIC_IP//./-}.sslip.io"

if [ ! -f "$ENV_FILE" ]; then
  install -m 600 "$INSTALL_DIR/.env.vps.example" "$ENV_FILE"
fi

if grep -q '^BOTGUINCHO_ADMIN_TOKEN=troque-por-' "$ENV_FILE" || ! grep -q '^BOTGUINCHO_ADMIN_TOKEN=.' "$ENV_FILE"; then
  ADMIN_TOKEN="$(openssl rand -hex 32)"
  sed -i "s|^BOTGUINCHO_ADMIN_TOKEN=.*|BOTGUINCHO_ADMIN_TOKEN=$ADMIN_TOKEN|" "$ENV_FILE"
fi
sed -i "s|^BOTGUINCHO_DOMAIN=.*|BOTGUINCHO_DOMAIN=$DOMAIN|" "$ENV_FILE"
chmod 600 "$ENV_FILE"

cd "$INSTALL_DIR"
docker compose --env-file "$ENV_FILE" -f compose.vps.yml up -d --build --remove-orphans

echo
echo "BotGuincho instalado."
echo "Endereço do worker: https://$DOMAIN"
echo "O segredo administrativo ficou salvo somente em $ENV_FILE."
echo "Para acompanhar a inicialização:"
echo "cd $INSTALL_DIR && docker compose --env-file .env.vps -f compose.vps.yml logs -f --tail=100"
