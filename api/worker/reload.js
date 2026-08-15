import { Sandbox } from '@vercel/sandbox';
import { applyWwebjsPatch, requestCredential } from '../../lib/sandbox-runtime.js';

const REPO = 'Vitorgutierrezzxcv/botguincho';
const SANDBOX_NAME = 'botguincho-wa-vercel-v12';
const REPO_URL = 'https://github.com/Vitorgutierrezzxcv/botguincho.git';
const RAW_ROOT = 'https://raw.githubusercontent.com/Vitorgutierrezzxcv/botguincho';
const PORT = 3001;

async function isGitHubActionsToken(req) {
  const auth = String(req.headers.authorization || '');
  if (!auth.startsWith('Bearer ')) return false;
  try {
    const response = await fetch('https://api.github.com/installation/repositories?per_page=100', {
      headers: {
        authorization: auth,
        accept: 'application/vnd.github+json',
        'user-agent': 'botguincho-worker-reloader',
        'x-github-api-version': '2022-11-28',
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return false;
    const data = await response.json();
    return Array.isArray(data.repositories) && data.repositories.some((repo) => repo.full_name === REPO);
  } catch {
    return false;
  }
}

async function commandOutput(result) {
  try { return (await result.stdout()).trim(); } catch { return ''; }
}

async function workerCount(sandbox) {
  const result = await sandbox.runCommand({
    cmd: 'bash',
    args: ['-lc', "ps -eo comm=,args= | awk '$1 == \"node\" && index($0, \"tools/vercel-whatsapp-worker.mjs\") {n++} END {print n+0}'"],
    signal: AbortSignal.timeout(5000),
  });
  const count = Number(await commandOutput(result));
  return Number.isFinite(count) ? count : -1;
}

async function readWorkerLog(sandbox) {
  const result = await sandbox.runCommand({
    cmd: 'bash',
    args: ['-lc', 'tail -220 /vercel/sandbox/worker.log 2>/dev/null || true'],
    signal: AbortSignal.timeout(5000),
  });
  return commandOutput(result);
}

async function launchWorker(sandbox, credential) {
  await sandbox.runCommand({
    cmd: 'bash',
    args: ['-lc', [
      'LOCK=/vercel/sandbox/.whatsapp-worker-lock',
      'mkdir "$LOCK" 2>/dev/null || exit 0',
      'echo $$ > "$LOCK/launcher-pid"',
      'rm -f /vercel/sandbox/worker.log',
      'node tools/vercel-whatsapp-worker.mjs >> /vercel/sandbox/worker.log 2>&1',
      'CODE=$?',
      'rm -rf "$LOCK"',
      'exit $CODE',
    ].join('\n')],
    env: {
      BOTGUINCHO_DATA_DIR: '/vercel/sandbox/.botguincho-data',
      BOTGUINCHO_PLATFORM_PORT: String(PORT),
      WHATSAPP_CLIENT_ID: 'cliente-teste',
      PUPPETEER_SKIP_DOWNLOAD: 'true',
      OPENAI_API_KEY: credential || '',
      OPENAI_BASE_URL: 'https://ai-gateway.vercel.sh/v1',
      OPENAI_MODEL: 'openai/gpt-5.4-mini',
      VERCEL: '1',
    },
    detached: true,
  });
}

async function syncFiles(sandbox, sourceRef) {
  const relative = 'tools/vercel-whatsapp-worker.mjs';
  const url = `${RAW_ROOT}/${sourceRef}/${relative}`;
  const script = [
    'set -euo pipefail',
    `TARGET='/vercel/sandbox/${relative}'`,
    'TMP="${TARGET}.tmp.$$"',
    'trap \'rm -f "$TMP"\' EXIT',
    'mkdir -p "$(dirname "$TARGET")"',
    `curl -fsSL --retry 3 --retry-delay 1 --connect-timeout 10 --max-time 30 -H 'Cache-Control: no-cache' '${url}' -o "$TMP"`,
    'if [ -f "$TARGET" ] && cmp -s "$TARGET" "$TMP"; then',
    `  echo '${relative}:same'`,
    'else',
    '  mv "$TMP" "$TARGET"',
    `  echo '${relative}:updated'`,
    'fi',
  ].join('\n');

  const result = await sandbox.runCommand({
    cmd: 'bash',
    args: ['-lc', script],
    signal: AbortSignal.timeout(45000),
  });
  if (result.exitCode !== 0) {
    let stderr = '';
    let stdout = '';
    try { stderr = await result.stderr(); } catch {}
    try { stdout = await result.stdout(); } catch {}
    throw new Error(`Falha ao atualizar arquivos do worker: ${stderr || stdout || result.exitCode}`);
  }
  return commandOutput(result);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  res.setHeader('cache-control', 'no-store');
  if (!(await isGitHubActionsToken(req))) return res.status(401).json({ error: 'unauthorized' });

  try {
    const credential = requestCredential(req);
    const requestedRef = String(req.headers['x-botguincho-source-ref'] || '').trim();
    const sourceRef = /^[0-9a-f]{40}$/i.test(requestedRef) ? requestedRef : 'main';

    const sandbox = await Sandbox.getOrCreate({
      name: SANDBOX_NAME,
      source: { type: 'git', url: REPO_URL, depth: 1 },
      runtime: 'node22',
      resources: { vcpus: 2 },
      timeout: 40 * 60 * 1000,
      persistent: true,
      snapshotExpiration: 7 * 24 * 60 * 60 * 1000,
      keepLastSnapshots: { count: 1 },
      ports: [PORT],
      networkPolicy: 'allow-all',
      resume: true,
    });

    const sourceState = await syncFiles(sandbox, sourceRef);
    const patchState = await applyWwebjsPatch(sandbox);

    await sandbox.runCommand({
      cmd: 'bash',
      args: ['-lc', [
        "WPIDS=$(ps -eo pid=,comm=,args= | awk '$2 == \"node\" && index($0, \"tools/vercel-whatsapp-worker.mjs\") {print $1}')",
        '[ -z "$WPIDS" ] || kill -9 $WPIDS >/dev/null 2>&1 || true',
        "pkill -9 -f 'session-[c]liente-teste' >/dev/null 2>&1 || true",
        'rm -rf /vercel/sandbox/.whatsapp-worker-lock',
        'sleep 2',
      ].join('\n')],
      signal: AbortSignal.timeout(10000),
    });

    await launchWorker(sandbox, credential);

    let status = null;
    for (let i = 0; i < 100; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      try {
        const response = await fetch(`${sandbox.domain(PORT)}/api/status`, { cache: 'no-store', signal: AbortSignal.timeout(3500) });
        if (response.ok) {
          status = await response.json();
          if (['pronto', 'qr'].includes(status?.whatsapp?.status)) break;
        }
      } catch {}
    }
    if (!status) throw new Error('Worker reiniciado, mas ainda não respondeu ao status.');

    let workers = await workerCount(sandbox);
    if (workers > 1) {
      await sandbox.runCommand({
        cmd: 'bash',
        args: ['-lc', [
          "PIDS=$(ps -eo pid=,comm=,args= | awk '$2 == \"node\" && index($0, \"tools/vercel-whatsapp-worker.mjs\") {print $1}')",
          '[ -z "$PIDS" ] || kill -9 $PIDS >/dev/null 2>&1 || true',
          "pkill -9 -f 'session-[c]liente-teste' >/dev/null 2>&1 || true",
          'rm -rf /vercel/sandbox/.whatsapp-worker-lock',
          'sleep 2',
        ].join('\n')],
        signal: AbortSignal.timeout(10000),
      });
      await launchWorker(sandbox, credential);
      for (let i = 0; i < 60; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        try {
          const response = await fetch(`${sandbox.domain(PORT)}/api/status`, { cache: 'no-store', signal: AbortSignal.timeout(3500) });
          if (response.ok) {
            status = await response.json();
            if (['pronto', 'qr'].includes(status?.whatsapp?.status)) break;
          }
        } catch {}
      }
      workers = await workerCount(sandbox);
    }
    if (workers !== 1) throw new Error(`Esperado exatamente 1 worker, encontrado ${workers}.`);

    let groups = [];
    if (status?.whatsapp?.status === 'pronto') {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const response = await fetch(`${sandbox.domain(PORT)}/api/groups`, { cache: 'no-store', signal: AbortSignal.timeout(30000) });
          if (response.ok) groups = (await response.json()).groups || [];
        } catch {}
        if (groups.length) break;
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }

    return res.status(200).json({
      ok: true,
      sourceRef,
      sourceState,
      patchState,
      workerProcessCount: workers,
      whatsappStatus: status?.whatsapp?.status,
      trackerAvailable: Boolean(status?.tracker),
      groupsFound: groups.length,
      groups: groups.slice(0, 100),
      sessionPreserved: status?.whatsapp?.status !== 'qr',
      workerLog: await readWorkerLog(sandbox),
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}
