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

async function workerProcessCount(sandbox) {
  const result = await sandbox.runCommand({
    cmd: 'bash',
    args: ['-lc', "ps -eo comm=,args= | awk '$1 == \"node\" && $0 ~ /tools\\/vercel-whatsapp-worker\\.mjs/ {n++} END {print n+0}'"],
    signal: AbortSignal.timeout(5000),
  });
  const value = Number(await commandOutput(result));
  return Number.isFinite(value) ? value : -1;
}

async function readWorkerLog(sandbox) {
  const result = await sandbox.runCommand({
    cmd: 'bash',
    args: ['-lc', 'tail -80 /vercel/sandbox/worker.log 2>/dev/null || true'],
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

    // Atualiza apenas o código do worker. A sessão fica fora do repositório em
    // /vercel/sandbox/.botguincho-data e portanto não é apagada.
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

    // Mata de forma determinística TODOS os workers antigos. O pkill anterior
    // podia deixar um processo antigo vivo e a porta 3001 continuava servindo
    // o código anterior, mascarando a sincronização dos grupos.
    const stopped = await sandbox.runCommand({
      cmd: 'bash',
      args: ['-lc', [
        "PIDS=$(ps -eo pid=,comm=,args= | awk '$2 == \"node\" && $0 ~ /tools\\/vercel-whatsapp-worker\\.mjs/ {print $1}')",
        'echo "before=${PIDS:-none}"',
        'if [ -n "$PIDS" ]; then kill $PIDS >/dev/null 2>&1 || true; fi',
        'sleep 2',
        "PIDS2=$(ps -eo pid=,comm=,args= | awk '$2 == \"node\" && $0 ~ /tools\\/vercel-whatsapp-worker\\.mjs/ {print $1}')",
        'if [ -n "$PIDS2" ]; then kill -9 $PIDS2 >/dev/null 2>&1 || true; fi',
        'sleep 1',
        "LEFT=$(ps -eo pid=,comm=,args= | awk '$2 == \"node\" && $0 ~ /tools\\/vercel-whatsapp-worker\\.mjs/ {print $1}')",
        'echo "after=${LEFT:-none}"',
        'rm -rf /vercel/sandbox/.whatsapp-worker-lock',
      ].join('\n')],
      signal: AbortSignal.timeout(12000),
    });
    const stopReport = await commandOutput(stopped);
    const afterStopCount = await workerProcessCount(sandbox);
    if (afterStopCount !== 0) {
      throw new Error(`Ainda existem ${afterStopCount} workers antigos após a parada. ${stopReport}`);
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
    for (let i = 0; i < 45; i += 1) {
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

    const processCount = await workerProcessCount(sandbox);
    if (processCount !== 1) {
      throw new Error(`Esperado exatamente 1 worker, encontrado(s) ${processCount}.`);
    }

    let groups = [];
    if (status?.whatsapp?.status === 'pronto') {
      try {
        // Duas leituras dão tempo para o WhatsApp Web hidratar a coleção de chats
        // após a restauração da sessão.
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const response = await fetch(`${sandbox.domain(PORT)}/api/groups`, {
            cache: 'no-store',
            signal: AbortSignal.timeout(20000),
          });
          if (response.ok) groups = (await response.json()).groups || [];
          if (groups.length) break;
          await new Promise((resolve) => setTimeout(resolve, 2500));
        }
      } catch {}
    }

    return res.status(200).json({
      ok: true,
      sourceState,
      stopReport,
      workerProcessCount: processCount,
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
