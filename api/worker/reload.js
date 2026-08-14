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

    await sandbox.runCommand({
      cmd: 'bash',
      args: ['-lc', "pkill -f '[n]ode tools/vercel-whatsapp-worker.mjs' >/dev/null 2>&1 || true; rm -rf /vercel/sandbox/.whatsapp-worker-lock"],
      signal: AbortSignal.timeout(8000),
    });

    await new Promise((resolve) => setTimeout(resolve, 700));

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
    for (let i = 0; i < 24; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      try {
        const response = await fetch(`${sandbox.domain(PORT)}/api/status`, {
          cache: 'no-store',
          signal: AbortSignal.timeout(3500),
        });
        if (response.ok) {
          status = await response.json();
          if (['pronto', 'qr', 'autenticado'].includes(status?.whatsapp?.status)) break;
        }
      } catch {}
    }

    if (!status) throw new Error('Worker reiniciado, mas ainda não respondeu ao status.');

    let groups = [];
    if (status?.whatsapp?.status === 'pronto') {
      try {
        const response = await fetch(`${sandbox.domain(PORT)}/api/groups`, {
          cache: 'no-store',
          signal: AbortSignal.timeout(15000),
        });
        if (response.ok) groups = (await response.json()).groups || [];
      } catch {}
    }

    return res.status(200).json({
      ok: true,
      sourceState,
      whatsappStatus: status?.whatsapp?.status,
      groupsFound: groups.length,
      groups: groups.slice(0, 100),
      sessionPreserved: status?.whatsapp?.status !== 'qr',
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
