#!/usr/bin/env node
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const APP_PACKAGE = process.env.GCONNECT_PACKAGE || 'br.com.getrak.gconnect';
const PLATE = (process.env.GCONNECT_PLATE || 'GSW0H17').toUpperCase().replace(/[^A-Z0-9]/g, '');
const BRIDGE_URL = process.env.BOTGUINCHO_BRIDGE_URL || 'https://botguincho.vercel.app/api/tracker-bridge';
const BRIDGE_TOKEN = process.env.BOTGUINCHO_BRIDGE_TOKEN || '';
const POLL_SECONDS = Math.max(10, Number(process.env.GCONNECT_POLL_SECONDS || 20));

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function adb(...args) {
  const { stdout = '', stderr = '' } = await execFileAsync('adb', args, { timeout: 30_000, maxBuffer: 10 * 1024 * 1024 });
  return `${stdout}${stderr}`.trim();
}

function decodeXml(value = '') {
  return String(value)
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function extractAttributes(xml) {
  const nodes = [];
  const re = /<node\b([^>]*)\/?>(?:<\/node>)?/g;
  let match;
  while ((match = re.exec(xml))) {
    const attrs = {};
    const ar = /([\w:-]+)="([^"]*)"/g;
    let a;
    while ((a = ar.exec(match[1]))) attrs[a[1]] = decodeXml(a[2]);
    nodes.push(attrs);
  }
  return nodes;
}

