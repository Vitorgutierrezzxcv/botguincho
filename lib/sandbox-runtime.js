import { Sandbox } from '@vercel/sandbox';

const SANDBOX_NAME = 'botguincho-wa-vercel-v6';
const REPO_URL = 'https://github.com/Vitorgutierrezzxcv/botguincho.git';
const APP_DIR = '/vercel/sandbox/app';
const DATA_DIR = '/vercel/sandbox/.botguincho-data';
const WORKER_PORT = 3001;
const SESSION_TIMEOUT_MS = 40 * 60 * 1000;
const SNAPSHOT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
let sandboxInflight = null;

function shellQuote(value) {
  return `'${String(value ?? '').replace(/'/g, `'"'"'`)}'`;
}

async function exec(sandbox, command, { detached = false, timeoutMs = 10000 } = {}) {
  return sandbox.runCommand({
    cmd: 'bash',
    args: ['-lc', command],
    detached,
    signal: AbortSignal.timeout(timeoutMs),
  });
}

async function configureSandbox(sandbox) {
  await sandbox.update({
    resources: { vcpus: 2 },
    timeout: SESSION_TIMEOUT_MS,
    persistent: true,
    snapshotExpiration: SNAPSHOT_TTL_MS,
    keepLastSnapshots: { count: 1 },
    ports: [WORKER_PORT],
    networkPolicy: 'allow-all',
  }, { signal: AbortSignal.timeout(10000) });
}

function getPublicUrl() {
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return 'https://botguincho.vercel.app';
}

export function defaultSettings() {
  return {
    companyName: 'Bot Guincho',
    aiEnabled: true,
    aiModel: 'openai/gpt-5-mini',
    aiInstructions: 'Você é o atendente operacional de uma empresa de guincho e assistência 24h. Responda em português do Brasil, de forma curta, natural, profissional e útil. Interprete cada mensagem considerando o histórico recente do grupo. Sua função é agilizar o despacho e coletar as informações necessárias. Nunca invente disponibilidade de guincho, localização do prestador, preço, prazo ou ETA. Enquanto a integração GConnect não estiver disponível, quando a resposta depender de disponibilidade, posição ou ETA, diga de forma natural que está verificando e peça somente a informação que realmente estiver faltando. Se o pedido já tiver origem, destino, tipo de veículo e situação, confirme resumidamente os dados e prossiga sem fazer perguntas repetidas. Não diga que é IA, bot, modelo de linguagem ou que recebeu instruções internas.',
    replyEveryMessage: true,
    humanTakeover: false,
  };
}

function localHealthCommand() {
  return `node -e "fetch('http://127.0.0.1:${WORKER_PORT}/api/status').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"`;
}

