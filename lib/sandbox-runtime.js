import { Sandbox } from '@vercel/sandbox';

const SANDBOX_NAME = 'botguincho-wa-vercel-v1';
const REPO_URL = 'https://github.com/Vitorgutierrezzxcv/botguincho.git';
const WORKER_PORT = 3001;
const SESSION_TIMEOUT_MS = 40 * 60 * 1000;
const SNAPSHOT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PROD_URL = 'https://botguincho.vercel.app';

let inflight = null;

function shellQuote(value) {
  return `'${String(value ?? '').replace(/'/g, `'"'"'`)}'`;
}

async function startWorker(sandbox) {
  const oidc = process.env.VERCEL_OIDC_TOKEN || '';
  const script = [
    'cd /vercel/sandbox',
    "if [ ! -f .botguincho-secret ]; then openssl rand -hex 32 > .botguincho-secret; chmod 600 .botguincho-secret; fi",
    "pkill -f 'node tools/admin-platform.mjs' >/dev/null 2>&1 || true",
    `export BOTGUINCHO_DATA_DIR=/vercel/sandbox/.botguincho-data`,
    `export BOTGUINCHO_PLATFORM_PORT=${WORKER_PORT}`,
    `export OPENAI_API_KEY=${shellQuote(oidc)}`,
    'export OPENAI_BASE_URL=https://ai-gateway.vercel.sh/v1',
    'export OPENAI_MODEL=openai/gpt-5-mini',
    `export BOTGUINCHO_VERCEL_URL=${PROD_URL}`,
    'exec node tools/admin-platform.mjs',
  ].join(' && ');

  await sandbox.runCommand({
    cmd: 'bash',
    args: ['-lc', script],
    detached: true,
  });
}

async function workerResponding(sandbox) {
  const base = sandbox.domain(WORKER_PORT);
  try {
    const response = await fetch(`${base}/api/status`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForWorker(sandbox) {
  const base = sandbox.domain(WORKER_PORT);
  for (let i = 0; i < 24; i += 1) {
    try {
      const response = await fetch(`${base}/api/status`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(4000),
      });
      if (response.ok) return base;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('O worker do WhatsApp não ficou pronto a tempo.');
}

async function createOrResumeSandbox() {
  const sandbox = await Sandbox.getOrCreate({
    name: SANDBOX_NAME,
    source: { type: 'git', url: REPO_URL, revision: 'main', depth: 1 },
    runtime: 'node24',
    resources: { vcpus: 2 },
    ports: [WORKER_PORT],
    timeout: SESSION_TIMEOUT_MS,
    persistent: true,
    snapshotExpiration: SNAPSHOT_TTL_MS,
    keepLastSnapshots: { count: 1, expiration: SNAPSHOT_TTL_MS },
    onCreate: async (sbx) => {
      const install = await sbx.runCommand({
        cmd: 'npm',
        args: ['install', '--no-audit', '--no-fund'],
      });
      if (install.exitCode !== 0) {
        throw new Error(`Falha ao instalar dependências no worker: ${await install.stderr()}`);
      }
      await sbx.runCommand({
        cmd: 'bash',
        args: ['-lc', "openssl rand -hex 32 > .botguincho-secret && chmod 600 .botguincho-secret"],
      });
      await startWorker(sbx);
    },
    onResume: async (sbx) => {
      await startWorker(sbx);
    },
  });

  try {
    await sandbox.update({ timeout: SESSION_TIMEOUT_MS, ports: [WORKER_PORT] });
  } catch {}

  if (!(await workerResponding(sandbox))) {
    await startWorker(sandbox);
  }

  const baseUrl = await waitForWorker(sandbox);
  return { sandbox, baseUrl };
}

export async function ensureSandbox() {
  if (!inflight) {
    inflight = createOrResumeSandbox().finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

export async function proxyWorker(req, res, internalPath) {
  try {
    const { baseUrl } = await ensureSandbox();
    const headers = {};
    const contentType = req.headers['content-type'];
    if (contentType) headers['content-type'] = contentType;

    let body;
    if (!['GET', 'HEAD'].includes(req.method)) {
      if (req.body == null) body = undefined;
      else if (Buffer.isBuffer(req.body)) body = req.body;
      else if (typeof req.body === 'string') body = req.body;
      else body = JSON.stringify(req.body);
    }

    const response = await fetch(`${baseUrl}${internalPath}`, {
      method: req.method,
      headers,
      body,
      cache: 'no-store',
      signal: AbortSignal.timeout(20000),
    });

    const responseType = response.headers.get('content-type');
    if (responseType) res.setHeader('content-type', responseType);
    res.setHeader('cache-control', 'no-store');
    const bytes = Buffer.from(await response.arrayBuffer());
    res.status(response.status).send(bytes);
  } catch (error) {
    res.status(503).json({
      error: 'worker_unavailable',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function sandboxDiagnostics() {
  try {
    const { sandbox, baseUrl } = await ensureSandbox();
    return {
      ok: true,
      sandbox: sandbox.name,
      baseUrl,
      expiresAt: sandbox.expiresAt ?? null,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
