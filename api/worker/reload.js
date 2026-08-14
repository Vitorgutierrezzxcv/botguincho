import { Sandbox } from '@vercel/sandbox';
import { requestCredential } from '../../lib/sandbox-runtime.js';

const REPO = 'Vitorgutierrezzxcv/botguincho';
const SANDBOX_NAME = 'botguincho-wa-vercel-v12';
const REPO_URL = 'https://github.com/Vitorgutierrezzxcv/botguincho.git';
const RAW_WORKER_URL = 'https://raw.githubusercontent.com/Vitorgutierrezzxcv/botguincho/main/tools/vercel-whatsapp-worker.mjs';
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

async function processCounts(sandbox) {
  const result = await sandbox.runCommand({
    cmd: 'bash',
    args: ['-lc', [
      "W=$(ps -eo comm=,args= | awk '$1 == \"node\" && index($0, \"tools/vercel-whatsapp-worker.mjs\") {n++} END {print n+0}')",
      "C=$(ps -eo comm=,args= | awk '$1 == \"chromium\" && index($0, \"session-cliente-teste\") {n++} END {print n+0}')",
      'echo "$W $C"',
    ].join('\n')],
    signal: AbortSignal.timeout(5000),
  });
  const output = await commandOutput(result);
  const [workers, chromiums] = output.split(/\s+/).map(Number);
  return {
    workers: Number.isFinite(workers) ? workers : -1,
    chromiums: Number.isFinite(chromiums) ? chromiums : -1,
    raw: output,
  };
}

async function readWorkerLog(sandbox) {
  const result = await sandbox.runCommand({
    cmd: 'bash',
    args: ['-lc', 'tail -120 /vercel/sandbox/worker.log 2>/dev/null || true'],
    signal: AbortSignal.timeout(5000),
  });
  return commandOutput(result);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  res.setHeader('cache-control', 'no-store');

  if (!(await isGitHubActionsToken(req))) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    const credential = requestCredential(req);
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

    const syncScript = `
      const fs = require('fs');
      const file = '/vercel/sandbox/tools/vercel-whatsapp-worker.mjs';
      fetch(${JSON.stringify(RAW_WORKER_URL)}, { cache: 'no-store' })
        .then(async (r) => {
          if (!r.ok) throw new Error('download HTTP ' + r.status);
          const next = await r.text();
          const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
          if (current === next) { process.stdout.write('same'); return; }
          fs.writeFileSync(file + '.tmp', next);
          fs.renameSync(file + '.tmp', file);
          process.stdout.write('updated');
        })
        .catch((e) => { console.error(e); process.exit(1); });
    `;
    const synced = await sandbox.runCommand({
      cmd: 'node',
      args: ['-e', syncScript],
      signal: AbortSignal.timeout(20000),
    });
    if (synced.exitCode !== 0) {
      let stderr = '';
      try { stderr = await synced.stderr(); } catch {}
      throw new Error(`Falha ao atualizar worker: ${stderr || synced.exitCode}`);
    }
    const sourceState = await commandOutput(synced);

    // Encerra Node e Chromium vinculados especificamente ao Bot Guincho.
    // Não apaga nenhum arquivo da sessão.
    const stopped = await sandbox.runCommand({
      cmd: 'bash',
      args: ['-lc', [
        "WPIDS=$(ps -eo pid=,comm=,args= | awk '$2 == \"node\" && index($0, \"tools/vercel-whatsapp-worker.mjs\") {print $1}')",
        "CPIDS=$(ps -eo pid=,comm=,args= | awk '$2 == \"chromium\" && index($0, \"session-cliente-teste\") {print $1}')",
        'echo "workers_before=${WPIDS:-none}"',
        'echo "chromium_before=${CPIDS:-none}"',
        'ALL="$WPIDS $CPIDS"',
        'if [ -n "$(echo $ALL | xargs)" ]; then kill $ALL >/dev/null 2>&1 || true; fi',
        'sleep 3',
        "WPIDS2=$(ps -eo pid=,comm=,args= | awk '$2 == \"node\" && index($0, \"tools/vercel-whatsapp-worker.mjs\") {print $1}')",
        "CPIDS2=$(ps -eo pid=,comm=,args= | awk '$2 == \"chromium\" && index($0, \"session-cliente-teste\") {print $1}')",
        'ALL2="$WPIDS2 $CPIDS2"',
        'if [ -n "$(echo $ALL2 | xargs)" ]; then kill -9 $ALL2 >/dev/null 2>&1 || true; fi',
        'sleep 2',
        "WLEFT=$(ps -eo pid=,comm=,args= | awk '$2 == \"node\" && index($0, \"tools/vercel-whatsapp-worker.mjs\") {print $1}')",
        "CLEFT=$(ps -eo pid=,comm=,args= | awk '$2 == \"chromium\" && index($0, \"session-cliente-teste\") {print $1}')",
        'echo "workers_after=${WLEFT:-none}"',
        'echo "chromium_after=${CLEFT:-none}"',
        'rm -rf /vercel/sandbox/.whatsapp-worker-lock',
      ].join('\n')],
      signal: AbortSignal.timeout(16000),
    });
    const stopReport = await commandOutput(stopped);
    const afterStop = await processCounts(sandbox);
    if (afterStop.workers !== 0 || afterStop.chromiums !== 0) {
      throw new Error(`Processos antigos ainda ativos: workers=${afterStop.workers}, chromium=${afterStop.chromiums}, raw=${afterStop.raw}. ${stopReport}`);
    }

    await sandbox.runCommand({
      cmd: 'bash',
      args: ['-lc', [
        'LOCK=/vercel/sandbox/.whatsapp-worker-lock',
        'rm -rf "$LOCK"',
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

    let status = null;
    for (let i = 0; i < 90; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      try {
        const response = await fetch(`${sandbox.domain(PORT)}/api/status`, {
          cache: 'no-store',
          signal: AbortSignal.timeout(3500),
        });
        if (response.ok) {
          status = await response.json();
          if (['pronto', 'qr'].includes(status?.whatsapp?.status)) break;
        }
      } catch {}
    }

    if (!status) throw new Error('Worker reiniciado, mas ainda não respondeu ao status.');

    const running = await processCounts(sandbox);
    if (running.workers !== 1 || running.chromiums !== 1) {
      throw new Error(`Esperado 1 worker e 1 Chromium, encontrados workers=${running.workers}, chromium=${running.chromiums}, raw=${running.raw}.`);
    }

    let groups = [];
    if (status?.whatsapp?.status === 'pronto') {
      try {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const response = await fetch(`${sandbox.domain(PORT)}/api/groups`, {
            cache: 'no-store',
            signal: AbortSignal.timeout(25000),
          });
          if (response.ok) groups = (await response.json()).groups || [];
          if (groups.length) break;
          await new Promise((resolve) => setTimeout(resolve, 3000));
        }
      } catch {}
    }

    return res.status(200).json({
      ok: true,
      sourceState,
      stopReport,
      workerProcessCount: running.workers,
      chromiumProcessCount: running.chromiums,
      whatsappStatus: status?.whatsapp?.status,
      groupsFound: groups.length,
      groups: groups.slice(0, 100),
      sessionPreserved: status?.whatsapp?.status !== 'qr',
      workerLog: await readWorkerLog(sandbox),
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
