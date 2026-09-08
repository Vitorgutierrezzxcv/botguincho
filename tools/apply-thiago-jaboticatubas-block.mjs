import fs from 'node:fs';

const file = 'tools/vercel-whatsapp-worker.mjs';
let source = fs.readFileSync(file, 'utf8');

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

if (source.includes(oldBlock)) {
  source = source.replace(oldBlock, newBlock);
}

// Correção emergencial: a checagem de área excluída não pode usar dados antigos da
// corrida anterior para mensagens curtas como "Bora", "Ok" ou "Pode seguir".
// Só bloqueamos por área quando a própria mensagem atual traz Origem/Destino
// explicitamente (ou uma localização compartilhada), evitando falso "fora de rota".
const oldGate = `    const canBeRejectedByArea = ['availability','quote','dispatch_details','incomplete_dispatch','protocol_received','authorization','formal_dispatch','scheduled_dispatch'].includes(runtimeIntent);`;
const newGate = `    const hasExplicitAreaAddress = /\\b(origem|destino)\\b\\s*[:=\\-]?/i.test(String(readableText || '')) || Boolean(incomingLocation);\n    const canBeRejectedByArea = hasExplicitAreaAddress && ['availability','quote','dispatch_details','incomplete_dispatch','protocol_received','authorization','formal_dispatch','scheduled_dispatch'].includes(runtimeIntent);`;

if (source.includes(oldGate)) {
  source = source.replace(oldGate, newGate);
} else if (!source.includes('const hasExplicitAreaAddress =')) {
  throw new Error('Gate de area excluida nao encontrado; patch de seguranca nao aplicado.');
}

fs.writeFileSync(file, source);
console.log('Bloqueio de Jaboticatubas aplicado e falso fora de rota corrigido.');
