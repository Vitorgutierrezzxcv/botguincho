#!/usr/bin/env bash
set -Eeuo pipefail
if [ "$(id -u)" -ne 0 ]; then
  echo "Execute como root: sudo bash ops/recover-gconnect.sh"
  exit 1
fi
AGENT=botguincho-gconnect.service
EMULATOR=botguincho-android-emulator.service
TIMER=botguincho-gconnect-watchdog.timer
for unit in "$AGENT" "$EMULATOR" "$TIMER"; do
  if ! systemctl cat "$unit" >/dev/null 2>&1; then
    echo "Unidade $unit nao encontrada."
    exit 2
  fi
done
systemctl daemon-reload
systemctl enable "$AGENT" "$EMULATOR" "$TIMER" >/dev/null
systemctl restart "$EMULATOR"
echo "Aguardando Android/ADB..."
sleep 20
systemctl restart "$AGENT"
systemctl restart "$TIMER"
sleep 8
echo "=== Servicos ==="
systemctl is-active "$EMULATOR" "$AGENT" "$TIMER"
echo "=== Watchdog ==="
systemctl --no-pager --full status "$TIMER" | head -20 || true
echo "=== Agente ==="
journalctl -u "$AGENT" -n 35 --no-pager || true
