import fs from 'node:fs/promises';
import path from 'node:path';

const dataDir = process.env.BOTGUINCHO_DATA_DIR || '/data';
const clientId = process.env.WHATSAPP_CLIENT_ID || 'cliente-teste';
const clientDir = path.join(dataDir, clientId);
const settingsFile = path.join(clientDir, 'settings.json');
const markerFile = path.join(clientDir, '.rollback-jaboticatubas-20260908.done');

function normalize(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

try {
  await fs.access(markerFile);
  console.log('[rollback] limpeza persistida de Jaboticatubas já executada.');
  process.exit(0);
} catch {}

await fs.mkdir(clientDir, { recursive: true });

let settings = null;
try {
  settings = JSON.parse(await fs.readFile(settingsFile, 'utf8'));
} catch (error) {
  if (error?.code !== 'ENOENT') {
    console.warn('[rollback] settings.json não pôde ser lido:', String(error));
  }
}

if (settings && Array.isArray(settings.excludedAreas)) {
  const before = settings.excludedAreas.length;
  settings.excludedAreas = settings.excludedAreas.filter((area) => {
    const name = normalize(area?.name || area?.city || area?.label || '');
    return name !== 'jaboticatubas';
  });
  const removed = before - settings.excludedAreas.length;
  if (removed > 0) {
    const tmp = `${settingsFile}.tmp-${process.pid}-${Date.now()}`;
    await fs.writeFile(tmp, JSON.stringify(settings, null, 2));
    await fs.rename(tmp, settingsFile);
    console.log(`[rollback] removida(s) ${removed} regra(s) persistida(s) de Jaboticatubas.`);
  } else {
    console.log('[rollback] nenhuma regra persistida de Jaboticatubas encontrada.');
  }
} else {
  console.log('[rollback] settings.json sem excludedAreas persistidas.');
}

await fs.writeFile(markerFile, new Date().toISOString());
