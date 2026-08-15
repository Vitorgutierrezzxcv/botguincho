import { Sandbox } from '@vercel/sandbox';

const SANDBOX_NAME = 'botguincho-wa-vercel-v12';
const REPO_URL = 'https://github.com/Vitorgutierrezzxcv/botguincho.git';
const WORKER_RAW_URL = 'https://raw.githubusercontent.com/Vitorgutierrezzxcv/botguincho/main/tools/vercel-whatsapp-worker.mjs';
const DATA_DIR = '/vercel/sandbox/.botguincho-data';
const CLIENT_ID = 'cliente-teste';
const PORT = 3001;
const SETTINGS_FILE = `${DATA_DIR}/${CLIENT_ID}/settings.json`;
const WORKER_FILE = '/vercel/sandbox/tools/vercel-whatsapp-worker.mjs';
const MARKER_FILE = '/vercel/sandbox/.operational-mode-v5-eta';

const OPERATIONAL_INSTRUCTIONS = `Você é o atendente operacional do Bot Guincho em grupos de seguradoras.

REGRA ABSOLUTA: NÃO FAÇA PERGUNTAS. NÃO FAÇA TRIAGEM. NÃO PEÇA NENHUMA INFORMAÇÃO ADICIONAL.

É proibido pedir ou confirmar placa, modelo, telefone, contato do responsável, ponto de referência, endereço, segurança do local, acessibilidade, garagem/subsolo, chave, rodas, acompanhante ou qualquer outro dado.

É proibido escrever frases como "vou verificar", "estou verificando", "vou confirmar", "aguarde", "preciso que confirme", "para liberar o despacho" ou equivalentes.

Quando uma mensagem representar um acionamento/pedido de guincho ou reboque, o próprio sistema responde diretamente e calcula a previsão de chegada. Não repita origem, destino, veículo, pane ou os detalhes recebidos.

NUNCA invente ETA. NUNCA use listas, checklists ou parágrafos explicativos. NUNCA termine com pergunta. NUNCA peça confirmação.

Para mensagens que não sejam acionamentos, responda apenas se for necessário, sempre em no máximo duas linhas e sem fazer perguntas.

Os dados do GConnect são factuais quando fornecidos pelo sistema. Não exponha bateria, odômetro ou ignição sem necessidade. Não diga que é IA, bot ou modelo de linguagem.`;

