#!/usr/bin/env bash
set -euo pipefail

PAIR_CODE="${1:-}"
PLATE="${2:-GSW0H17}"
BASE_URL="https://raw.githubusercontent.com/Vitorgutierrezzxcv/botguincho/main"
INSTALL_DIR="/opt/botguincho-gconnect"
ENV_FILE="/etc/botguincho-gconnect.env"
SERVICE_FILE="/etc/systemd/system/botguincho-gconnect.service"
RUN_USER="${SUDO_USER:-${USER:-root}}"

if [ -z "$PAIR_CODE" ]; then
  echo "Uso: sudo bash install-gconnect-agent.sh CODIGO_PAREAMENTO [PLACA]"
  exit 2
fi

command -v adb >/dev/null 2>&1 || { echo "ADB não encontrado nesta VM."; exit 3; }
command -v node >/dev/null 2>&1 || { echo "Node.js não encontrado nesta VM."; exit 4; }

mkdir -p "$INSTALL_DIR"
curl -fsSL "$BASE_URL/tools/gconnect-emulator-agent.mjs" -o "$INSTALL_DIR/agent.mjs"
chmod 755 "$INSTALL_DIR/agent.mjs"

cat > "$ENV_FILE" <<EOF
BOTGUINCHO_PAIR_CODE=$PAIR_CODE
BOTGUINCHO_BRIDGE_URL=https://botguincho.vercel.app/api/worker/tracker-bridge
GCONNECT_PLATE=$PLATE
GCONNECT_PACKAGE=br.com.getrak.gconnect
GCONNECT_POLL_SECONDS=20
EOF
chmod 600 "$ENV_FILE"

cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=Bot Guincho - GConnect Android Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$RUN_USER
EnvironmentFile=$ENV_FILE
ExecStart=$(command -v node) $INSTALL_DIR/agent.mjs
Restart=always
RestartSec=5
WorkingDirectory=$INSTALL_DIR

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now botguincho-gconnect.service
sleep 3
systemctl --no-pager --full status botguincho-gconnect.service || true

echo
echo "Agente instalado. O painel deve mostrar GConnect Online em até 30 segundos."
