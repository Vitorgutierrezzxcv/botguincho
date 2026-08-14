import { Sandbox } from '@vercel/sandbox';

const SANDBOX_NAME = 'botguincho-wa-vercel-v8';
const REPO_URL = 'https://github.com/Vitorgutierrezzxcv/botguincho.git';
const APP_DIR = '/vercel/sandbox/app';
const DATA_DIR = '/vercel/sandbox/.botguincho-data';
const PORT = 3001;
let inflight = null;
let latestCredential = '';

function quote(value) {
  return `'${String(value ?? '').replace(/'/g, `'"'"'`)}'`;
}

function rememberCredential(value) {
  const token = Array.isArray(value) ? value[0] : value;
  if (typeof token === 'string' && token.trim()) latestCredential = token.trim();
  return latestCredential;
}

export function requestCredential(req) {
  return rememberCredential(
    req?.headers?.['x-vercel-oidc-token'] ||
    process.env.VERCEL_OIDC_TOKEN ||
    process.env.AI_GATEWAY_API_KEY ||
    ''
  );
}

async function run(sandbox, command, options = {}) {
  return sandbox.runCommand({
    cmd: 'bash',
    args: ['-lc', command],
    detached: options.detached ?? false,
    signal: AbortSignal.timeout(options.timeoutMs ?? 10000),
  });
}

async function configure(sandbox) {
  await sandbox.update({
    resources: { vcpus: 2 },
    timeout: 40 * 60 * 1000,
    persistent: true,
    snapshotExpiration: 7 * 24 * 60 * 60 * 1000,
    keepLastSnapshots: { count: 1 },
    ports: [PORT],
    networkPolicy: 'allow-all',
  }, { signal: AbortSignal.timeout(10000) });
}

async function getSandbox() {
  if (!inflight) {
    inflight = Sandbox.getOrCreate({
      name: SANDBOX_NAME,
      resume: true,
      onCreate: configure,
      onResume: configure,
    }).then(async (sandbox) => {
      await configure(sandbox);
      return sandbox;
    }).finally(() => { inflight = null; });
  }
  return inflight;
}

function localHealth() {
  return `node -e "fetch('http://127.0.0.1:${PORT}/api/status').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"`;
}

