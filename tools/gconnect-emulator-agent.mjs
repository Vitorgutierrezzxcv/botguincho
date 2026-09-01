#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile } from 'node:fs/promises';

const execFileAsync = promisify(execFile);
const APP_PACKAGE = process.env.GCONNECT_PACKAGE || 'br.com.getrak.gconnect';
const PLATE = (process.env.GCONNECT_PLATE || 'GSW0H17').toUpperCase().replace(/[^A-Z0-9]/g, '');
const BRIDGE_URL = process.env.BOTGUINCHO_BRIDGE_URL || 'https://botguincho.vercel.app/api/worker/tracker-bridge';
const PAIR_CODE = (process.env.BOTGUINCHO_PAIR_CODE || '').trim().toUpperCase();
const POLL_SECONDS = Math.max(10, Number(process.env.GCONNECT_POLL_SECONDS || 20));
const CONFIGURED_SERIAL = (process.env.GCONNECT_ADB_SERIAL || '').trim();
const HEARTBEAT_FILE = process.env.GCONNECT_HEARTBEAT_FILE || '/tmp/botguincho-gconnect-heartbeat';
const MAX_CONSECUTIVE_FAILURES = Math.max(2, Number(process.env.GCONNECT_MAX_FAILURES || 4));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let cachedSerial = CONFIGURED_SERIAL;
let announcedSerial = '';
let consecutiveFailures = 0;

async function execAdbRaw(args, timeout = 30000) {
  const { stdout = '', stderr = '' } = await execFileAsync('adb', args, {
    timeout,
    maxBuffer: 10 * 1024 * 1024,
  });
  return `${stdout}${stderr}`.trim();
}

async function connectedSerials() {
  const out = await execAdbRaw(['devices']);
  return out
    .split('\n')
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => /\tdevice$/.test(line))
    .map((line) => line.split(/\s+/)[0]);
}

async function hasGConnect(serial) {
  try {
    const out = await execAdbRaw(['-s', serial, 'shell', 'pm', 'path', APP_PACKAGE], 10000);
    return out.includes('package:');
  } catch {
    return false;
  }
}

async function screenContainsPlate(serial) {
  try {
    const path = '/data/local/tmp/gconnect-select.xml';
    await execAdbRaw(['-s', serial, 'shell', 'uiautomator', 'dump', '--compressed', path], 15000);
    const xml = await execAdbRaw(['-s', serial, 'shell', 'cat', path], 10000);
    return xml.toUpperCase().includes(PLATE);
  } catch {
    return false;
  }
}

async function resolveAdbSerial(force = false) {
  const serials = await connectedSerials();
  if (!serials.length) throw new Error('Nenhum Android conectado ao ADB.');

  if (!force && cachedSerial && serials.includes(cachedSerial)) return cachedSerial;

  if (CONFIGURED_SERIAL) {
    if (!serials.includes(CONFIGURED_SERIAL)) {
      throw new Error(`Android configurado ${CONFIGURED_SERIAL} não está conectado. Conectados: ${serials.join(', ')}`);
    }
    cachedSerial = CONFIGURED_SERIAL;
    return cachedSerial;
  }

  if (serials.length === 1) {
    cachedSerial = serials[0];
    return cachedSerial;
  }

  const withApp = [];
  for (const serial of serials) {
    if (await hasGConnect(serial)) withApp.push(serial);
  }

  if (withApp.length === 1) {
    cachedSerial = withApp[0];
    return cachedSerial;
  }

  if (withApp.length > 1) {
    for (const serial of withApp) {
      if (await screenContainsPlate(serial)) {
        cachedSerial = serial;
        return cachedSerial;
      }
    }
    cachedSerial = withApp[0];
    console.warn(`Mais de um Android possui o GConnect (${withApp.join(', ')}). Usando ${cachedSerial}.`);
    return cachedSerial;
  }

  throw new Error(`Há ${serials.length} Androids conectados, mas nenhum contém ${APP_PACKAGE}.`);
}

