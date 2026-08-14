import { Sandbox } from '@vercel/sandbox';

const SANDBOX_NAME = 'botguincho-wa-vercel-v4';
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
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
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

function aiConfigured() {
  return Boolean(process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN);
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
    }).finally(() => {
      sandboxInflight = null;
    });
  }
  return sandboxInflight;
}

function bootstrapScript() {
  const aiCredential = process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN || '';
  const settingsJson = JSON.stringify(defaultSettings(), null, 2);
  const settingsFile = `${DATA_DIR}/cliente-teste/settings.json`;
  const publicUrl = getPublicUrl();
  const lockDir = '/vercel/sandbox/.botguincho-bootstrap-lock';

  return [
    'set -u',
    `LOCK=${shellQuote(lockDir)}`,
    'if ! mkdir "$LOCK" 2>/dev/null; then exit 0; fi',
    'cleanup(){ rmdir "$LOCK" 2>/dev/null || true; }',
    'trap cleanup EXIT',
    `if ${localHealthCommand()}; then exit 0; fi`,
    `mkdir -p ${DATA_DIR}/cliente-teste`,
    `if [ ! -s ${settingsFile} ]; then printf '%s' ${shellQuote(settingsJson)} > ${settingsFile}; fi`,
    `if [ ! -d ${APP_DIR}/.git ]; then`,
    `  rm -rf ${APP_DIR}`,
    `  git clone --depth 1 --branch main ${REPO_URL} ${APP_DIR}`,
    'else',
    `  cd ${APP_DIR}`,
    '  git fetch origin main --depth 1',
    '  git reset --hard origin/main',
    'fi',
    `cd ${APP_DIR}`,
    'npm install --no-audit --no-fund --prefer-offline',
    "pkill -f 'node tools/admin-platform.mjs' >/dev/null 2>&1 || true",
    `export BOTGUINCHO_DATA_DIR=${DATA_DIR}`,
    `export BOTGUINCHO_PLATFORM_PORT=${WORKER_PORT}`,
    `export OPENAI_API_KEY=${shellQuote(aiCredential)}`,
    'export OPENAI_BASE_URL=https://ai-gateway.vercel.sh/v1',
    'export OPENAI_MODEL=openai/gpt-5-mini',
    `export BOTGUINCHO_VERCEL_URL=${shellQuote(publicUrl)}`,
    'nohup node tools/admin-platform.mjs >> /vercel/sandbox/botguincho-worker.log 2>&1 < /dev/null &',
    'echo $! > /vercel/sandbox/botguincho-worker.pid',
  ].join('\n');
}

async function kickWorker(sandbox) {
  if (await workerResponding(sandbox)) return { ready: true };
  try {
    await exec(sandbox, bootstrapScript(), { detached: true, timeoutMs: 8000 });
    return { ready: false, starting: true };
  } catch (error) {
    return {
      ready: false,
      starting: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function fetchWorkerJson(sandbox, internalPath, timeoutMs = 7000) {
  const baseUrl = sandbox.domain(WORKER_PORT);
  const response = await fetch(`${baseUrl}${internalPath}`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`Worker HTTP ${response.status}`);
  return response.json();
}

export async function getWorkerStatus() {
  try {
    const sandbox = await getSandbox();
    if (await workerResponding(sandbox)) {
      try {
        const status = await fetchWorkerJson(sandbox, '/api/status');
        return {
          ...status,
          infrastructure: { status: 'ready', sandbox: sandbox.name },
        };
      } catch {
        // O processo já está vivo localmente; o domínio publicado pode levar alguns segundos.
      }
    }

    const kick = await kickWorker(sandbox);
    return {
      clientId: 'cliente-teste',
      whatsapp: {
        status: kick.error ? 'erro' : 'iniciando',
        qrDataUrl: null,
        lastError: kick.error || null,
      },
      ai: {
        configured: aiConfigured(),
        enabled: true,
        model: 'openai/gpt-5-mini',
      },
      groupsSelected: 0,
      infrastructure: {
        status: kick.error ? 'error' : 'starting',
        sandbox: sandbox.name,
        message: kick.error || 'Preparando o ambiente do WhatsApp em segundo plano.',
      },
    };
  } catch (error) {
    return {
      clientId: 'cliente-teste',
      whatsapp: {
        status: 'erro',
        qrDataUrl: null,
        lastError: error instanceof Error ? error.message : String(error),
      },
      ai: {
        configured: aiConfigured(),
        enabled: true,
        model: 'openai/gpt-5-mini',
      },
      groupsSelected: 0,
      infrastructure: {
        status: 'error',
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

function initializingPayload(internalPath) {
  if (internalPath === '/api/activity') return { activity: [], initializing: true };
  if (internalPath === '/api/groups') return { groups: [], initializing: true };
  if (internalPath === '/api/settings') {
    return { ...defaultSettings(), apiKeyConfigured: aiConfigured(), initializing: true };
  }
  return { ok: false, initializing: true, message: 'WhatsApp ainda está iniciando.' };
}

export async function proxyWorker(req, res, internalPath) {
  res.setHeader('cache-control', 'no-store');
  try {
    const sandbox = await getSandbox();
    const isReady = await workerResponding(sandbox);

    if (!isReady) {
      await kickWorker(sandbox);
      if (req.method === 'GET') return res.status(200).json(initializingPayload(internalPath));
      return res.status(425).json({ ok: false, initializing: true, message: 'Aguarde o WhatsApp terminar de iniciar.' });
    }

    const baseUrl = sandbox.domain(WORKER_PORT);
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
      signal: AbortSignal.timeout(12000),
    });

    const responseType = response.headers.get('content-type');
    if (responseType) res.setHeader('content-type', responseType);
    const bytes = Buffer.from(await response.arrayBuffer());
    return res.status(response.status).send(bytes);
  } catch (error) {
    if (req.method === 'GET') {
      const payload = initializingPayload(internalPath);
      return res.status(200).json({ ...payload, warning: error instanceof Error ? error.message : String(error) });
    }
    return res.status(503).json({
      error: 'worker_unavailable',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function sandboxDiagnostics() {
  try {
    const sandbox = await getSandbox();
    const ready = await workerResponding(sandbox);
    let workerStatus = null;
    let logs = '';
    if (ready) {
      try { workerStatus = await fetchWorkerJson(sandbox, '/api/status', 5000); } catch {}
    } else {
      await kickWorker(sandbox);
      try {
        const result = await exec(sandbox, 'tail -80 /vercel/sandbox/botguincho-worker.log 2>/dev/null || true', { timeoutMs: 5000 });
        logs = await result.stdout();
      } catch {}
    }
    return {
      ok: true,
      ready,
      sandbox: sandbox.name,
      aiGatewayConfigured: aiConfigured(),
      workerStatus,
      logs: logs.slice(-5000),
      remainingIntegration: 'gconnect',
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
