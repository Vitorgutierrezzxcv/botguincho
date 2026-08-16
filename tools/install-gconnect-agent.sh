#!/usr/bin/env bash
set -euo pipefail

PAIR_CODE="${1:-}"
PLATE="${2:-GSW0H17}"
AVD_NAME="${3:-gconnect-playstore}"
BASE_URL="https://raw.githubusercontent.com/Vitorgutierrezzxcv/botguincho/main"
INSTALL_DIR="/opt/botguincho-gconnect"
ENV_FILE="/etc/botguincho-gconnect.env"
AGENT_SERVICE="/etc/systemd/system/botguincho-gconnect.service"
EMULATOR_SERVICE="/etc/systemd/system/botguincho-android-emulator.service"
WATCHDOG_SERVICE="/etc/systemd/system/botguincho-gconnect-watchdog.service"
WATCHDOG_TIMER="/etc/systemd/system/botguincho-gconnect-watchdog.timer"
WATCHDOG_SCRIPT="$INSTALL_DIR/watchdog.sh"
HEARTBEAT_FILE="/var/run/botguincho-gconnect-heartbeat"
RUN_USER="${SUDO_USER:-${USER:-root}}"
RUN_HOME="$(getent passwd "$RUN_USER" | cut -d: -f6)"

if [ -z "$PAIR_CODE" ]; then
  echo "Uso: sudo bash install-gconnect-agent.sh CODIGO_PAREAMENTO [PLACA] [AVD]"
  exit 2
fi

NODE_BIN="$(command -v node || true)"
ADB_BIN="$(command -v adb || true)"
EMULATOR_BIN="$(command -v emulator || true)"
[ -n "$ADB_BIN" ] || ADB_BIN="$RUN_HOME/android-sdk/platform-tools/adb"
[ -n "$EMULATOR_BIN" ] || EMULATOR_BIN="$RUN_HOME/android-sdk/emulator/emulator"

[ -x "$NODE_BIN" ] || { echo "Node.js não encontrado nesta VM."; exit 3; }
[ -x "$ADB_BIN" ] || { echo "ADB não encontrado nesta VM."; exit 4; }
[ -x "$EMULATOR_BIN" ] || { echo "Android Emulator não encontrado nesta VM."; exit 5; }

mkdir -p "$INSTALL_DIR"
curl -fsSL "$BASE_URL/tools/gconnect-emulator-agent.mjs" -o "$INSTALL_DIR/agent.mjs"
chmod 755 "$INSTALL_DIR/agent.mjs"

cat > "$ENV_FILE" <<EOF
BOTGUINCHO_PAIR_CODE=$PAIR_CODE
BOTGUINCHO_BRIDGE_URL=https://botguincho.vercel.app/api/worker/tracker-bridge
GCONNECT_PLATE=$PLATE
GCONNECT_PACKAGE=br.com.getrak.gconnect
GCONNECT_POLL_SECONDS=20
GCONNECT_MAX_FAILURES=4
GCONNECT_HEARTBEAT_FILE=$HEARTBEAT_FILE
PATH=$(dirname "$ADB_BIN"):$(dirname "$EMULATOR_BIN"):/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
HOME=$RUN_HOME
ANDROID_HOME=$RUN_HOME/android-sdk
ANDROID_SDK_ROOT=$RUN_HOME/android-sdk
EOF
chmod 600 "$ENV_FILE"

cat > "$EMULATOR_SERVICE" <<EOF
[Unit]
Description=Bot Guincho - Android Emulator GConnect
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$RUN_USER
Environment=HOME=$RUN_HOME
Environment=ANDROID_HOME=$RUN_HOME/android-sdk
Environment=ANDROID_SDK_ROOT=$RUN_HOME/android-sdk
Environment=PATH=$(dirname "$ADB_BIN"):$(dirname "$EMULATOR_BIN"):/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
ExecStartPre=-$ADB_BIN kill-server
ExecStartPre=-$ADB_BIN start-server
ExecStart=$EMULATOR_BIN -avd $AVD_NAME -no-snapshot-load -no-snapshot-save -no-window -no-audio -no-boot-anim -no-metrics -gpu swiftshader_indirect -accel on
Restart=always
RestartSec=10
TimeoutStopSec=30
StartLimitIntervalSec=0

[Install]
WantedBy=multi-user.target
EOF

cat > "$AGENT_SERVICE" <<EOF
[Unit]
Description=Bot Guincho - GConnect Android Agent
After=network-online.target botguincho-android-emulator.service
Wants=network-online.target botguincho-android-emulator.service

[Service]
Type=simple
User=$RUN_USER
EnvironmentFile=$ENV_FILE
ExecStartPre=/usr/bin/curl -fsSL $BASE_URL/tools/gconnect-emulator-agent.mjs -o $INSTALL_DIR/agent.mjs
ExecStartPre=/usr/bin/chmod 755 $INSTALL_DIR/agent.mjs
ExecStart=$NODE_BIN $INSTALL_DIR/agent.mjs
Restart=always
RestartSec=5
StartLimitIntervalSec=0
WorkingDirectory=$INSTALL_DIR

[Install]
WantedBy=multi-user.target
EOF

cat > "$WATCHDOG_SCRIPT" <<EOF
#!/usr/bin/env bash
set -u
ADB="$ADB_BIN"
HEARTBEAT="$HEARTBEAT_FILE"
MAX_AGE=120

restart_all() {
  echo "[watchdog] reiniciando emulador e agente"
  systemctl restart botguincho-android-emulator.service
  sleep 20
  systemctl restart botguincho-gconnect.service
}

if ! systemctl is-active --quiet botguincho-android-emulator.service; then
  restart_all
  exit 0
fi

