import { Sandbox } from '@vercel/sandbox';

const SANDBOX_NAME = 'botguincho-wa-vercel-v2';
const REPO_URL = 'https://github.com/Vitorgutierrezzxcv/botguincho.git';
const APP_DIR = '/vercel/sandbox/app';
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

async function bootstrapRepo(sandbox) {
  const command = [
    'set -e',
    `if [ ! -d ${APP_DIR}/.git ]; then rm -rf ${APP_DIR}; git clone --depth 1 --branch main ${REPO_URL} ${APP_DIR}; else cd ${APP_DIR}; git fetch origin main --depth 1; git reset --hard origin/main; fi`,
    `cd ${APP_DIR}`,
    'npm install --no-audit --no-fund',
  ].join(' && ');

  const result = await exec(sandbox, command);
  if (result.exitCode !== 0) {
    throw new Error(`Falha ao preparar o worker: ${await result.stderr()}`);
  }
}

async function ensureDefaultSettings(sandbox) {
  const instructions = 'Você é o atendente operacional de uma empresa de guincho e assistência 24h. Responda em português do Brasil, de forma curta, natural, profissional e útil. Interprete cada mensagem considerando o histórico recente do grupo. Sua função é agilizar o despacho e coletar as informações necessárias. Nunca invente disponibilidade de guincho, localização do prestador, preço, prazo ou ETA. Enquanto a integração GConnect não estiver disponível, quando a resposta depender de disponibilidade, posição ou ETA, diga de forma natural que está verificando e peça somente a informação que realmente estiver faltando. Se o pedido já tiver origem, destino, tipo de veículo e situação, confirme resumidamente os dados e prossiga sem fazer perguntas repetidas. Não diga que é IA, bot, modelo de linguagem ou que recebeu instruções internas.';
  const command = [
    'set -e',
    'mkdir -p /vercel/sandbox/.botguincho-data/cliente-teste',
    'if [ ! -f /vercel/sandbox/.botguincho-data/cliente-teste/settings.json ]; then',
    `printf '%s' ${shellQuote(JSON.stringify({
      companyName: 'Bot Guincho',
      aiEnabled: true,
      aiModel: 'openai/gpt-5-mini',
      aiInstructions: instructions,
      replyEveryMessage: true,
      humanTakeover: false,
    }, null, 2))} > /vercel/sandbox/.botguincho-data/cliente-teste/settings.json`,
    'fi',
  ].join(' ');
  const result = await exec(sandbox, command);
  if (result.exitCode !== 0) {
    throw new Error(`Falha ao preparar as configurações da IA: ${await result.stderr()}`);
  }
}

async function startWorker(sandbox) {
  const aiCredential = process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN || '';
  const publicUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'https://botguincho.vercel.app';

  await ensureDefaultSettings(sandbox);

  const script = [
    'set -e',
    `cd ${APP_DIR}`,
    "pkill -f 'node tools/admin-platform.mjs' >/dev/null 2>&1 || true",
    'export BOTGUINCHO_DATA_DIR=/vercel/sandbox/.botguincho-data',
    `export BOTGUINCHO_PLATFORM_PORT=${WORKER_PORT}`,
    `export OPENAI_API_KEY=${shellQuote(aiCredential)}`,
    'export OPENAI_BASE_URL=https://ai-gateway.vercel.sh/v1',
    'export OPENAI_MODEL=openai/gpt-5-mini',
    `export BOTGUINCHO_VERCEL_URL=${shellQuote(publicUrl)}`,
    'exec node tools/admin-platform.mjs >> /vercel/sandbox/botguincho-worker.log 2>&1',
  ].join(' && ');

  await exec(sandbox, script, { detached: true });
}

async function workerResponding(sandbox) {
  try {
    const base = sandbox.domain(WORKER_PORT);
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
  for (let i = 0; i < 45; i += 1) {
    try {
      const response = await fetch(`${base}/api/status`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(5000),
      });
      if (response.ok) return base;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  let tail = '';
  try {
    const result = await exec(sandbox, 'tail -80 /vercel/sandbox/botguincho-worker.log 2>/dev/null || true');
    tail = await result.stdout();
  } catch {}
  throw new Error(`O worker do WhatsApp não ficou pronto a tempo.${tail ? ` Logs: ${tail.slice(-2500)}` : ''}`);
}

async function createOrResumeSandbox() {
  const sandbox = await Sandbox.getOrCreate({
    name: SANDBOX_NAME,
    resume: true,
    onCreate: async (sbx) => {
      await configureSandbox(sbx);
      await bootstrapRepo(sbx);
      await startWorker(sbx);
    },
    onResume: async (sbx) => {
      await configureSandbox(sbx);
      await bootstrapRepo(sbx);
      await startWorker(sbx);
    },
  });

  await configureSandbox(sandbox);

  if (!(await workerResponding(sandbox))) {
    await bootstrapRepo(sandbox);
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
      signal: AbortSignal.timeout(25000),
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
    return {
      ok: true,
      sandbox: sandbox.name,
      baseUrl,
      expiresAt: sandbox.expiresAt ?? null,
      aiGatewayConfigured: Boolean(process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN),
      remainingIntegration: 'gconnect',
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
