import { Sandbox } from '@vercel/sandbox';

const SANDBOX_NAME = 'botguincho-wa-vercel-v5';
let repairInflight = null;

function needsBrowserRepair(message = '') {
  const text = String(message).toLowerCase();
  return text.includes('failed to launch the browser process') ||
    text.includes('error while loading shared libraries') ||
    text.includes('libnspr4.so') ||
    text.includes('libnss3.so');
}

export { needsBrowserRepair };

export async function repairBrowserDeps() {
  if (repairInflight) return repairInflight;

  repairInflight = (async () => {
    const sandbox = await Sandbox.get({ name: SANDBOX_NAME, resume: true });
    const script = [
      'set -eu',
      'exec >> /vercel/sandbox/botguincho-repair.log 2>&1',
      'echo "=== repair $(date -Iseconds) ==="',
      'LOCK=/vercel/sandbox/.botguincho-repair-lock',
      'if ! mkdir "$LOCK" 2>/dev/null; then echo "Reparo já em andamento."; exit 0; fi',
      'cleanup(){ rm -rf "$LOCK" 2>/dev/null || true; }',
      'trap cleanup EXIT INT TERM',
      'cd /vercel/sandbox/app',
      'if [ ! -f /vercel/sandbox/.chromium-deps-ready-v1 ]; then',
      '  echo "Instalando dependências Linux do Chromium."',
      '  npx playwright install-deps chromium',
      '  touch /vercel/sandbox/.chromium-deps-ready-v1',
      '  echo "Dependências do Chromium instaladas."',
      'else',
      '  echo "Dependências do Chromium já estavam instaladas."',
      'fi',
      'if [ -f /vercel/sandbox/botguincho-worker.pid ]; then',
      '  PID=$(cat /vercel/sandbox/botguincho-worker.pid 2>/dev/null || true)',
      '  if [ -n "${PID:-}" ] && kill -0 "$PID" 2>/dev/null; then',
      '    echo "Reiniciando worker antigo PID $PID."',
      '    kill "$PID" 2>/dev/null || true',
      '  fi',
      'fi',
      'echo "Reparo concluído; o próximo status reiniciará o worker."',
    ].join('\n');

    await sandbox.runCommand({
      cmd: 'bash',
      args: ['-lc', script],
      detached: true,
      signal: AbortSignal.timeout(8000),
    });

    return { started: true };
  })().finally(() => {
    repairInflight = null;
  });

  return repairInflight;
}

export async function browserRepairDiagnostics() {
  try {
    const sandbox = await Sandbox.get({ name: SANDBOX_NAME, resume: true });
    const result = await sandbox.runCommand({
      cmd: 'bash',
      args: ['-lc', 'tail -120 /vercel/sandbox/botguincho-repair.log 2>/dev/null || true'],
      signal: AbortSignal.timeout(5000),
    });
    return await result.stdout();
  } catch {
    return '';
  }
}
