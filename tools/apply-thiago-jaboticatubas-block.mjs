import fs from 'node:fs';

const file = 'tools/vercel-whatsapp-worker.mjs';
let source = fs.readFileSync(file, 'utf8');

if (source.includes("Regra operacional específica do perfil Thiago: Jaboticatubas/MG")) {
  console.log('Bloqueio de Jaboticatubas para Thiago já aplicado.');
  process.exit(0);
}

const oldBlock = `async function getSettings() {
  const saved = await readJson(settingsFile, {});
  const next = { ...DEFAULT_SETTINGS, ...saved };
  if (clientId === 'cliente-teste' && !String(next.operationalBaseAddress || '').trim()) {
    next.operationalBaseAddress = LEGACY_AMERICA_BASE_ADDRESS;
    await writeJson(settingsFile, next).catch(() => undefined);
  }
  return next;
}`;

const newBlock = `async function getSettings() {
  const saved = await readJson(settingsFile, {});
  const next = { ...DEFAULT_SETTINGS, ...saved };

  // Regra operacional específica do perfil Thiago: Jaboticatubas/MG é área proibida
  // tanto para origem quanto para destino, sem afetar os demais perfis/tenants.
  const normalizeIdentity = (value = '') => String(value || '')
    .normalize('NFD')
    .replace(/[\\u0300-\\u036f]/g, '')
    .toLowerCase();
  const profileIdentity = [
    clientId,
    next.profileName,
    next.ownerName,
    next.companyName,
    next.driverName,
  ].map(normalizeIdentity).join(' ');

  if (profileIdentity.includes('thiago')) {
    const areas = sanitizeExcludedAreas(next.excludedAreas || []);
    const jaboticatubasKey = 'jaboticatubas';
    const withoutOldJaboticatubas = areas.filter((area) => !(
      area.type === 'city' && normalizeIdentity(area.name) === jaboticatubasKey
    ));
    next.excludedAreas = sanitizeExcludedAreas([
      ...withoutOldJaboticatubas,
      { type: 'city', name: 'Jaboticatubas', scope: 'both' },
    ]);

    const changed = JSON.stringify(next.excludedAreas) !== JSON.stringify(areas);
    if (changed) await writeJson(settingsFile, next).catch(() => undefined);
  }

  if (clientId === 'cliente-teste' && !String(next.operationalBaseAddress || '').trim()) {
    next.operationalBaseAddress = LEGACY_AMERICA_BASE_ADDRESS;
    await writeJson(settingsFile, next).catch(() => undefined);
  }
  return next;
}`;

if (!source.includes(oldBlock)) {
  throw new Error('Bloco getSettings esperado não foi encontrado; patch de Jaboticatubas não aplicado.');
}

source = source.replace(oldBlock, newBlock);
fs.writeFileSync(file, source);
console.log('Bloqueio de Jaboticatubas para Thiago aplicado com sucesso.');