async function adb(...args) {
  let serial = await resolveAdbSerial();
  try {
    const out = await execAdbRaw(['-s', serial, ...args]);
    if (announcedSerial !== serial) {
      announcedSerial = serial;
      console.log(`ADB selecionado: ${serial}`);
    }
    return out;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/device .* not found|device offline|more than one device\/emulator/i.test(message)) {
      cachedSerial = '';
      serial = await resolveAdbSerial(true);
      return execAdbRaw(['-s', serial, ...args]);
    }
    throw error;
  }
}

function decodeXml(v = '') {
  return String(v)
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function extractAttributes(xml) {
  const nodes = [];
  const re = /<node\b([^>]*)\/?>(?:<\/node>)?/g;
  let m;
  while ((m = re.exec(xml))) {
    const a = {};
    const ar = /([\w:-]+)="([^"]*)"/g;
    let x;
    while ((x = ar.exec(m[1]))) a[x[1]] = decodeXml(x[2]);
    nodes.push(a);
  }
  return nodes;
}

function numberFrom(text) {
  const raw = String(text || '').replace(/[^0-9,.-]/g, '');
  if (!raw) return null;
  let n = raw;
  if (raw.includes(',') && raw.includes('.')) {
    n = raw.lastIndexOf('.') > raw.lastIndexOf(',')
      ? raw.replace(/,/g, '')
      : raw.replace(/\./g, '').replace(',', '.');
  } else if (raw.includes(',') && !raw.includes('.')) {
    n = raw.replace(',', '.');
  }
  const v = Number(n);
  return Number.isFinite(v) ? v : null;
}

function boundsCenter(bounds = '') {
  const m = String(bounds).match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
  if (!m) return null;
  return { x: Math.round((+m[1] + +m[3]) / 2), y: Math.round((+m[2] + +m[4]) / 2) };
}

function parseCardDescription(desc) {
  const text = String(desc || '').trim();
  const r = {};
  const plate = text.match(/\b[A-Z]{3}[0-9][A-Z0-9][0-9]{2}\b/i)?.[0];
  if (plate) r.plate = plate.toUpperCase();
  const state = text.match(/,\s*(on|off|no ignition)\s*,/i)?.[1];
  if (state) r.ignition = state.toLowerCase();
  const speed = text.match(/Speed\s*,\s*([0-9.,]+)\s*km\/h/i)?.[1];
  if (speed) r.speedKph = numberFrom(speed);
  const odo = text.match(/Odometer\s*,\s*([0-9.,]+)\s*km/i)?.[1];
  if (odo) r.odometerKm = numberFrom(odo);
  const bat = text.match(/Battery\s*,\s*([0-9.,]+)\s*V/i)?.[1];
  if (bat) r.batteryVoltage = numberFrom(bat);
  const addr = text.match(/Battery\s*,\s*[0-9.,]+\s*V\s*,\s*(.+?)\s*,\s*Last update on\s+(.+?)(?:\s*,\s*Active security options:|$)/i);
  if (addr) { r.address = addr[1].trim(); r.lastUpdateText = addr[2].trim(); }
  return r;
}

function parseUiDump(xml) {
  const nodes = extractAttributes(xml);
  const plateNode = nodes.find((n) => String(n['content-desc'] || '').toUpperCase().includes(PLATE));
  const card = parseCardDescription(plateNode?.['content-desc'] || '');
  if (!card.plate && nodes.some((n) => String(n.text || '').toUpperCase() === PLATE)) card.plate = PLATE;
  const texts = nodes.map((n) => n.text).filter(Boolean);
  if (card.speedKph == null) { const v = texts.find((t) => /km\/h$/i.test(t)); if (v) card.speedKph = numberFrom(v); }
  if (card.batteryVoltage == null) { const v = texts.find((t) => /\d(?:[.,]\d+)?\s*V$/i.test(t)); if (v) card.batteryVoltage = numberFrom(v); }
  if (card.odometerKm == null) { const v = texts.find((t) => /km$/i.test(t) && !/km\/h$/i.test(t) && /[0-9]/.test(t)); if (v) card.odometerKm = numberFrom(v); }
  if (!card.lastUpdateText) { const v = texts.find((t) => /^Last update on /i.test(t)); if (v) card.lastUpdateText = v.replace(/^Last update on\s*/i, ''); }
  if (!card.address) {
    const c = texts.filter((t) => t.length > 20 && !/^Last update/i.test(t) && !/security/i.test(t));
    card.address = c.find((t) => /,/.test(t) && /[A-Za-zÀ-ÿ]/.test(t)) || null;
  }
  return { provider: 'gconnect-emulator', plate: card.plate || PLATE, ignition: card.ignition || null, speedKph: card.speedKph ?? null, odometerKm: card.odometerKm ?? null, batteryVoltage: card.batteryVoltage ?? null, address: card.address || null, lastUpdateText: card.lastUpdateText || null, capturedAt: new Date().toISOString() };
}

