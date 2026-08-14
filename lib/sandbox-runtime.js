import { Sandbox } from '@vercel/sandbox';

const SANDBOX_NAME = 'botguincho-wa-vercel-v11';
const REPO_URL = 'https://github.com/Vitorgutierrezzxcv/botguincho.git';
const DATA_DIR = '/vercel/sandbox/.botguincho-data';
const PORT = 3001;
const CLIENT_ID = 'cliente-teste';

let inflight = null;
let latestCredential = '';

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

export function defaultSettings() {
  return {
    companyName: 'Bot Guincho',
    aiEnabled: true,
    aiModel: 'openai/gpt-5.4-mini',
    aiInstructions: 'Você é o atendente operacional de uma empresa de guincho e assistência 24h. Responda em português do Brasil, de forma curta, natural, profissional e útil. Interprete cada mensagem considerando o histórico recente do grupo. Nunca invente disponibilidade, localização, preço, prazo ou ETA. Enquanto o GConnect não estiver disponível, quando a resposta depender desses dados, diga de forma natural que está verificando e peça somente a informação realmente necessária. Se o pedido já tiver origem, destino, tipo de veículo e situação, confirme resumidamente e prossiga sem repetir perguntas. Nunca diga que é IA, bot ou modelo de linguagem.',
    replyEveryMessage: true,
    humanTakeover: false,
  };
}

function workerEnv(credential = '') {
  return {
    BOTGUINCHO_DATA_DIR: DATA_DIR,
    BOTGUINCHO_PLATFORM_PORT: String(PORT),
    WHATSAPP_CLIENT_ID: CLIENT_ID,
    PUPPETEER_SKIP_DOWNLOAD: 'true',
    OPENAI_API_KEY: credential || '',
    OPENAI_BASE_URL: 'https://ai-gateway.vercel.sh/v1',
    OPENAI_MODEL: 'openai/gpt-5.4-mini',
    VERCEL: '1',
  };
}

async function run(sandbox, command, timeoutMs = 15000) {
  return sandbox.runCommand({
    ...command,
    signal: AbortSignal.timeout(timeoutMs),
  });
}

function localHealthCommand() {
  return {
    cmd: 'node',
    args: [
      '-e',
      `fetch('http://127.0.0.1:${PORT}/api/status').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))`,
    ],
  };
}

