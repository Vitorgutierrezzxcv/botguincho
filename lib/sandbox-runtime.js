import { Sandbox } from '@vercel/sandbox';
import { authorizeTenantRequest } from './control-plane.js';

const LEGACY_SANDBOX_NAME = 'botguincho-wa-hobby-v1';
const DEFAULT_CLIENT_ID = 'cliente-teste';
const REPO_URL = 'https://github.com/Vitorgutierrezzxcv/botguincho.git';
const DATA_DIR = '/vercel/sandbox/.botguincho-data';
const PORT = 3001;
const SESSION_META = '/vercel/sandbox/.botguincho-session.json';
const HOBBY_TIMEOUT = 44 * 60 * 1000;
const PRO_TIMEOUT = 24 * 60 * 60 * 1000;
const WWEBJS_PATCH_URL = 'https://raw.githubusercontent.com/Vitorgutierrezzxcv/botguincho/main/tools/patches/wwebjs-201850.diff';
const WWEBJS_PATCH_FILE = '/tmp/botguincho-wwebjs-201850.diff';

const inflightByTenant = new Map();
const credentialByTenant = new Map();

function sanitizeTenant(value = '') {
  const normalized = String(value || DEFAULT_CLIENT_ID).toLowerCase().trim().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 42);
  return normalized || DEFAULT_CLIENT_ID;
}

function tenantSandboxName(tenant) {
  const id = sanitizeTenant(tenant);
  return id === DEFAULT_CLIENT_ID ? LEGACY_SANDBOX_NAME : `botguincho-wa-${id}`;
}

export function requestTenant(req) {
  return sanitizeTenant(
    req?.headers?.['x-botguincho-company-id'] ||
    req?.query?.companyId ||
    req?.query?.company_id ||
    DEFAULT_CLIENT_ID
  );
}

function tenantCredential(tenant) {
  return credentialByTenant.get(sanitizeTenant(tenant)) || '';
}

function rememberCredential(value, tenant = DEFAULT_CLIENT_ID) {
  const id = sanitizeTenant(tenant);
  const token = Array.isArray(value) ? value[0] : value;
  if (typeof token === 'string' && token.trim()) credentialByTenant.set(id, token.trim());
  return credentialByTenant.get(id) || '';
}

export function requestCredential(req, tenant = requestTenant(req)) {
  return rememberCredential(
    req?.headers?.['x-vercel-oidc-token'] ||
    process.env.VERCEL_OIDC_TOKEN ||
    process.env.AI_GATEWAY_API_KEY ||
    '',
    tenant
  );
}

export function defaultSettings() {
  return {
    companyName: 'Bot Guincho',
    simpleMode: true,
    aiEnabled: false,
    aiModel: 'openai/gpt-5.4-mini',
    aiInstructions: 'Você é o atendente operacional de uma empresa de guincho e assistência 24h. Responda em português do Brasil, de forma curta, natural, profissional e útil. Interprete cada mensagem considerando o histórico recente do grupo. Nunca invente disponibilidade, localização, preço, prazo ou ETA. Enquanto o GConnect não estiver disponível, quando a resposta depender desses dados, diga de forma natural que está verificando e peça somente a informação realmente necessária. Se o pedido já tiver origem, destino, tipo de veículo e situação, confirme resumidamente e prossiga sem repetir perguntas. Nunca diga que é IA, bot ou modelo de linguagem.',
    replyEveryMessage: false,
    humanTakeover: false,
  };
}

