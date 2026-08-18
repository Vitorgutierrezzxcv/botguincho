from pathlib import Path

repo = Path('.')
worker = repo/'tools/vercel-whatsapp-worker.mjs'
reload = repo/'api/worker/reload.js'
watchdog = repo/'.github/workflows/production-watchdog.yml'

# Worker: graceful shutdown
s = worker.read_text()
needle = "let lastWhatsappRecoveryAt = 0;\n"
if "async function gracefulShutdown" not in s:
    if needle not in s:
        raise SystemExit('worker state marker not found')
    s = s.replace(needle, needle + "let shuttingDown = false;\n", 1)
    marker = "app.post('/api/internal/credential', (req, res) => {"
    block = """async function gracefulShutdown(signal = 'shutdown') {
  if (shuttingDown) return;
  shuttingDown = true;
  if (whatsappRecoveryTimer) {
    clearTimeout(whatsappRecoveryTimer);
    whatsappRecoveryTimer = null;
  }
  waStatus = 'encerrando';
  logEvent('system', `Encerramento gracioso solicitado (${signal}).`);
  const current = waClient;
  waClient = null;
  if (current) {
    await Promise.race([
      current.destroy().catch((error) => logEvent('warning', 'Falha ao encerrar WhatsApp graciosamente.', { error: String(error) })),
      new Promise((resolve) => setTimeout(resolve, 8000)),
    ]);
  }
  await new Promise((resolve) => setTimeout(resolve, 800));
  process.exit(0);
}

process.once('SIGTERM', () => { void gracefulShutdown('SIGTERM'); });
process.once('SIGINT', () => { void gracefulShutdown('SIGINT'); });

"""
    if marker not in s:
        raise SystemExit('worker endpoint marker not found')
    s = s.replace(marker, block + marker, 1)
worker.write_text(s)

# Reload: replace hard-kill lines with TERM + grace period + KILL fallback.
s = reload.read_text()
if 'kill -TERM $WPIDS' not in s:
    old = "        '[ -z \"$WPIDS\" ] || kill -9 $WPIDS >/dev/null 2>&1 || true',\n"
    new = "        '[ -z \"$WPIDS\" ] || kill -TERM $WPIDS >/dev/null 2>&1 || true',\n        'for i in 1 2 3 4 5 6 7 8 9 10; do pgrep -f \"node tools/vercel-whatsapp-worker.mjs\" >/dev/null 2>&1 || break; sleep 1; done',\n        \"WPIDS=$(ps -eo pid=,comm=,args= | awk '$2 == \\\"node\\\" && index($0, \\\"tools/vercel-whatsapp-worker.mjs\\\") {print $1}')\",\n        '[ -z \"$WPIDS\" ] || kill -9 $WPIDS >/dev/null 2>&1 || true',\n"
    if old not in s:
        raise SystemExit('WPIDS hard-kill line not found')
    s = s.replace(old, new, 1)

if 'kill -TERM $PIDS' not in s:
    old = "          '[ -z \"$PIDS\" ] || kill -9 $PIDS >/dev/null 2>&1 || true',\n"
    new = "          '[ -z \"$PIDS\" ] || kill -TERM $PIDS >/dev/null 2>&1 || true',\n          'for i in 1 2 3 4 5 6 7 8; do pgrep -f \"node tools/vercel-whatsapp-worker.mjs\" >/dev/null 2>&1 || break; sleep 1; done',\n          \"PIDS=$(ps -eo pid=,comm=,args= | awk '$2 == \\\"node\\\" && index($0, \\\"tools/vercel-whatsapp-worker.mjs\\\") {print $1}')\",\n          '[ -z \"$PIDS\" ] || kill -9 $PIDS >/dev/null 2>&1 || true',\n"
    if old not in s:
        raise SystemExit('PIDS hard-kill line not found')
    s = s.replace(old, new, 1)

# Chromium leftovers: TERM before KILL, preserving KILL only as last resort.
old = "        \"pkill -9 -f 'session-[c]liente-teste' >/dev/null 2>&1 || true\",\n"
new = "        \"pkill -TERM -f 'session-[c]liente-teste' >/dev/null 2>&1 || true\",\n        'sleep 2',\n        \"pkill -9 -f 'session-[c]liente-teste' >/dev/null 2>&1 || true\",\n"
if "pkill -TERM -f 'session-[c]liente-teste'" not in s:
    if old not in s:
        raise SystemExit('first chromium hard-kill line not found')
    s = s.replace(old, new, 1)

old2 = "          \"pkill -9 -f 'session-[c]liente-teste' >/dev/null 2>&1 || true\",\n"
new2 = "          \"pkill -TERM -f 'session-[c]liente-teste' >/dev/null 2>&1 || true\",\n          'sleep 2',\n          \"pkill -9 -f 'session-[c]liente-teste' >/dev/null 2>&1 || true\",\n"
if s.count("pkill -TERM -f 'session-[c]liente-teste'") < 2:
    if old2 not in s:
        raise SystemExit('second chromium hard-kill line not found')
    s = s.replace(old2, new2, 1)
reload.write_text(s)

# Watchdog: QR requires human scan; never loop reloads while QR is valid.
s = watchdog.read_text()
if 'wa_status=' not in s:
    target = "          echo \"wa_ok=$WA_OK\" >> \"$GITHUB_OUTPUT\"\n"
    repl = "          WA_STATUS=$(jq -r '.checks.whatsapp.status // \"unknown\"' /tmp/health.json)\n          echo \"wa_ok=$WA_OK\" >> \"$GITHUB_OUTPUT\"\n          echo \"wa_status=$WA_STATUS\" >> \"$GITHUB_OUTPUT\"\n"
    if target not in s:
        raise SystemExit('watchdog output marker not found')
    s = s.replace(target, repl, 1)
s = s.replace("        if: steps.health.outputs.wa_ok != 'true'\n", "        if: steps.health.outputs.wa_ok != 'true' && steps.health.outputs.wa_status != 'qr'\n", 1)
watchdog.write_text(s)

print('hardening prepared')