async function isReady(sandbox) {
  try {
    const result = await run(sandbox, localHealthCommand(), 5000);
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

async function installDependencies(sandbox) {
  const common = {
    env: {
      PUPPETEER_SKIP_DOWNLOAD: 'true',
      npm_config_audit: 'false',
      npm_config_fund: 'false',
    },
  };

  let result = await run(sandbox, {
    cmd: 'npm',
    args: ['ci', '--omit=dev', '--no-audit', '--no-fund'],
    ...common,
  }, 120000);

  if (result.exitCode !== 0) {
    result = await run(sandbox, {
      cmd: 'npm',
      args: ['install', '--omit=dev', '--no-audit', '--no-fund'],
      ...common,
    }, 120000);
  }

  if (result.exitCode !== 0) {
    let stderr = '';
    try { stderr = await result.stderr(); } catch {}
    throw new Error(`Falha ao instalar dependências do worker: ${stderr || `exit ${result.exitCode}`}`);
  }
}

async function startWorkerDetached(sandbox) {
  if (await isReady(sandbox)) return true;

  // O processo detached é gerenciado nativamente pelo Sandbox. Não usamos nohup,
  // túnel, Cloudflare ou um bootstrap shell que possa morrer com a Function.
  await sandbox.runCommand({
    cmd: 'bash',
    args: [
      '-lc',
      'rm -f /vercel/sandbox/worker.log; exec node tools/vercel-whatsapp-worker.mjs >> /vercel/sandbox/worker.log 2>&1',
    ],
    env: workerEnv(latestCredential),
    detached: true,
  });

  return false;
}

async function onCreate(sandbox) {
  await installDependencies(sandbox);
  await startWorkerDetached(sandbox);
}

async function onResume(sandbox) {
  await startWorkerDetached(sandbox);
}

async function getSandbox() {
  if (!inflight) {
    inflight = Sandbox.getOrCreate({
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
      onCreate,
      onResume,
    }).finally(() => {
      inflight = null;
    });
  }
  return inflight;
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

async function readWorkerStatus(sandbox) {
  if (!(await isReady(sandbox))) return null;
  await syncCredential(sandbox, latestCredential);
  try {
    const response = await fetchWorker(sandbox, '/api/status', { timeoutMs: 7000 });
    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  }
}

export async function getWorkerStatus(credential = '') {
  rememberCredential(credential);
  try {
    const sandbox = await getSandbox();

    let status = await readWorkerStatus(sandbox);
    if (!status) {
      await startWorkerDetached(sandbox);
      await new Promise((resolve) => setTimeout(resolve, 1400));
      status = await readWorkerStatus(sandbox);
    }

    if (status) {
      return {
        ...status,
        infrastructure: {
          status: 'ready',
          sandbox: SANDBOX_NAME,
          architecture: 'persistent-sandbox-native-lifecycle',
        },
      };
    }

    return {
      clientId: CLIENT_ID,
      whatsapp: { status: 'iniciando', qrDataUrl: null, lastError: null },
      ai: { configured: Boolean(latestCredential), enabled: true, model: 'openai/gpt-5.4-mini' },
      groupsSelected: 0,
      infrastructure: {
        status: 'starting',
        sandbox: SANDBOX_NAME,
        architecture: 'persistent-sandbox-native-lifecycle',
        message: 'Worker criado; aguardando o processo do WhatsApp abrir o Chromium.',
      },
    };
  } catch (error) {
    return {
      clientId: CLIENT_ID,
      whatsapp: { status: 'erro', qrDataUrl: null, lastError: String(error) },
      ai: { configured: Boolean(latestCredential), enabled: true, model: 'openai/gpt-5.4-mini' },
      groupsSelected: 0,
      infrastructure: { status: 'error', sandbox: SANDBOX_NAME, message: String(error) },
    };
  }
}

function placeholder(path) {
  if (path === '/api/activity') return { activity: [], initializing: true };
  if (path === '/api/groups') return { groups: [], initializing: true };
  if (path === '/api/settings') {
    return { ...defaultSettings(), apiKeyConfigured: Boolean(latestCredential), initializing: true };
  }
  return { initializing: true };
}

export async function proxyWorker(req, res, internalPath) {
  res.setHeader('cache-control', 'no-store');
  const credential = requestCredential(req);

  try {
    const sandbox = await getSandbox();
    if (!(await isReady(sandbox))) {
      await startWorkerDetached(sandbox);
      return req.method === 'GET'
        ? res.status(200).json(placeholder(internalPath))
        : res.status(425).json({ initializing: true, message: 'WhatsApp ainda está iniciando.' });
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
      timeoutMs: internalPath === '/api/ai-test' ? 35000 : 15000,
    });

    const type = response.headers.get('content-type');
    if (type) res.setHeader('content-type', type);
    return res.status(response.status).send(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    if (req.method === 'GET') {
      return res.status(200).json({ ...placeholder(internalPath), warning: String(error) });
    }
    return res.status(503).json({ error: 'worker_unavailable', message: String(error) });
  }
}

export async function sandboxDiagnostics(credential = '') {
  rememberCredential(credential);
  try {
    const sandbox = await getSandbox();
    const ready = await isReady(sandbox);
    if (!ready) await startWorkerDetached(sandbox);
    else await syncCredential(sandbox, latestCredential);

    let workerStatus = null;
    if (ready) {
      try {
        const response = await fetchWorker(sandbox, '/api/status', { timeoutMs: 5000 });
        if (response.ok) workerStatus = await response.json();
      } catch {}
    }

    const result = await run(sandbox, {
      cmd: 'bash',
      args: ['-lc', [
        'echo "--- OS ---"; cat /etc/os-release 2>/dev/null || true',
        'echo "--- NODE ---"; node -v || true',
        'echo "--- REPO ---"; pwd; ls -la | head -40',
        'echo "--- MODULES ---"; test -d node_modules && echo node_modules=OK || echo node_modules=MISSING',
        'echo "--- PROCESSES ---"; ps aux | grep -E "vercel-whatsapp-worker|chromium|chrome" | grep -v grep || true',
        'echo "--- CHROMIUM ---"; ls -l /tmp/chromium /tmp/al2023/lib/libnspr4.so /tmp/al2023/lib/libnss3.so 2>/dev/null || true',
        'echo "--- WORKER LOG ---"; tail -200 /vercel/sandbox/worker.log 2>/dev/null || true',
      ].join('; ')],
    }, 8000);

    let logs = '';
    try { logs = await result.stdout(); } catch {}

    return {
      ok: true,
      ready,
      sandbox: SANDBOX_NAME,
      architecture: 'persistent-sandbox-native-lifecycle',
      aiGatewayConfigured: Boolean(latestCredential),
      workerStatus,
      logs: logs.slice(-20000),
      remainingIntegration: 'gconnect',
    };
  } catch (error) {
    return { ok: false, sandbox: SANDBOX_NAME, message: String(error) };
  }
}