function visibleLabels(xml) {
  return extractAttributes(xml)
    .flatMap((node) => [node.text, node['content-desc']])
    .map((value) => String(value || '').trim())
    .filter(Boolean);
}

function isLoadingOnly(xml) {
  const nodes = extractAttributes(xml);
  if (!nodes.some((node) => /ProgressBar$/i.test(String(node.class || '')))) return false;
  return visibleLabels(xml).length === 0;
}

function isLoginScreen(xml) {
  const labels = visibleLabels(xml).join(' | ');
  return /\b(login|sign in|entrar|acessar)\b/i.test(labels) && !xml.toUpperCase().includes(PLATE);
}

function uiSummary(xml) {
  const labels = visibleLabels(xml).slice(0, 8);
  return labels.length ? labels.join(' | ') : 'sem textos acessíveis';
}

async function dumpUi() {
  const path = '/data/local/tmp/gconnect-bot.xml';
  await adb('shell', 'uiautomator', 'dump', '--compressed', path);
  return adb('shell', 'cat', path);
}

async function launchApp() {
  await adb('shell', 'monkey', '-p', APP_PACKAGE, '-c', 'android.intent.category.LAUNCHER', '1');
}

async function forceRestartApp() {
  console.warn('GConnect preso em carregamento. Reiniciando somente o aplicativo, sem apagar dados.');
  await adb('shell', 'am', 'force-stop', APP_PACKAGE).catch(() => {});
  await sleep(1000);
  await launchApp();
  await sleep(7000);
}

async function recoverLoadingIfNeeded(xml) {
  if (!isLoadingOnly(xml)) return xml;

  // Dá uma chance ao carregamento normal antes de intervir.
  await sleep(5000);
  let current = await dumpUi();
  if (!isLoadingOnly(current)) return current;

  await forceRestartApp();
  current = await dumpUi();
  if (!isLoadingOnly(current)) return current;

  // Uma segunda espera evita reiniciar o Android por uma abertura apenas lenta.
  await sleep(7000);
  return dumpUi();
}

async function wakeAndOpen() {
  await resolveAdbSerial();
  await adb('shell', 'input', 'keyevent', 'KEYCODE_WAKEUP').catch(() => {});
  await adb('shell', 'wm', 'dismiss-keyguard').catch(() => {});
  const current = await adb('shell', 'dumpsys', 'window', 'windows');
  if (!current.includes(APP_PACKAGE)) {
    await launchApp();
    await sleep(3500);
  }
}

async function navigateToListIfNeeded(xml) {
  if (xml.toUpperCase().includes(PLATE)) return xml;
  const nodes = extractAttributes(xml);
  const list = nodes.find((n) => {
    const label = `${n['content-desc'] || ''} ${n.text || ''}`.trim().toLowerCase();
    return /^(list|lista|vehicles?|ve[ií]culos?)$/.test(label) || /vehicle list|lista de ve[ií]culos/.test(label);
  });
  const p = boundsCenter(list?.bounds);
  if (p) {
    await adb('shell', 'input', 'tap', String(p.x), String(p.y));
    await sleep(1800);
    return recoverLoadingIfNeeded(await dumpUi());
  }

  // Se caiu em detalhe/mapa/subtela, voltar uma vez costuma recuperar a lista.
  await adb('shell', 'input', 'keyevent', 'KEYCODE_BACK').catch(() => {});
  await sleep(1200);
  let afterBack = await recoverLoadingIfNeeded(await dumpUi());
  if (afterBack.toUpperCase().includes(PLATE)) return afterBack;

  await launchApp();
  await sleep(3500);
  afterBack = await recoverLoadingIfNeeded(await dumpUi());
  return afterBack;
}