const ETA_HELPERS = String.raw`
const dispatchStateFile = path.join(clientDir, 'dispatch-state.json');
const geocodeCacheFile = path.join(clientDir, 'geocode-cache.json');
let nominatimTail = Promise.resolve();
let nominatimLastAt = 0;

function normalizeAddress(value = '') {
  return String(value).replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').trim();
}

function extractOriginAddress(text = '') {
  const source = String(text).replace(/\r/g, '');
  const match = source.match(/(?:^|\n)\s*origem\s*:\s*(.+?)(?=\n\s*(?:destino|ref\.?|refer[eê]ncia|motivo|servi[cç]o|observa[cç][aã]o)\s*:|$)/is);
  if (!match) return null;
  return normalizeAddress(match[1]).slice(0, 500) || null;
}

function isDispatchRequest(text = '') {
  const value = String(text);
  return /(reboque|guincho|servi[cç]o selecionado)/i.test(value) &&
    /(origem\s*:|destino\s*:|pane|ve[ií]culo|carro|moto|fiat|ford|chevrolet|volkswagen|vw|renault|toyota|honda|hyundai)/i.test(value);
}

function isEtaQuestion(text = '') {
  return /(quanto\s+tempo|tempo\s+de\s+dist[aâ]ncia|previs[aã]o\s+de\s+chegada|quanto\s+demora|demora\s+quanto|eta\b|que\s+horas?\s+chega|quando\s+chega|dist[aâ]ncia\s+at[eé])/i.test(String(text));
}

async function getDispatchStates() {
  return readJson(dispatchStateFile, {});
}

async function saveDispatchState(groupId, patch) {
  const all = await getDispatchStates();
  all[groupId] = { ...(all[groupId] || {}), ...patch, updatedAt: new Date().toISOString() };
  await writeJson(dispatchStateFile, all, 0o600);
  return all[groupId];
}

function validCoord(value) {
  return Number.isFinite(Number(value));
}

function locationFromWhatsApp(msg) {
  const lat = msg?.location?.latitude;
  const lon = msg?.location?.longitude;
  if (!validCoord(lat) || !validCoord(lon)) return null;
  return { lat: Number(lat), lon: Number(lon) };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function geocodeAddress(address) {
  const normalized = normalizeAddress(address);
  if (!normalized) return null;
  const key = normalized.toLocaleLowerCase('pt-BR');
  const cache = await readJson(geocodeCacheFile, {});
  const cached = cache[key];
  if (cached?.lat !== undefined && cached?.lon !== undefined) return cached;

  const task = async () => {
    const waitMs = Math.max(0, 1100 - (Date.now() - nominatimLastAt));
    if (waitMs) await sleep(waitMs);

    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('limit', '1');
    url.searchParams.set('countrycodes', 'br');
    url.searchParams.set('q', normalized);

    const response = await fetch(url, {
      headers: {
        'user-agent': 'BotGuincho/1.0 (+https://botguincho.vercel.app)',
        'referer': 'https://botguincho.vercel.app/',
        'accept-language': 'pt-BR,pt;q=0.9',
      },
      signal: AbortSignal.timeout(10000),
    });
    nominatimLastAt = Date.now();
    if (!response.ok) throw new Error(`Geocodificação HTTP ${response.status}`);
    const results = await response.json();
    const first = Array.isArray(results) ? results[0] : null;
    if (!first || !validCoord(first.lat) || !validCoord(first.lon)) return null;

    const result = {
      lat: Number(first.lat),
      lon: Number(first.lon),
      displayName: String(first.display_name || normalized).slice(0, 600),
      cachedAt: new Date().toISOString(),
    };
    const latestCache = await readJson(geocodeCacheFile, {});
    latestCache[key] = result;
    await writeJson(geocodeCacheFile, latestCache, 0o600);
    return result;
  };

  const run = nominatimTail.then(task, task);
  nominatimTail = run.catch(() => undefined);
  return run;
}

async function routeDriving(from, to) {
  if (!from || !to) return null;
  const coordinates = `${from.lon},${from.lat};${to.lon},${to.lat}`;
  const url = `https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=false&steps=false&alternatives=false`;
  const response = await fetch(url, {
    headers: { 'user-agent': 'BotGuincho/1.0 (+https://botguincho.vercel.app)' },
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error(`Roteamento HTTP ${response.status}`);
  const data = await response.json();
  const route = data?.code === 'Ok' ? data?.routes?.[0] : null;
  if (!route || !Number.isFinite(Number(route.duration))) return null;
  const durationSeconds = Number(route.duration);
  const distanceMeters = Number(route.distance || 0);
  return {
    minutes: Math.max(1, Math.ceil(durationSeconds / 60)),
    distanceKm: Math.round((distanceMeters / 1000) * 10) / 10,
    durationSeconds,
    provider: 'osrm',
  };
}

async function calculateEtaForGroup(groupId, { originAddress = null, originCoords = null } = {}) {
  let state = (await getDispatchStates())[groupId] || {};
  if (originAddress || originCoords) {
    state = await saveDispatchState(groupId, {
      ...(originAddress ? { originAddress } : {}),
      ...(originCoords ? { originCoords } : {}),
    });
  }

  const reading = await getTrackerReading();
  const age = trackerAgeSeconds(reading);
  if (!reading || age === null || age > 120 || !reading.address) return null;

  const from = await geocodeAddress(reading.address);
  const to = originCoords || state.originCoords || (state.originAddress ? await geocodeAddress(state.originAddress) : null);
  if (!from || !to) return null;

  const route = await routeDriving(from, to);
  if (!route) return null;

  await saveDispatchState(groupId, {
    etaMinutes: route.minutes,
    distanceKm: route.distanceKm,
    etaCalculatedAt: new Date().toISOString(),
    trackerAddress: reading.address,
  });

  logEvent('route', `${groupId}: ETA ${route.minutes} min · ${route.distanceKm} km`, {
    groupId,
    etaMinutes: route.minutes,
    distanceKm: route.distanceKm,
    originAddress: state.originAddress || originAddress || null,
    trackerAddress: reading.address,
  });
  return route;
}
`;