if ! systemctl is-active --quiet botguincho-gconnect.service; then
  systemctl restart botguincho-gconnect.service
  exit 0
fi

SERIAL="\$(timeout 8s "$ADB_BIN" devices | awk 'NR>1 && \$2=="device" {print \$1; exit}')"
if [ -z "\$SERIAL" ]; then
  echo "[watchdog] ADB sem Android conectado"
  restart_all
  exit 0
fi

BOOT="\$(timeout 8s "$ADB_BIN" -s "\$SERIAL" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r' || true)"
if [ "\$BOOT" != "1" ]; then
  echo "[watchdog] Android não concluiu boot"
  restart_all
  exit 0
fi

if [ ! -f "\$HEARTBEAT" ]; then
  echo "[watchdog] heartbeat ausente; reiniciando agente"
  systemctl restart botguincho-gconnect.service
  exit 0
fi

NOW=\$(date +%s)
MOD=\$(stat -c %Y "\$HEARTBEAT" 2>/dev/null || echo 0)
AGE=\$((NOW-MOD))
if [ "\$AGE" -gt "\$MAX_AGE" ]; then
  echo "[watchdog] heartbeat desatualizado: \${AGE}s"
  restart_all
  exit 0
fi

echo "[watchdog] OK heartbeat=\${AGE}s"
EOF
chmod 755 "$WATCHDOG_SCRIPT"

cat > "$WATCHDOG_SERVICE" <<EOF
[Unit]
Description=Bot Guincho - Watchdog GConnect
After=botguincho-android-emulator.service botguincho-gconnect.service

[Service]
Type=oneshot
User=root
ExecStart=$WATCHDOG_SCRIPT
EOF

cat > "$WATCHDOG_TIMER" <<EOF
[Unit]
Description=Bot Guincho - Verifica GConnect a cada minuto

[Timer]
OnBootSec=90
OnUnitActiveSec=60
AccuracySec=10
Persistent=true
Unit=botguincho-gconnect-watchdog.service

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable botguincho-android-emulator.service botguincho-gconnect.service botguincho-gconnect-watchdog.timer >/dev/null

# Encerra emuladores existentes de forma explícita para garantir uma única instância.
while read -r SERIAL STATE; do
  if [[ "$SERIAL" == emulator-* && "$STATE" == "device" ]]; then
    echo "Encerrando Android existente: $SERIAL"
    sudo -u "$RUN_USER" env HOME="$RUN_HOME" PATH="$(dirname "$ADB_BIN"):$PATH" "$ADB_BIN" -s "$SERIAL" emu kill >/dev/null 2>&1 || true
  fi
done < <(sudo -u "$RUN_USER" env HOME="$RUN_HOME" PATH="$(dirname "$ADB_BIN"):$PATH" "$ADB_BIN" devices | tail -n +2)
sleep 5

systemctl restart botguincho-android-emulator.service

echo "Aguardando Android iniciar..."
READY=0
ACTIVE_SERIAL=""
for i in $(seq 1 90); do
  ACTIVE_SERIAL="$(sudo -u "$RUN_USER" env HOME="$RUN_HOME" PATH="$(dirname "$ADB_BIN"):$PATH" "$ADB_BIN" devices | awk 'NR>1 && $2=="device" && $1 ~ /^emulator-/ {print $1; exit}')"
  if [ -n "$ACTIVE_SERIAL" ]; then
    BOOT="$(timeout 5s sudo -u "$RUN_USER" env HOME="$RUN_HOME" PATH="$(dirname "$ADB_BIN"):$PATH" "$ADB_BIN" -s "$ACTIVE_SERIAL" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r' || true)"
    if [ "$BOOT" = "1" ]; then READY=1; break; fi
  fi
  sleep 2
done

if [ "$READY" != "1" ]; then
  echo "Android não concluiu o boot a tempo."
  journalctl -u botguincho-android-emulator.service -n 80 --no-pager || true
  exit 6
fi

# Fixa explicitamente o serial que acabou de iniciar para evitar ambiguidade do ADB.
if grep -q '^GCONNECT_ADB_SERIAL=' "$ENV_FILE"; then
  sed -i "s/^GCONNECT_ADB_SERIAL=.*/GCONNECT_ADB_SERIAL=$ACTIVE_SERIAL/" "$ENV_FILE"
else
  echo "GCONNECT_ADB_SERIAL=$ACTIVE_SERIAL" >> "$ENV_FILE"
fi

if ! sudo -u "$RUN_USER" env HOME="$RUN_HOME" PATH="$(dirname "$ADB_BIN"):$PATH" "$ADB_BIN" -s "$ACTIVE_SERIAL" shell pm list packages | grep -q '^package:br\.com\.getrak\.gconnect$'; then
  echo "GConnect não está instalado no AVD '$AVD_NAME'."
  echo "Use o AVD gconnect-playstore, que contém o aplicativo instalado."
  exit 7
fi

rm -f "$HEARTBEAT_FILE"
systemctl restart botguincho-gconnect.service
systemctl restart botguincho-gconnect-watchdog.timer
sleep 12

echo
echo "=== Android ==="
systemctl --no-pager --full status botguincho-android-emulator.service | head -20 || true
echo
echo "=== Agente GConnect ==="
systemctl --no-pager --full status botguincho-gconnect.service | head -25 || true
echo
echo "=== Watchdog ==="
systemctl --no-pager --full status botguincho-gconnect-watchdog.timer | head -20 || true
echo
echo "=== Últimos eventos ==="
journalctl -u botguincho-gconnect.service -n 20 --no-pager || true

echo
echo "Pronto. Serial fixado em $ACTIVE_SERIAL. O agente tem auto-recuperação e o watchdog reinicia Android + agente se ficar mais de 2 minutos sem leitura."