async function filterPlateIfNeeded(xml) {
  if (xml.toUpperCase().includes(PLATE)) return xml;
  const nodes = extractAttributes(xml);
  const field = nodes.find((n) => {
    const label = `${n.text || ''} ${n['content-desc'] || ''}`;
    return /filter for a vehicle|search vehicle|filtrar.*ve[ií]culo|buscar.*ve[ií]culo/i.test(label);
  });
  const p = boundsCenter(field?.bounds);
  if (!p) return xml;
  await adb('shell', 'input', 'tap', String(p.x), String(p.y));
  await sleep(300);
  await adb('shell', 'input', 'keyevent', 'KEYCODE_MOVE_END').catch(() => {});
  await adb('shell', 'input', 'keyevent', 'KEYCODE_CTRL_A').catch(() => {});
  await adb('shell', 'input', 'text', PLATE);
  await sleep(1500);
  return recoverLoadingIfNeeded(await dumpUi());
}

async function readLocation() {
  await wakeAndOpen();
  let xml = await recoverLoadingIfNeeded(await dumpUi());

  if (isLoadingOnly(xml)) {
    throw new Error('GConnect permaneceu preso na tela de carregamento mesmo após reiniciar o aplicativo.');
  }
  if (isLoginScreen(xml)) {
    throw new Error(`GConnect exige autenticação novamente. Tela: ${uiSummary(xml)}`);
  }

  xml = await navigateToListIfNeeded(xml);
  xml = await recoverLoadingIfNeeded(xml);
  xml = await filterPlateIfNeeded(xml);
  xml = await recoverLoadingIfNeeded(xml);

  if (isLoadingOnly(xml)) {
    throw new Error('GConnect permaneceu preso na tela de carregamento durante a navegação.');
  }
  if (isLoginScreen(xml)) {
    throw new Error(`GConnect exige autenticação novamente. Tela: ${uiSummary(xml)}`);
  }

  const reading = parseUiDump(xml);
  if (!xml.toUpperCase().includes(PLATE)) {
    throw new Error(`Veículo ${PLATE} não apareceu na tela atual do GConnect. Tela: ${uiSummary(xml)}`);
  }
  if (!reading.address && reading.speedKph == null && reading.batteryVoltage == null) {
    throw new Error(`GConnect aberto, mas o cartão do veículo não trouxe dados legíveis. Tela: ${uiSummary(xml)}`);
  }
  return reading;
}

async function sendReading(reading) {
  if (!PAIR_CODE) throw new Error('BOTGUINCHO_PAIR_CODE não configurado no agente.');
  const r = await fetch(BRIDGE_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-botguincho-pair-code': PAIR_CODE, 'x-botguincho-agent': 'gconnect-emulator-v4' },
    body: JSON.stringify(reading),
    signal: AbortSignal.timeout(20000),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`Bridge HTTP ${r.status}: ${t.slice(0, 500)}`);
  await writeFile(HEARTBEAT_FILE, `${Date.now()}\n`, 'utf8').catch(() => {});
}

async function cycle() {
  const reading = await readLocation();
  await sendReading(reading);
  consecutiveFailures = 0;
  console.log(`[${new Date().toISOString()}] ${reading.plate} | ${reading.ignition || '?'} | ${reading.speedKph ?? '?'} km/h | ${reading.address || 'sem endereço'}`);
}

async function main() {
  console.log(`GConnect Android Agent v4 iniciado. placa=${PLATE} intervalo=${POLL_SECONDS}s maxFalhas=${MAX_CONSECUTIVE_FAILURES}`);
  while (true) {
    try {
      await cycle();
    } catch (e) {
      consecutiveFailures += 1;
      console.error(`[${new Date().toISOString()}] falha ${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}: ${e instanceof Error ? e.message : String(e)}`);
      cachedSerial = '';
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        console.error('Falhas consecutivas excedidas. Encerrando para o systemd reiniciar o agente; watchdog cuidará do Android se não houver heartbeat.');
        process.exit(42);
      }
    }
    await sleep(POLL_SECONDS * 1000);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