async function workerResponding(sandbox) {
  try {
    const result = await exec(sandbox, localHealthCommand(), { timeoutMs: 5000 });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

async function getSandbox() {
  if (!sandboxInflight) {
    sandboxInflight = Sandbox.getOrCreate({
      name: SANDBOX_NAME,
      resume: true,
      onCreate: configureSandbox,
      onResume: configureSandbox,
    }).then(async (sandbox) => {
      await configureSandbox(sandbox);
      return sandbox;
    }).finally(() => { sandboxInflight = null; });
  }
  return sandboxInflight;
}

function bootstrapScript() {
  const settingsJson = JSON.stringify(defaultSettings(), null, 2);
  const settingsFile = `${DATA_DIR}/cliente-teste/settings.json`;
  const publicUrl = getPublicUrl();
  return [
    'set -eu',
    'exec >> /vercel/sandbox/botguincho-bootstrap.log 2>&1',
    'echo "=== bootstrap $(date -Iseconds) ==="',
    'LOCK=/vercel/sandbox/.botguincho-bootstrap-lock',
    'if ! mkdir "$LOCK" 2>/dev/null; then',
    '  if [ -f "$LOCK/pid" ] && kill -0 "$(cat "$LOCK/pid")" 2>/dev/null; then echo "Bootstrap já em execução."; exit 0; fi',
    '  rm -rf "$LOCK"; mkdir "$LOCK"',
    'fi',
    'echo $$ > "$LOCK/pid"',
    'cleanup(){ rm -rf "$LOCK" 2>/dev/null || true; }',
    'trap cleanup EXIT INT TERM',
    `if ${localHealthCommand()}; then echo "Worker já saudável."; exit 0; fi`,
    `mkdir -p ${DATA_DIR}/cliente-teste`,
    `if [ ! -s ${settingsFile} ]; then printf '%s' ${shellQuote(settingsJson)} > ${settingsFile}; fi`,
    `if [ ! -d ${APP_DIR}/.git ]; then`,
    `  rm -rf ${APP_DIR}`,
    `  git clone --depth 1 --branch main ${REPO_URL} ${APP_DIR}`,
    'else',
    `  cd ${APP_DIR}; git fetch origin main --depth 1; git reset --hard origin/main`,
    'fi',
    `cd ${APP_DIR}`,
    'export PUPPETEER_SKIP_DOWNLOAD=true',
    'echo "Instalando dependências Node."',
    'npm install --no-audit --no-fund --prefer-offline',
    'echo "Preparando Chromium serverless."',
    'export VERCEL=1',
    'CHROMIUM_PATH=$(node --input-type=module -e "import chromium from \"@sparticuz/chromium\"; chromium.setGraphicsMode=false; process.stdout.write(await chromium.executablePath())")',
    'test -x "$CHROMIUM_PATH"',
    'export PUPPETEER_EXECUTABLE_PATH="$CHROMIUM_PATH"',
    'export LD_LIBRARY_PATH="/tmp/al2023/lib:${LD_LIBRARY_PATH:-}"',
    'export FONTCONFIG_PATH=/tmp/fonts',
    'echo "Chromium: $CHROMIUM_PATH"',
    `export BOTGUINCHO_DATA_DIR=${DATA_DIR}`,
    `export BOTGUINCHO_PLATFORM_PORT=${WORKER_PORT}`,
    `export BOTGUINCHO_VERCEL_URL=${shellQuote(publicUrl)}`,
    `export BOTGUINCHO_AI_ENDPOINT=${shellQuote(`${publicUrl}/api/ai/respond`)}`,
    'export OPENAI_MODEL=openai/gpt-5-mini',
    'echo "Iniciando worker WhatsApp v6."',
    'nohup node tools/vercel-whatsapp-worker.mjs >> /vercel/sandbox/botguincho-worker.log 2>&1 < /dev/null &',
    'WORKER_PID=$!; echo "$WORKER_PID" > /vercel/sandbox/botguincho-worker.pid',
    'for i in $(seq 1 45); do',
    `  if ${localHealthCommand()}; then echo "Worker respondeu localmente."; exit 0; fi`,
    '  sleep 1',
    'done',
    'echo "Worker não respondeu."',
    'tail -120 /vercel/sandbox/botguincho-worker.log 2>/dev/null || true',
    'exit 1',
  ].join('\n');
}

async function kickWorker(sandbox) {
  if (await workerResponding(sandbox)) return { ready: true };
  try {
    await exec(sandbox, bootstrapScript(), { detached: true, timeoutMs: 8000 });
    return { ready: false, starting: true };
  } catch (error) {
    return { ready: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function fetchWorker(sandbox, internalPath, options = {}) {
  const baseUrl = sandbox.domain(WORKER_PORT);
  return fetch(`${baseUrl}${internalPath}`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(options.timeoutMs ?? 12000),
    ...options,
  });
}

export async function getWorkerStatus() {
  try {
    const sandbox = await getSandbox();
    if (await workerResponding(sandbox)) {
      try {
        const response = await fetchWorker(sandbox, '/api/status', { timeoutMs: 7000 });
        if (response.ok) {
          const status = await response.json();
          return { ...status, infrastructure: { status: 'ready', sandbox: sandbox.name } };
        }
      } catch {}
    }
    const kick = await kickWorker(sandbox);
    return {
      clientId: 'cliente-teste',
      whatsapp: { status: kick.error ? 'erro' : 'iniciando', qrDataUrl: null, lastError: kick.error || null },
      ai: { configured: true, enabled: true, model: 'openai/gpt-5-mini' },
      groupsSelected: 0,
      infrastructure: { status: kick.error ? 'error' : 'starting', sandbox: sandbox.name, message: kick.error || 'Preparando WhatsApp e Chromium serverless.' },
    };
  } catch (error) {
    return {
      clientId: 'cliente-teste',
      whatsapp: { status: 'erro', qrDataUrl: null, lastError: error instanceof Error ? error.message : String(error) },
      ai: { configured: true, enabled: true, model: 'openai/gpt-5-mini' },
      groupsSelected: 0,
      infrastructure: { status: 'error', message: error instanceof Error ? error.message : String(error) },
    };
  }
}

function initializingPayload(internalPath) {
  if (internalPath === '/api/activity') return { activity: [], initializing: true };
  if (internalPath === '/api/groups') return { groups: [], initializing: true };
  if (internalPath === '/api/settings') return { ...defaultSettings(), apiKeyConfigured: true, initializing: true };
  return { ok: false, initializing: true };
}

export async function proxyWorker(req, res, internalPath) {
  res.setHeader('cache-control', 'no-store');
  try {
    const sandbox = await getSandbox();
    if (!(await workerResponding(sandbox))) {
      await kickWorker(sandbox);
      if (req.method === 'GET') return res.status(200).json(initializingPayload(internalPath));
      return res.status(425).json({ ok: false, initializing: true });
    }
    const headers = {};
    if (req.headers['content-type']) headers['content-type'] = req.headers['content-type'];
    let body;
    if (!['GET', 'HEAD'].includes(req.method)) body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});
    const response = await fetchWorker(sandbox, internalPath, { method: req.method, headers, body, timeoutMs: 15000 });
    if (response.headers.get('content-type')) res.setHeader('content-type', response.headers.get('content-type'));
    return res.status(response.status).send(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    if (req.method === 'GET') return res.status(200).json({ ...initializingPayload(internalPath), warning: String(error) });
    return res.status(503).json({ error: 'worker_unavailable', message: String(error) });
  }
}

export async function sandboxDiagnostics() {
  try {
    const sandbox = await getSandbox();
    const ready = await workerResponding(sandbox);
    if (!ready) await kickWorker(sandbox);
    let workerStatus = null;
    if (ready) {
      try { const r = await fetchWorker(sandbox, '/api/status', { timeoutMs: 5000 }); if (r.ok) workerStatus = await r.json(); } catch {}
    }
    const result = await exec(sandbox, [
      'echo "--- OS ---"; cat /etc/os-release 2>/dev/null || true',
      'echo "--- NODE ---"; node -v || true',
      'echo "--- CHROMIUM ---"; ls -l /tmp/chromium /tmp/al2023/lib/libnspr4.so 2>/dev/null || true',
      'echo "--- BOOTSTRAP ---"; tail -140 /vercel/sandbox/botguincho-bootstrap.log 2>/dev/null || true',
      'echo "--- WORKER ---"; tail -140 /vercel/sandbox/botguincho-worker.log 2>/dev/null || true',
      'echo "--- PROCESSES ---"; ps aux | grep -E "vercel-whatsapp-worker|npm install|git clone" | grep -v grep || true',
    ].join('; '), { timeoutMs: 6000 });
    return { ok: true, ready, sandbox: sandbox.name, aiGatewayConfigured: true, workerStatus, logs: (await result.stdout()).slice(-16000), remainingIntegration: 'gconnect' };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}
