from pathlib import Path

repo = Path('.')
worker = repo/'tools/vercel-whatsapp-worker.mjs'
reload = repo/'api/worker/reload.js'
watchdog = repo/'.github/workflows/production-watchdog.yml'

# Worker: graceful shutdown
s = worker.read_text()
needle = "let lastWhatsappRecoveryAt = 0;\n"
if "async function gracefulShutdown" not in s:
    s = s.replace(needle, needle + "let shuttingDown = false;\n")
    marker = "app.post('/api/internal/credential', (req, res) => {"
    block = r'''async function gracefulShutdown(signal = 'shutdown') {
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

'''
    if marker not in s:
        raise SystemExit('worker marker not found')
    s = s.replace(marker, block + marker)
worker.write_text(s)

# Reload: TERM first, KILL only remaining processes
s = reload.read_text()
old = '''        "WPIDS=$(ps -eo pid=,comm=,args= | awk '$2 == \\\"node\\\" && index($0, \\\"tools/vercel-whatsapp-worker.mjs\\\") {print $1}')",
        '[ -z "$WPIDS" ] || kill -9 $WPIDS >/dev/null 2>&1 || true',
        "pkill -9 -f 'session-[c]liente-teste' >/dev/null 2>&1 || true",
        'rm -rf /vercel/sandbox/.whatsapp-worker-lock',
        'sleep 2','''
new = '''        "WPIDS=$(ps -eo pid=,comm=,args= | awk '$2 == \\\"node\\\" && index($0, \\\"tools/vercel-whatsapp-worker.mjs\\\") {print $1}')",
        '[ -z "$WPIDS" ] || kill -TERM $WPIDS >/dev/null 2>&1 || true',
        'for i in 1 2 3 4 5 6 7 8 9 10; do pgrep -f "node tools/vercel-whatsapp-worker.mjs" >/dev/null 2>&1 || break; sleep 1; done',
        "WPIDS=$(ps -eo pid=,comm=,args= | awk '$2 == \\\"node\\\" && index($0, \\\"tools/vercel-whatsapp-worker.mjs\\\") {print $1}')",
        '[ -z "$WPIDS" ] || kill -9 $WPIDS >/dev/null 2>&1 || true',
        "pkill -TERM -f 'session-[c]liente-teste' >/dev/null 2>&1 || true",
        'sleep 2',
        "pkill -9 -f 'session-[c]liente-teste' >/dev/null 2>&1 || true",
        'rm -rf /vercel/sandbox/.whatsapp-worker-lock',
        'sleep 1','''
count = s.count(old)
if count < 1:
    raise SystemExit(f'reload stop block not found: {count}')
s = s.replace(old, new)
reload.write_text(s)

# Watchdog: record QR status and do not reload it in a loop
s = watchdog.read_text()
if 'wa_status=' not in s:
    s = s.replace("          echo \"wa_ok=$WA_OK\" >> \"$GITHUB_OUTPUT\"\n", "          WA_STATUS=$(jq -r '.checks.whatsapp.status // \"unknown\"' /tmp/health.json)\n          echo \"wa_ok=$WA_OK\" >> \"$GITHUB_OUTPUT\"\n          echo \"wa_status=$WA_STATUS\" >> \"$GITHUB_OUTPUT\"\n")
s = s.replace("        if: steps.health.outputs.wa_ok != 'true'\n", "        if: steps.health.outputs.wa_ok != 'true' && steps.health.outputs.wa_status != 'qr'\n")
watchdog.write_text(s)

print('hardening prepared')
