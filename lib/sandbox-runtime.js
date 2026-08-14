import { Sandbox } from '@vercel/sandbox';

const SANDBOX_NAME = 'botguincho-wa-vercel-v3';
const REPO_URL = 'https://github.com/Vitorgutierrezzxcv/botguincho.git';
const APP_DIR = '/vercel/sandbox/app';
const DATA_DIR = '/vercel/sandbox/.botguincho-data';
const WORKER_PORT = 3001;
const SESSION_TIMEOUT_MS = 40 * 60 * 1000;
const SNAPSHOT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

let inflight = null;

function shellQuote(value) {
  return `'${String(value ?? '').replace(/'/g, `'"'"'`)}'`;
}

async function exec(sandbox, command, { detached = false } = {}) {
  return sandbox.runCommand({
    cmd: 'bash',
    args: ['-lc', command],
    detached,
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
  });
}

function getPublicUrl() {
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return 'https://botguincho.vercel.app';
}

function getDefaultSettings() {
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
    const result = await exec(sandbox, localHealthCommand());
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

async function ensureWorkerStarted(sandbox) {
  if (await workerResponding(sandbox)) return;

  const aiCredential = process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN || '';
  const settingsJson = JSON.stringify(getDefaultSettings(), null, 2);
  const settingsFile = `${DATA_DIR}/cliente-teste/settings.json`;
  const publicUrl = getPublicUrl();
  const health = localHealthCommand();

  // A trava e o health check ficam DENTRO do Sandbox. Isso evita que as várias
  // funções serverless disparadas pelo painel reiniciem o mesmo WhatsApp ao mesmo tempo.
  const command = [
    'set -e',
    'exec 9>/vercel/sandbox/.botguincho-start.lock',
    'flock -x 9',
    `if ${health}; then exit 0; fi`,
    `if [ ! -d ${APP_DIR}/.git ]; then rm -rf ${APP_DIR}; git clone --depth 1 --branch main ${REPO_URL} ${APP_DIR}; else cd ${APP_DIR}; git fetch origin main --depth 1; git reset --hard origin/main; fi`,
    `cd ${APP_DIR}`,
    'npm install --no-audit --no-fund --prefer-offline',
    `mkdir -p ${DATA_DIR}/cliente-teste`,
    `if [ ! -s ${settingsFile} ]; then printf '%s' ${shellQuote(settingsJson)} > ${settingsFile}; fi`,
    `export BOTGUINCHO_DATA_DIR=${DATA_DIR}`,
    `export BOTGUINCHO_PLATFORM_PORT=${WORKER_PORT}`,
    `export OPENAI_API_KEY=${shellQuote(aiCredential)}`,
    'export OPENAI_BASE_URL=https://ai-gateway.vercel.sh/v1',
    'export OPENAI_MODEL=openai/gpt-5-mini',
    `export BOTGUINCHO_VERCEL_URL=${shellQuote(publicUrl)}`,
    'nohup node tools/admin-platform.mjs >> /vercel/sandbox/botguincho-worker.log 2>&1 < /dev/null &',
    `for i in $(seq 1 20); do if ${health}; then exit 0; fi; sleep 1; done`,
    'echo "Worker não respondeu na porta 3001" >&2',
    'tail -100 /vercel/sandbox/botguincho-worker.log 2>/dev/null >&2 || true',
    'exit 1',
  ].join('\n');

  const result = await exec(sandbox, command);
  if (result.exitCode !== 0) {
    const stderr = await result.stderr();
    const stdout = await result.stdout();
    throw new Error(`Falha ao iniciar o worker do WhatsApp.${stderr ? ` ${stderr.slice(-3500)}` : ''}${stdout ? ` ${stdout.slice(-1500)}` : ''}`);
  }
}

async function waitForPublicWorker(sandbox) {
  const base = sandbox.domain(WORKER_PORT);
  for (let i = 0; i < 20; i += 1) {
    try {
      const response = await fetch(`${base}/api/status`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(4000),
      });
      if (response.ok) return base;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 750));
  }

  let tail = '';
  try {
    const result = await exec(sandbox, 'tail -100 /vercel/sandbox/botguincho-worker.log 2>/dev/null || true');
    tail = await result.stdout();
  } catch {}
  throw new Error(`O worker iniciou localmente, mas a porta pública não respondeu.${tail ? ` Logs: ${tail.slice(-3000)}` : ''}`);
}

async function createOrResumeSandbox() {
  const sandbox = await Sandbox.getOrCreate({
    name: SANDBOX_NAME,
    resume: true,
    onCreate: async (sbx) => {
      await configureSandbox(sbx);
    },
    onResume: async (sbx) => {
      await configureSandbox(sbx);
    },
  });

  await configureSandbox(sandbox);
  await ensureWorkerStarted(sandbox);
  const baseUrl = await waitForPublicWorker(sandbox);
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
    res.setHeader('cache-control', 'no-store');
    res.status(503).json({
      error: 'worker_unavailable',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function sandboxDiagnostics() {
  try {
    const { sandbox, baseUrl } = await ensureSandbox();
    const statusResponse = await fetch(`${baseUrl}/api/status`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    const workerStatus = statusResponse.ok ? await statusResponse.json() : null;
    return {
      ok: true,
      sandbox: sandbox.name,
      baseUrl,
      expiresAt: sandbox.expiresAt ?? null,
      aiGatewayConfigured: Boolean(process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN),
      workerStatus,
      remainingIntegration: 'gconnect',
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