function workerEnv(tenant = DEFAULT_CLIENT_ID, credential = '') {
  return {
    BOTGUINCHO_DATA_DIR: DATA_DIR,
    BOTGUINCHO_PLATFORM_PORT: String(PORT),
    WHATSAPP_CLIENT_ID: sanitizeTenant(tenant),
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

async function writeSessionMeta(sandbox, limitMs) {
  const meta = JSON.stringify({
    startedAt: Date.now(),
    limitMs,
    renewAfterMs: limitMs >= 60 * 60 * 1000
      ? limitMs - 30 * 60 * 1000
      : 30 * 60 * 1000,
  });
  await run(sandbox, {
    cmd: 'node',
    args: ['-e', `require('fs').writeFileSync(${JSON.stringify(SESSION_META)}, ${JSON.stringify(meta)})`],
  }, 5000);
}

async function readSessionMeta(sandbox) {
  try {
    const result = await run(sandbox, {
      cmd: 'node',
      args: ['-e', `try{process.stdout.write(require('fs').readFileSync(${JSON.stringify(SESSION_META)},'utf8'))}catch{}`],
    }, 5000);
    const text = (await result.stdout()).trim();
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

async function configureSessionWindow(sandbox) {
  let limitMs = HOBBY_TIMEOUT;
  let planClass = 'hobby-compatible';

  try {
    await sandbox.update({ timeout: PRO_TIMEOUT }, { signal: AbortSignal.timeout(8000) });
    limitMs = PRO_TIMEOUT;
    planClass = 'pro-or-enterprise';
  } catch {
    try {
      await sandbox.update({ timeout: HOBBY_TIMEOUT }, { signal: AbortSignal.timeout(8000) });
    } catch {}
  }

  await writeSessionMeta(sandbox, limitMs);
  return { limitMs, planClass };
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

export async function applyWwebjsPatch(sandbox) {
  const downloadScript = `
    const fs = require('fs');
    fetch(${JSON.stringify(WWEBJS_PATCH_URL)}, { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        fs.writeFileSync(${JSON.stringify(WWEBJS_PATCH_FILE)}, await r.text());
      })
      .catch((e) => { console.error(e); process.exit(1); });
  `;
  const downloaded = await run(sandbox, {
    cmd: 'node',
    args: ['-e', downloadScript],
  }, 15000);
  if (downloaded.exitCode !== 0) {
    let stderr = '';
    try { stderr = await downloaded.stderr(); } catch {}
    throw new Error(`Falha ao baixar patch do whatsapp-web.js: ${stderr || downloaded.exitCode}`);
  }

  const check = await run(sandbox, {
    cmd: 'bash',
    args: ['-lc', `cd /vercel/sandbox && git apply --check ${WWEBJS_PATCH_FILE}`],
  }, 10000);

  if (check.exitCode === 0) {
    const applied = await run(sandbox, {
      cmd: 'bash',
      args: ['-lc', `cd /vercel/sandbox && git apply ${WWEBJS_PATCH_FILE}`],
    }, 10000);
    if (applied.exitCode !== 0) {
      let stderr = '';
      try { stderr = await applied.stderr(); } catch {}
      throw new Error(`Patch do whatsapp-web.js não pôde ser aplicado: ${stderr || applied.exitCode}`);
    }
    return 'applied';
  }

  const reverseCheck = await run(sandbox, {
    cmd: 'bash',
    args: ['-lc', `cd /vercel/sandbox && git apply -R --check ${WWEBJS_PATCH_FILE}`],
  }, 10000);
  if (reverseCheck.exitCode === 0) return 'already-applied';

  let checkError = '';
  let reverseError = '';
  try { checkError = await check.stderr(); } catch {}
  try { reverseError = await reverseCheck.stderr(); } catch {}
  throw new Error(`A versão instalada do whatsapp-web.js não corresponde ao patch #201850. check=${checkError} reverse=${reverseError}`);
}

async function startWorkerDetached(sandbox, tenant = DEFAULT_CLIENT_ID) {
  if (await isReady(sandbox)) return true;

  await sandbox.runCommand({
    cmd: 'bash',
    args: [
      '-lc',
      [
        'LOCK=/vercel/sandbox/.whatsapp-worker-lock',
        'if ! mkdir "$LOCK" 2>/dev/null; then',
        '  if pgrep -f "node tools/vercel-whatsapp-worker.mjs" >/dev/null 2>&1; then exit 0; fi',
        '  rm -rf "$LOCK"',
        '  mkdir "$LOCK" 2>/dev/null || exit 0',
        'fi',
        'echo $$ > "$LOCK/launcher-pid"',
        'rm -f /vercel/sandbox/worker.log',
        'node tools/vercel-whatsapp-worker.mjs >> /vercel/sandbox/worker.log 2>&1',
        'CODE=$?',
        'rm -rf "$LOCK"',
        'exit $CODE',
      ].join('\n'),
    ],
    env: workerEnv(tenant, tenantCredential(tenant)),
    detached: true,
  });

  return false;
}

async function onCreate(sandbox, tenant) {
  await installDependencies(sandbox);
  await applyWwebjsPatch(sandbox);
  await configureSessionWindow(sandbox);
  await startWorkerDetached(sandbox, tenant);
}

async function onResume(sandbox, tenant) {
  await applyWwebjsPatch(sandbox);
  await configureSessionWindow(sandbox);
  await startWorkerDetached(sandbox, tenant);
}

async function getSandbox(tenant = DEFAULT_CLIENT_ID) {
  const id = sanitizeTenant(tenant);
  if (!inflightByTenant.has(id)) {
    const pending = Sandbox.getOrCreate({
      name: tenantSandboxName(id),
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
      onCreate: (sandbox) => onCreate(sandbox, id),
      onResume: (sandbox) => onResume(sandbox, id),
    }).finally(() => {
      inflightByTenant.delete(id);
    });
    inflightByTenant.set(id, pending);
  }
  return inflightByTenant.get(id);
}

export async function ensureWorkerSandbox(tenant = DEFAULT_CLIENT_ID) {
  return getSandbox(tenant);
}

async function fetchWorker(sandbox, path, init = {}) {
  const { timeoutMs = 12000, ...fetchInit } = init;
  return fetch(`${sandbox.domain(PORT)}${path}`, {
    ...fetchInit,
    cache: 'no-store',
    signal: AbortSignal.timeout(timeoutMs),
  });
}

export async function workerJson(path, init = {}, credential = '', tenant = DEFAULT_CLIENT_ID) {
  const id = sanitizeTenant(tenant);
  rememberCredential(credential, id);
  const sandbox = await getSandbox(id);

  if (!(await isReady(sandbox))) {
    await applyWwebjsPatch(sandbox);
    await startWorkerDetached(sandbox, id);
    await new Promise((resolve) => setTimeout(resolve, 1800));
  }

  if (!(await isReady(sandbox))) {
    throw new Error('worker_not_ready');
  }

  await syncCredential(sandbox, tenantCredential(id), id);
  const response = await fetchWorker(sandbox, path, init);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || `worker_http_${response.status}`);
  return data;
}

async function syncCredential(sandbox, credential = '', tenant = DEFAULT_CLIENT_ID) {
  const token = rememberCredential(credential, tenant);
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

async function readWorkerStatus(sandbox, tenant = DEFAULT_CLIENT_ID) {
  if (!(await isReady(sandbox))) return null;
  await syncCredential(sandbox, tenantCredential(tenant), tenant);
  try {
    const response = await fetchWorker(sandbox, '/api/status', { timeoutMs: 7000 });
    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  }
}

export async function maintainWorker(credential = '', tenant = DEFAULT_CLIENT_ID) {
  const id = sanitizeTenant(tenant);
  rememberCredential(credential, id);
  let sandbox = await getSandbox(id);
  let meta = await readSessionMeta(sandbox);

  if (!meta) {
    await configureSessionWindow(sandbox);
    meta = await readSessionMeta(sandbox);
  }

  const elapsedMs = Math.max(0, Date.now() - Number(meta?.startedAt || Date.now()));
  const renewAfterMs = Number(meta?.renewAfterMs || 30 * 60 * 1000);
  let rotated = false;

  if (elapsedMs >= renewAfterMs) {
    await sandbox.stop();
    rotated = true;
    inflightByTenant.delete(id);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    sandbox = await getSandbox(id);
  }

  if (!(await isReady(sandbox))) {
    await applyWwebjsPatch(sandbox);
    await startWorkerDetached(sandbox, id);
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  const status = await readWorkerStatus(sandbox, id);
  const freshMeta = await readSessionMeta(sandbox);

  return {
    ok: true,
    rotated,
    ready: Boolean(status),
    whatsappStatus: status?.whatsapp?.status || 'iniciando',
    groupsSelected: status?.groupsSelected || 0,
    aiConfigured: status?.ai?.configured ?? Boolean(tenantCredential(id)),
    session: freshMeta,
    sandbox: tenantSandboxName(id),
    companyId: id,
  };
}

export async function getWorkerStatus(credential = '', tenant = DEFAULT_CLIENT_ID) {
  const id = sanitizeTenant(tenant);
  rememberCredential(credential, id);
  try {
    const sandbox = await getSandbox(id);

    let status = await readWorkerStatus(sandbox, id);
    if (!status) {
      await applyWwebjsPatch(sandbox);
      await startWorkerDetached(sandbox, id);
      await new Promise((resolve) => setTimeout(resolve, 1800));
      status = await readWorkerStatus(sandbox, id);
    }

    if (status) {
      const session = await readSessionMeta(sandbox);
      return {
        ...status,
        infrastructure: {
          status: 'ready',
          sandbox: tenantSandboxName(id),
          companyId: id,
          architecture: 'persistent-sandbox-auto-renew',
          session,
        },
      };
    }

    return {
      clientId: id,
      whatsapp: { status: 'iniciando', qrDataUrl: null, lastError: null },
      ai: { configured: Boolean(tenantCredential(id)), enabled: true, model: 'openai/gpt-5.4-mini' },
      groupsSelected: 0,
      infrastructure: {
        status: 'starting',
        sandbox: tenantSandboxName(id),
        companyId: id,
        architecture: 'persistent-sandbox-auto-renew',
        message: 'Worker criado; aguardando o processo do WhatsApp abrir o Chromium.',
      },
    };
  } catch (error) {
    return {
      clientId: id,
      whatsapp: { status: 'erro', qrDataUrl: null, lastError: String(error) },
      ai: { configured: Boolean(tenantCredential(id)), enabled: true, model: 'openai/gpt-5.4-mini' },
      groupsSelected: 0,
      infrastructure: { status: 'error', sandbox: tenantSandboxName(id), companyId: id, message: String(error) },
    };
  }
}

function placeholder(path, tenant = DEFAULT_CLIENT_ID) {
  if (path === '/api/activity') return { activity: [], initializing: true };
  if (path === '/api/groups') return { groups: [], initializing: true };
  if (path === '/api/settings') {
    return { ...defaultSettings(), apiKeyConfigured: Boolean(tenantCredential(tenant)), initializing: true };
  }
  return { initializing: true };
}

export async function proxyWorker(req, res, internalPath) {
  res.setHeader('cache-control', 'no-store');
  const tenant = requestTenant(req);
  const credential = requestCredential(req, tenant);
  res.setHeader('x-botguincho-company-id', tenant);

  try {
    await authorizeTenantRequest(req, tenant);
    const headers = {};
    if (req.headers['content-type']) headers['content-type'] = req.headers['content-type'];
    if (req.headers['x-botguincho-pair-code']) headers['x-botguincho-pair-code'] = req.headers['x-botguincho-pair-code'];
    const body = ['GET', 'HEAD'].includes(req.method)
      ? undefined
      : (typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {}));

    const sandbox = await getSandbox(tenant);
    if (!(await isReady(sandbox))) {
      await applyWwebjsPatch(sandbox);
      await startWorkerDetached(sandbox, tenant);
      return req.method === 'GET'
        ? res.status(200).json({ ...placeholder(internalPath, tenant), companyId: tenant })
        : res.status(425).json({ initializing: true, message: 'WhatsApp ainda está iniciando.' });
    }

    await syncCredential(sandbox, credential, tenant);

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
    const status = Number(error?.status || 0);
    if (status === 401 || status === 403) {
      return res.status(status).json({ error: error?.message || (status === 401 ? 'unauthorized' : 'forbidden') });
    }
    if (req.method === 'GET') {
      return res.status(200).json({ ...placeholder(internalPath, tenant), companyId: tenant, warning: String(error) });
    }
    return res.status(503).json({ error: 'worker_unavailable', message: String(error) });
  }
}

export async function sandboxDiagnostics(credential = '', tenant = DEFAULT_CLIENT_ID) {
  const id = sanitizeTenant(tenant);
  rememberCredential(credential, id);
  try {
    const sandbox = await getSandbox(id);
    const ready = await isReady(sandbox);
    if (!ready) {
      await applyWwebjsPatch(sandbox);
      await startWorkerDetached(sandbox, id);
    } else await syncCredential(sandbox, tenantCredential(tenant), tenant);

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
        'echo "--- SESSION ---"; cat /vercel/sandbox/.botguincho-session.json 2>/dev/null || true',
        'echo "--- REPO ---"; pwd; ls -la | head -40',
        'echo "--- MODULES ---"; test -d node_modules && echo node_modules=OK || echo node_modules=MISSING',
        'echo "--- WWEBJS PATCH ---"; grep -q "Process each chat individually" node_modules/whatsapp-web.js/src/util/Injected/Utils.js 2>/dev/null && echo wwebjs_patch=OK || echo wwebjs_patch=MISSING',
        'echo "--- LOCK ---"; ls -la /vercel/sandbox/.whatsapp-worker-lock 2>/dev/null || true',
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
      sandbox: tenantSandboxName(id),
      companyId: id,
      architecture: 'persistent-sandbox-auto-renew',
      aiGatewayConfigured: Boolean(tenantCredential(id)),
      workerStatus,
      session: await readSessionMeta(sandbox),
      logs: logs.slice(-20000),
      remainingIntegration: 'gconnect',
    };
  } catch (error) {
    return { ok: false, sandbox: tenantSandboxName(id), companyId: id, message: String(error) };
  }
}

export async function migrateLegacyVpsState() {
  const oldUrl = String(process.env.BOTGUINCHO_WORKER_URL || '').trim().replace(/\/+$/, '');
  const oldToken = String(process.env.BOTGUINCHO_ADMIN_TOKEN || '').trim();
  if (!oldUrl || !oldToken) throw new Error('legacy_worker_env_missing');

  const sandbox = await ensureWorkerSandbox(DEFAULT_CLIENT_ID);
  await sandbox.runCommand({
    cmd: 'bash',
    args: ['-lc', "pkill -f '[n]ode tools/vercel-whatsapp-worker.mjs' >/dev/null 2>&1 || true"],
    signal: AbortSignal.timeout(8000),
  }).catch(() => undefined);

  const migrationScript = String.raw\`
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const base = String(process.env.OLD_URL || '').replace(/\\/+$/, '');
const token = process.env.OLD_TOKEN || '';
const clientDir = '/vercel/sandbox/.botguincho-data/cliente-teste';

async function fetchJson(route) {
  const response = await fetch(base + route, {
    headers: { 'x-botguincho-token': token, 'content-type': 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(15000),
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!response.ok) throw new Error(route + ': HTTP ' + response.status + ' ' + JSON.stringify(data).slice(0,500));
  return data;
}

async function writeJson(name, value) {
  await fs.writeFile(path.join(clientDir, name), JSON.stringify(value, null, 2), { mode: 0o600 });
}

(async () => {
  await fs.mkdir(clientDir, { recursive: true });
  const backupDir = path.join(clientDir, 'pre-vps-migration-' + Date.now());
  await fs.mkdir(backupDir, { recursive: true });

  const filesToBackup = [
    'settings.json','management.json','groups.json','group-registry.json',
    'group-knowledge.json','learning-history.jsonl','learning-index.json',
    'gconnect-reading.json','audit.jsonl','test-center.json'
  ];
  for (const name of filesToBackup) {
    await fs.copyFile(path.join(clientDir, name), path.join(backupDir, name)).catch(() => undefined);
  }

  const [settingsRaw, managementRaw, groupsRaw, knowledgeRaw, trackerRaw, auditRaw, testRaw, learningRaw] =
    await Promise.all([
      fetchJson('/api/settings'),
      fetchJson('/api/management'),
      fetchJson('/api/groups'),
      fetchJson('/api/group-knowledge'),
      fetchJson('/api/tracker'),
      fetchJson('/api/audit?limit=200'),
      fetchJson('/api/test-center'),
      fetchJson('/api/learning/summary'),
    ]);

  const settings = { ...(settingsRaw || {}) };
  delete settings.apiKeyConfigured;

  const management = managementRaw?.data || {};
  const groups = Array.isArray(groupsRaw?.groups) ? groupsRaw.groups : [];
  const knowledgeGroups = Array.isArray(knowledgeRaw?.groups) ? knowledgeRaw.groups : [];
  const learningGroups = Array.isArray(learningRaw?.groups) ? learningRaw.groups : [];

  const selected = new Set();
  for (const g of groups) if (g?.selected && g?.id) selected.add(g.id);
  for (const g of learningGroups) if (g?.groupId) selected.add(g.groupId);
  for (const g of knowledgeGroups) if (g?.groupId) selected.add(g.groupId);

  const registry = {};
  for (const g of groups) {
    if (!g?.id) continue;
    registry[g.id] = {
      id: g.id,
      name: g.name || 'Grupo do WhatsApp',
      description: g.description || '',
      lastSeenAt: g.lastSeenAt || new Date().toISOString(),
    };
  }
  for (const g of knowledgeGroups) {
    if (!g?.groupId || registry[g.groupId]) continue;
    registry[g.groupId] = {
      id: g.groupId,
      name: g.name || 'Grupo do WhatsApp',
      description: g.description || '',
      lastSeenAt: g.updatedAt || new Date().toISOString(),
    };
  }

  const knowledge = {};
  for (const g of knowledgeGroups) if (g?.groupId) knowledge[g.groupId] = g;

  const historyRows = [];
  for (const groupId of selected) {
    let offset = 0;
    while (true) {
      const page = await fetchJson('/api/learning/export-history?groupId=' + encodeURIComponent(groupId) + '&offset=' + offset + '&limit=1500');
      const rows = Array.isArray(page?.rows) ? page.rows : [];
      historyRows.push(...rows);
      offset += rows.length;
      if (!rows.length || offset >= Number(page?.total || 0)) break;
    }
  }

  historyRows.sort((a,b) => new Date(a?.at || 0) - new Date(b?.at || 0));
  const index = {};
  for (const row of historyRows) {
    if (!row.id) {
      row.id = crypto.createHash('sha1').update(
        String(row.at || '') + '|' + String(row.groupId || '') + '|' + String(row.direction || '') + '|' + String(row.text || '')
      ).digest('hex');
    }
    index[row.id] = row.at || new Date().toISOString();
  }

  await writeJson('settings.json', settings);
  await writeJson('management.json', management);
  await writeJson('groups.json', { groupIds: [...selected] });
  await writeJson('group-registry.json', registry);
  await writeJson('group-knowledge.json', knowledge);
  await fs.writeFile(path.join(clientDir, 'learning-history.jsonl'),
    historyRows.map(row => JSON.stringify(row)).join('\\n') + (historyRows.length ? '\\n' : ''), { mode: 0o600 });
  await writeJson('learning-index.json', index);

  if (trackerRaw?.lastLocation) await writeJson('gconnect-reading.json', trackerRaw.lastLocation);

  const auditEntries = Array.isArray(auditRaw?.entries) ? auditRaw.entries.slice().reverse() : [];
  await fs.writeFile(path.join(clientDir, 'audit.jsonl'),
    auditEntries.map(row => JSON.stringify(row)).join('\\n') + (auditEntries.length ? '\\n' : ''), { mode: 0o600 });

  await writeJson('test-center.json', { history: Array.isArray(testRaw?.history) ? testRaw.history : [] });

  process.stdout.write(JSON.stringify({
    ok: true,
    backupDir,
    counts: {
      calls: Array.isArray(management?.calls) ? management.calls.length : 0,
      clients: Array.isArray(management?.clients) ? management.clients.length : 0,
      insurers: Array.isArray(management?.insurers) ? management.insurers.length : 0,
      finance: Array.isArray(management?.finance) ? management.finance.length : 0,
      fleet: Array.isArray(management?.fleet) ? management.fleet.length : 0,
      billingProfiles: Array.isArray(management?.billingProfiles) ? management.billingProfiles.length : 0,
      billingBatches: Array.isArray(management?.billingBatches) ? management.billingBatches.length : 0,
      driverPayrolls: Array.isArray(management?.driverPayrolls) ? management.driverPayrolls.length : 0,
      groupsDiscovered: groups.length,
      groupsSelected: selected.size,
      knowledgeGroups: knowledgeGroups.length,
      historyRows: historyRows.length,
      auditEntries: auditEntries.length,
      testRuns: Array.isArray(testRaw?.history) ? testRaw.history.length : 0,
      trackerCopied: Boolean(trackerRaw?.lastLocation),
    },
  }));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
\`;

  const result = await sandbox.runCommand({
    cmd: 'node',
    args: ['-e', migrationScript],
    env: { OLD_URL: oldUrl, OLD_TOKEN: oldToken },
    signal: AbortSignal.timeout(55000),
  });

  let stdout = '';
  let stderr = '';
  try { stdout = await result.stdout(); } catch {}
  try { stderr = await result.stderr(); } catch {}

  if (result.exitCode !== 0) {
    await maintainWorker(process.env.VERCEL_OIDC_TOKEN || process.env.AI_GATEWAY_API_KEY || '', DEFAULT_CLIENT_ID).catch(() => undefined);
    throw new Error('migration_command_failed: ' + stderr.slice(-2000));
  }

  const restarted = await maintainWorker(
    process.env.VERCEL_OIDC_TOKEN || process.env.AI_GATEWAY_API_KEY || '',
    DEFAULT_CLIENT_ID
  );

  let summary = {};
  try { summary = JSON.parse(stdout || '{}'); } catch { summary = { raw: stdout.slice(-4000) }; }
  return { ...summary, restarted };
}