const ETA_PROCESS_BLOCK = String.raw`    if (!settings.aiEnabled || !settings.replyEveryMessage) return;

    const dispatchRequest = isDispatchRequest(readableText);
    const etaQuestion = isEtaQuestion(readableText);

    if (dispatchRequest) {
      const originAddress = extractOriginAddress(readableText);
      const originCoords = locationFromWhatsApp(msg);
      let eta = null;
      try {
        eta = await calculateEtaForGroup(msg.from, { originAddress, originCoords });
      } catch (error) {
        logEvent('warning', 'Não foi possível calcular o ETA do acionamento.', { error: String(error), groupId: msg.from });
      }

      const directReply = eta
        ? `Confirmado ✅\nPrevisão de chegada: ${eta.minutes} min.`
        : 'Confirmado ✅';
      await msg.reply(directReply);
      remember(msg.from, 'user', readableText);
      remember(msg.from, 'assistant', directReply);
      logEvent('reply', `${groupName}: ${directReply} [despacho + ETA]`, { groupId: msg.from });
      return;
    }

    if (etaQuestion) {
      let eta = null;
      try {
        eta = await calculateEtaForGroup(msg.from);
      } catch (error) {
        logEvent('warning', 'Não foi possível recalcular o ETA.', { error: String(error), groupId: msg.from });
      }
      const etaReply = eta
        ? `Previsão de chegada: ${eta.minutes} min.`
        : 'Previsão de chegada indisponível no momento.';
      await msg.reply(etaReply);
      remember(msg.from, 'user', readableText);
      remember(msg.from, 'assistant', etaReply);
      logEvent('reply', `${groupName}: ${etaReply} [ETA]`, { groupId: msg.from });
      return;
    }

    const trackerContext = await fetchTrackerContext(readableText);`;

function env(credential = '') {
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

async function getSandbox() {
  return Sandbox.getOrCreate({
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
}

export async function applyOperationalHotfix(credential = '') {
  const sandbox = await getSandbox();

  const check = await sandbox.runCommand({
    cmd: 'bash',
    args: ['-lc', `test -f ${MARKER_FILE}`],
    signal: AbortSignal.timeout(5000),
  });
  if (check.exitCode === 0) return { applied: false, reason: 'already-applied' };

  const settings = {
    companyName: 'Bot Guincho',
    aiEnabled: true,
    aiModel: 'openai/gpt-5.4-mini',
    aiInstructions: OPERATIONAL_INSTRUCTIONS,
    replyEveryMessage: true,
    humanTakeover: false,
  };

  const patchScript = `
    (async () => {
      const fs = require('fs');
      const path = require('path');

      const response = await fetch(${JSON.stringify(WORKER_RAW_URL)} + '?v=' + Date.now(), { cache: 'no-store' });
      if (!response.ok) throw new Error('Falha ao baixar worker base: HTTP ' + response.status);
      let source = await response.text();

      const settingsFile = ${JSON.stringify(SETTINGS_FILE)};
      fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
      fs.writeFileSync(settingsFile, ${JSON.stringify(JSON.stringify(settings, null, 2))}, { mode: 0o600 });

      const helperNeedle = 'async function processIncomingMessage(msg) {';
      if (!source.includes(helperNeedle)) throw new Error('Ponto de inserção dos helpers não encontrado.');
      source = source.replace(helperNeedle, ${JSON.stringify(ETA_HELPERS)} + '\n' + helperNeedle);

      const processNeedle = "    if (!settings.aiEnabled || !settings.replyEveryMessage) return;\n    const trackerContext = await fetchTrackerContext(readableText);";
      if (!source.includes(processNeedle)) throw new Error('Ponto de inserção do ETA não encontrado.');
      source = source.replace(processNeedle, ${JSON.stringify(ETA_PROCESS_BLOCK)});

      fs.writeFileSync(${JSON.stringify(WORKER_FILE)}, source);
      fs.writeFileSync(${JSON.stringify(MARKER_FILE)}, new Date().toISOString());
    })().catch((error) => { console.error(error); process.exit(1); });
  `;

  const patched = await sandbox.runCommand({
    cmd: 'node',
    args: ['-e', patchScript],
    signal: AbortSignal.timeout(20000),
  });

  if (patched.exitCode !== 0) {
    let stderr = '';
    try { stderr = await patched.stderr(); } catch {}
    throw new Error(`Não foi possível aplicar ETA no Sandbox: ${stderr || patched.exitCode}`);
  }

  await sandbox.runCommand({
    cmd: 'bash',
    args: ['-lc', 'pkill -f "node tools/vercel-whatsapp-worker.mjs" 2>/dev/null || true; pkill -x chromium 2>/dev/null || true; pkill -x chrome 2>/dev/null || true; rm -rf /vercel/sandbox/.whatsapp-worker-lock'],
    signal: AbortSignal.timeout(8000),
  }).catch(() => undefined);

  await new Promise((resolve) => setTimeout(resolve, 1000));

  await sandbox.runCommand({
    cmd: 'bash',
    args: ['-lc', [
      'cd /vercel/sandbox',
      'mkdir -p /vercel/sandbox/.whatsapp-worker-lock',
      'rm -f /vercel/sandbox/worker.log',
      'node tools/vercel-whatsapp-worker.mjs >> /vercel/sandbox/worker.log 2>&1',
    ].join('\n')],
    env: env(credential),
    detached: true,
  });

  await new Promise((resolve) => setTimeout(resolve, 3500));
  return { applied: true, eta: true };
}