function numberFrom(text) {
  const raw = String(text || '').replace(/[^0-9,.-]/g, '');
  if (!raw) return null;
  let normalized = raw;
  if (raw.includes(',') && raw.includes('.')) {
    normalized = raw.lastIndexOf('.') > raw.lastIndexOf(',') ? raw.replace(/,/g, '') : raw.replace(/\./g, '').replace(',', '.');
  } else if (raw.includes(',') && !raw.includes('.')) normalized = raw.replace(',', '.');
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function parseCardDescription(desc) {
  const text = String(desc || '').trim();
  const result = { rawDescription: text };
  if (!text) return result;

  const plate = text.match(/\b[A-Z]{3}[0-9][A-Z0-9][0-9]{2}\b/i)?.[0];
  if (plate) result.plate = plate.toUpperCase();
  const state = text.match(/,\s*(on|off|no ignition)\s*,/i)?.[1];
  if (state) result.ignition = state.toLowerCase();
  const speed = text.match(/Speed\s*,\s*([0-9.,]+)\s*km\/h/i)?.[1];
  if (speed) result.speedKph = numberFrom(speed);
  const odo = text.match(/Odometer\s*,\s*([0-9.,]+)\s*km/i)?.[1];
  if (odo) result.odometerKm = numberFrom(odo);
  const battery = text.match(/Battery\s*,\s*([0-9.,]+)\s*V/i)?.[1];
  if (battery) result.batteryVoltage = numberFrom(battery);

  const addressMatch = text.match(/Battery\s*,\s*[0-9.,]+\s*V\s*,\s*(.+?)\s*,\s*Last update on\s+(.+?)(?:\s*,\s*Active security options:|$)/i);
  if (addressMatch) {
    result.address = addressMatch[1].trim();
    result.lastUpdateText = addressMatch[2].trim();
  } else {
    const last = text.match(/Last update on\s+(.+?)(?:\s*,\s*Active security options:|$)/i)?.[1];
    if (last) result.lastUpdateText = last.trim();
  }
  return result;
}

function parseUiDump(xml) {
  const nodes = extractAttributes(xml);
  const plateNode = nodes.find((n) => String(n['content-desc'] || '').toUpperCase().includes(PLATE));
  const card = parseCardDescription(plateNode?.['content-desc'] || '');
  if (!card.plate) {
    const textNode = nodes.find((n) => String(n.text || '').toUpperCase() === PLATE);
    if (textNode) card.plate = PLATE;
  }

  const texts = nodes.map((n) => n.text).filter(Boolean);
  if (card.speedKph == null) {
    const speed = texts.find((t) => /km\/h$/i.test(t));
    if (speed) card.speedKph = numberFrom(speed);
  }
  if (card.batteryVoltage == null) {
    const battery = texts.find((t) => /\d(?:[.,]\d+)?\s*V$/i.test(t));
    if (battery) card.batteryVoltage = numberFrom(battery);
  }
  if (card.odometerKm == null) {
    const odometer = texts.find((t) => /km$/i.test(t) && !/km\/h$/i.test(t) && /[0-9]/.test(t));
    if (odometer) card.odometerKm = numberFrom(odometer);
  }
  if (!card.lastUpdateText) {
    const last = texts.find((t) => /^Last update on /i.test(t));
    if (last) card.lastUpdateText = last.replace(/^Last update on\s*/i, '');
  }
  if (!card.address) {
    const candidates = texts.filter((t) => t.length > 20 && !/^Last update/i.test(t) && !/security/i.test(t));
    card.address = candidates.find((t) => /,/.test(t) && /[A-Za-zÀ-ÿ]/.test(t)) || null;
  }

  return {
    provider: 'gconnect-emulator',
    plate: card.plate || PLATE,
    ignition: card.ignition || null,
    speedKph: card.speedKph ?? null,
    odometerKm: card.odometerKm ?? null,
    batteryVoltage: card.batteryVoltage ?? null,
    address: card.address || null,
    lastUpdateText: card.lastUpdateText || null,
    capturedAt: new Date().toISOString(),
    rawDescription: card.rawDescription || null,
  };
}

async function ensureAppVisible() {
  const devices = await adb('devices');
  const connected = devices.split('\n').slice(1).some((line) => /\tdevice$/.test(line));
  if (!connected) throw new Error('Nenhum Android conectado ao ADB.');

  const current = await adb('shell', 'dumpsys', 'window', 'windows');
  if (!current.includes(APP_PACKAGE)) {
    await adb('shell', 'monkey', '-p', APP_PACKAGE, '-c', 'android.intent.category.LAUNCHER', '1');
    await sleep(2500);
  }
}

async function readLocation() {
  await ensureAppVisible();
  await adb('shell', 'uiautomator', 'dump', '/sdcard/gconnect-bot.xml');
  const xml = await adb('shell', 'cat', '/sdcard/gconnect-bot.xml');
  const reading = parseUiDump(xml);
  if (!reading.plate || reading.plate !== PLATE) {
    throw new Error(`Veículo ${PLATE} não apareceu na tela atual do GConnect.`);
  }
  if (!reading.address && reading.speedKph == null && reading.batteryVoltage == null) {
    throw new Error('GConnect aberto, mas o cartão do veículo não trouxe dados legíveis pelo UIAutomator.');
  }
  return reading;
}

async function sendReading(reading) {
  if (!BRIDGE_TOKEN) throw new Error('BOTGUINCHO_BRIDGE_TOKEN não configurado no agente.');
  const body = JSON.stringify(reading);
  const signature = crypto.createHmac('sha256', BRIDGE_TOKEN).update(body).digest('hex');
  const response = await fetch(BRIDGE_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-botguincho-signature': signature,
      'x-botguincho-agent': 'gconnect-emulator-v1',
    },
    body,
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Bridge HTTP ${response.status}: ${text.slice(0, 500)}`);
  return text;
}

async function cycle() {
  const reading = await readLocation();
  await sendReading(reading);
  console.log(`[${new Date().toISOString()}] ${reading.plate} | ${reading.ignition || '?'} | ${reading.speedKph ?? '?'} km/h | ${reading.address || 'sem endereço'}`);
}

async function main() {
  console.log(`GConnect Android Agent iniciado. placa=${PLATE} intervalo=${POLL_SECONDS}s`);
  while (true) {
    try { await cycle(); }
    catch (error) { console.error(`[${new Date().toISOString()}] ${error instanceof Error ? error.message : String(error)}`); }
    await sleep(POLL_SECONDS * 1000);
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