async function isReady(sandbox) {
  try {
    const result = await run(sandbox, localHealth(), { timeoutMs: 5000 });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

export function defaultSettings() {
  return {
    companyName: 'Bot Guincho',
    aiEnabled: true,
    aiModel: 'openai/gpt-5-mini',
    aiInstructions: 'Você é o atendente operacional de uma empresa de guincho e assistência 24h. Responda em português do Brasil, de forma curta, natural, profissional e útil. Interprete cada mensagem considerando o histórico recente do grupo. Nunca invente disponibilidade, localização, preço, prazo ou ETA. Enquanto o GConnect não estiver disponível, quando a resposta depender desses dados, diga de forma natural que está verificando e peça somente a informação realmente necessária. Se o pedido já tiver origem, destino, tipo de veículo e situação, confirme resumidamente e prossiga sem repetir perguntas. Nunca diga que é IA, bot ou modelo de linguagem.',
    replyEveryMessage: true,
    humanTakeover: false,
  };
}

function bootstrap(credential = '') {
  const settings = quote(JSON.stringify(defaultSettings(), null, 2));
  const initialCredential = quote(credential || '');
  return [
    'set -eu',
    'exec >> /vercel/sandbox/bootstrap.log 2>&1',
    'echo "=== $(date -Iseconds) ==="',
    'LOCK=/vercel/sandbox/.start-lock',
    'if ! mkdir "$LOCK" 2>/dev/null; then',
    '  if [ -f "$LOCK/pid" ] && kill -0 "$(cat "$LOCK/pid")" 2>/dev/null; then exit 0; fi',
    '  rm -rf "$LOCK"; mkdir "$LOCK"',
    'fi',
    'echo $$ > "$LOCK/pid"',
    `if ${localHealth()}; then rm -rf "$LOCK"; exit 0; fi`,
    `mkdir -p ${DATA_DIR}/cliente-teste`,
    `if [ ! -s ${DATA_DIR}/cliente-teste/settings.json ]; then printf '%s' ${settings} > ${DATA_DIR}/cliente-teste/settings.json; fi`,
    `if [ ! -d ${APP_DIR}/.git ]; then`,
    `  rm -rf ${APP_DIR}; git clone --depth 1 --branch main ${REPO_URL} ${APP_DIR}`,
    'else',
    `  cd ${APP_DIR}; git fetch origin main --depth 1; git reset --hard origin/main`,
    'fi',
    `cd ${APP_DIR}`,
    'export PUPPETEER_SKIP_DOWNLOAD=true',
    'npm install --no-audit --no-fund --prefer-offline',
    'export VERCEL=1',
    'CHROMIUM_PATH=$(node tools/chromium-path.mjs)',
    'test -x "$CHROMIUM_PATH"',
    'export PUPPETEER_EXECUTABLE_PATH="$CHROMIUM_PATH"',
    'export LD_LIBRARY_PATH="/tmp/al2023/lib:${LD_LIBRARY_PATH:-}"',
    'export FONTCONFIG_PATH=/tmp/fonts',
    `export BOTGUINCHO_DATA_DIR=${DATA_DIR}`,
    `export BOTGUINCHO_PLATFORM_PORT=${PORT}`,
    `export OPENAI_API_KEY=${initialCredential}`,
    'export OPENAI_BASE_URL=https://ai-gateway.vercel.sh/v1',
    'export OPENAI_MODEL=openai/gpt-5-mini',
    'echo "Chromium=$CHROMIUM_PATH AI_TOKEN=${OPENAI_API_KEY:+present}"',
    'nohup node tools/vercel-whatsapp-worker.mjs >> /vercel/sandbox/worker.log 2>&1 < /dev/null &',
    'echo $! > /vercel/sandbox/worker.pid',
    `for i in $(seq 1 45); do if ${localHealth()}; then echo READY; rm -rf "$LOCK"; exit 0; fi; sleep 1; done`,
    'echo "Worker não respondeu"',
    'tail -120 /vercel/sandbox/worker.log 2>/dev/null || true',
    'rm -rf "$LOCK"',
    'exit 1',
  ].join('\n');
}

async function kick(sandbox, credential = '') {
  if (await isReady(sandbox)) return;
  try {
    await run(sandbox, bootstrap(credential), { detached: true, timeoutMs: 8000 });
  } catch {}
}

async function fetchWorker(sandbox, path, init = {}) {
  const { timeoutMs = 12000, ...fetchInit } = init;
  return fetch(`${sandbox.domain(PORT)}${path}`, {
    ...fetchInit,
    cache: 'no-store',
    signal: AbortSignal.timeout(timeoutMs),
  });
}

async function syncCredential(sandbox, credential = '') {
  const token = rememberCredential(credential);
  if (!token || !(await isReady(sandbox))) return false;
  try {
    const response = await fetchWorker(sandbox, '/api/internal/credential', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
      timeoutMs: 7000,
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function getWorkerStatus(credential = '') {
  rememberCredential(credential);
  try {
    const sandbox = await getSandbox();
    if (await isReady(sandbox)) {
      await syncCredential(sandbox, latestCredential);
      try {
        const response = await fetchWorker(sandbox, '/api/status', { timeoutMs: 7000 });
        if (response.ok) {
          return { ...(await response.json()), infrastructure: { status: 'ready', sandbox: SANDBOX_NAME } };
        }
      } catch {}
    }
    await kick(sandbox, latestCredential);
    return {
      clientId: 'cliente-teste',
      whatsapp: { status: 'iniciando', qrDataUrl: null, lastError: null },
      ai: { configured: Boolean(latestCredential), enabled: true, model: 'openai/gpt-5-mini' },
      groupsSelected: 0,
      infrastructure: { status: 'starting', sandbox: SANDBOX_NAME, message: 'Preparando WhatsApp e IA.' },
    };
  } catch (error) {
    return {
      clientId: 'cliente-teste',
      whatsapp: { status: 'erro', qrDataUrl: null, lastError: String(error) },
      ai: { configured: Boolean(latestCredential), enabled: true, model: 'openai/gpt-5-mini' },
      groupsSelected: 0,
      infrastructure: { status: 'error', message: String(error) },
    };
  }
}

function placeholder(path) {
  if (path === '/api/activity') return { activity: [], initializing: true };
  if (path === '/api/groups') return { groups: [], initializing: true };
  if (path === '/api/settings') return { ...defaultSettings(), apiKeyConfigured: Boolean(latestCredential), initializing: true };
  return { initializing: true };
}

export async function proxyWorker(req, res, internalPath) {
  res.setHeader('cache-control', 'no-store');
  const credential = requestCredential(req);
  try {
    const sandbox = await getSandbox();
    if (!(await isReady(sandbox))) {
      await kick(sandbox, credential);
      return req.method === 'GET'
        ? res.status(200).json(placeholder(internalPath))
        : res.status(425).json({ initializing: true });
    }

    await syncCredential(sandbox, credential);

    const headers = {};
    if (req.headers['content-type']) headers['content-type'] = req.headers['content-type'];
    const body = ['GET', 'HEAD'].includes(req.method)
      ? undefined
      : (typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {}));
    const response = await fetchWorker(sandbox, internalPath, {
      method: req.method,
      headers,
      body,
      timeoutMs: internalPath === '/api/ai-test' ? 30000 : 15000,
    });
    const type = response.headers.get('content-type');
    if (type) res.setHeader('content-type', type);
    return res.status(response.status).send(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    if (req.method === 'GET') return res.status(200).json({ ...placeholder(internalPath), warning: String(error) });
    return res.status(503).json({ error: 'worker_unavailable', message: String(error) });
  }
}

export async function sandboxDiagnostics(credential = '') {
  rememberCredential(credential);
  try {
    const sandbox = await getSandbox();
    const ready = await isReady(sandbox);
    if (!ready) await kick(sandbox, latestCredential);
    else await syncCredential(sandbox, latestCredential);

    let workerStatus = null;
    if (ready) {
      try {
        const response = await fetchWorker(sandbox, '/api/status', { timeoutMs: 5000 });
        if (response.ok) workerStatus = await response.json();
      } catch {}
    }
    const result = await run(sandbox, [
      'echo "--- OS ---"; cat /etc/os-release 2>/dev/null || true',
      'echo "--- NODE ---"; node -v || true',
      'echo "--- CHROMIUM ---"; ls -l /tmp/chromium /tmp/al2023/lib/libnspr4.so /tmp/al2023/lib/libnss3.so 2>/dev/null || true',
      'echo "--- BOOTSTRAP ---"; tail -160 /vercel/sandbox/bootstrap.log 2>/dev/null || true',
      'echo "--- WORKER ---"; tail -160 /vercel/sandbox/worker.log 2>/dev/null || true',
    ].join('; '), { timeoutMs: 6000 });
    return {
      ok: true,
      ready,
      sandbox: SANDBOX_NAME,
      aiGatewayConfigured: Boolean(latestCredential),
      workerStatus,
      logs: (await result.stdout()).slice(-18000),
      remainingIntegration: 'gconnect',
    };
  } catch (error) {
    return { ok: false, message: String(error) };
  }
}
