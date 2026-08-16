import { Sandbox } from '@vercel/sandbox';
import { getWorkerStatus, requestCredential, requestTenant } from '../../lib/sandbox-runtime.js';

const SANDBOX_NAME = 'botguincho-wa-vercel-v12';
const REPO_URL = 'https://github.com/Vitorgutierrezzxcv/botguincho.git';
const WORKER_RAW_URL = 'https://raw.githubusercontent.com/Vitorgutierrezzxcv/botguincho/main/tools/vercel-whatsapp-worker.mjs';
const PORT = 3001;

async function quickRecover(credential = '') {
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

  const health = await sandbox.runCommand({
    cmd: 'node',
    args: ['-e', `fetch('http://127.0.0.1:${PORT}/api/status').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))`],
    signal: AbortSignal.timeout(3500),
  }).catch(() => null);

  if (health?.exitCode === 0) return;

  const restoreScript = `
    const fs = require('fs');
    const path = require('path');
    fetch(${JSON.stringify(WORKER_RAW_URL)}, { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const target = '/vercel/sandbox/tools/vercel-whatsapp-worker.mjs';
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, await r.text());
      })
      .catch((e) => { console.error(e); process.exit(1); });
  `;

  await sandbox.runCommand({
    cmd: 'node',
    args: ['-e', restoreScript],
    signal: AbortSignal.timeout(10000),
  });

  await sandbox.runCommand({
    cmd: 'bash',
    args: ['-lc', [
      "PIDS=$(ps -eo pid=,comm=,args= | awk '$2 == \"node\" && index($0, \"tools/vercel-whatsapp-worker.mjs\") {print $1}')",
      '[ -z "$PIDS" ] || kill -9 $PIDS >/dev/null 2>&1 || true',
      "pkill -9 -f 'session-[c]liente-teste' >/dev/null 2>&1 || true",
      'rm -rf /vercel/sandbox/.whatsapp-worker-lock',
    ].join('\n')],
    signal: AbortSignal.timeout(5000),
  }).catch(() => undefined);

  await sandbox.runCommand({
    cmd: 'bash',
    args: ['-lc', [
      'cd /vercel/sandbox',
      'LOCK=/vercel/sandbox/.whatsapp-worker-lock',
      'mkdir "$LOCK" 2>/dev/null || exit 0',
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

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  res.setHeader('cache-control', 'no-store');

  const tenant = requestTenant(req);
  const credential = requestCredential(req, tenant);

  if (tenant === 'cliente-teste') {
    try {
      await quickRecover(credential);
    } catch (error) {
      console.error('Recuperação rápida do worker legado falhou:', error);
    }
  }

  const status = await getWorkerStatus(credential, tenant);
  return res.status(200).json(status);
}
