import fs from 'node:fs';

function replaceOnce(text, oldValue, newValue, label) {
  const first = text.indexOf(oldValue);
  if (first < 0) throw new Error(`${label}: trecho não encontrado`);
  if (text.indexOf(oldValue, first + oldValue.length) >= 0) throw new Error(`${label}: trecho duplicado`);
  return text.slice(0, first) + newValue + text.slice(first + oldValue.length);
}

function replaceBetween(text, startMarker, endMarker, replacement, label) {
  const start = text.indexOf(startMarker);
  if (start < 0) throw new Error(`${label}: início não encontrado`);
  const end = text.indexOf(endMarker, start);
  if (end < 0) throw new Error(`${label}: fim não encontrado`);
  return text.slice(0, start) + replacement + text.slice(end);
}

{
  const file = 'tools/operational-knowledge.mjs';
  let s = fs.readFileSync(file, 'utf8');
  s = replaceOnce(s, "import { inferLearningIntent } from './learning-engine.mjs';\n", "import { inferLearningIntent } from './learning-engine.mjs';\nimport { matchHistoricalTrainingIntent } from './training-runtime-index.mjs';\n", 'import training-runtime-index');
  s = replaceOnce(s, "  if (base === 'dispatch') return hasIncompleteDispatch(value) ? 'incomplete_dispatch' : 'dispatch_details';\n  if (hasIncompleteDispatch(value)) return 'incomplete_dispatch';\n  return base;\n}", `  if (base === 'dispatch') return hasIncompleteDispatch(value) ? 'incomplete_dispatch' : 'dispatch_details';
  if (hasIncompleteDispatch(value)) return 'incomplete_dispatch';

  // Recupera linguagem observada nos 10 históricos somente quando o classificador
  // determinístico normal ficou sem resposta. O índice não contém preço/ETA e
  // exige correspondência forte para autorização, cancelamento e fechamento.
  if (!base || base === 'other') {
    const trained = matchHistoricalTrainingIntent(text, groupName);
    if (trained?.intent) {
      const requiresActiveCall = new Set(['closure']);
      if (!requiresActiveCall.has(trained.intent) || activeService) return trained.intent;
    }
  }
  return base;
}`, 'historical fallback');
  fs.writeFileSync(file, s);
}

{
  const file = 'tools/vercel-whatsapp-worker.mjs';
  let s = fs.readFileSync(file, 'utf8');
  s = replaceOnce(s, "import { trackerAgeSeconds } from './tracker-freshness.mjs';\n", "import { trackerAgeSeconds } from './tracker-freshness.mjs';\nimport { historicalTrainingStats } from './training-runtime-index.mjs';\n", 'worker training stats import');

  const newManagement = `async function getManagement() {
  const state = normalizeManagement(await readJson(managementFile, DEFAULT_MANAGEMENT));
  const allowed = await getAllowedGroupIds().catch(() => new Set());
  const operationalGroup = (groupId = '', groupName = '') => {
    if (!groupId) return true;
    if (allowed.has(groupId)) return true;
    return resolveGroupProfile(groupName).key !== 'generic';
  };
  let dirty = false;

  const beforeCalls = state.calls.length;
  state.calls = state.calls.filter((call) => operationalGroup(call?.sourceGroupId || '', call?.insurer || call?.client || ''));
  if (state.calls.length !== beforeCalls) dirty = true;

  for (const call of state.calls) {
    if ((call?.driverFleetId === 'fleet-gsw0h17' || call?.driverId === 'fleet-gsw0h17')
      && (!call?.driverName || call.driverName === 'Motorista principal')) {
      call.driverName = 'Mauro';
      dirty = true;
    }
  }

  const beforeProfiles = state.billingProfiles.length;
  state.billingProfiles = state.billingProfiles.filter((profile) => operationalGroup(profile?.groupId || '', profile?.groupName || ''));
  if (state.billingProfiles.length !== beforeProfiles) dirty = true;

  const beforeFinance = state.finance.length;
  state.finance = state.finance.filter((entry) => operationalGroup(entry?.groupId || '', entry?.insurer || entry?.client || ''));
  if (state.finance.length !== beforeFinance) dirty = true;

  const beforeBatches = state.billingBatches.length;
  state.billingBatches = state.billingBatches.filter((batch) => operationalGroup(batch?.groupId || '', batch?.groupName || batch?.insurer || ''));
  if (state.billingBatches.length !== beforeBatches) dirty = true;

  const mainTruck = (state.fleet || []).find((item) => item?.id === 'fleet-gsw0h17' || String(item?.plate || '').toUpperCase() === 'GSW0H17');
  if (mainTruck && !String(mainTruck.driver || '').trim()) {
    mainTruck.driver = 'Mauro';
    dirty = true;
  }

  return dirty ? saveManagement(state) : state;
}

`;
  s = replaceBetween(s, 'async function getManagement() {', 'async function saveManagement(next) {', newManagement, 'management hygiene');

  const savedGroupsBlock = `function isOperationalGroupCandidate(group = {}, allowed = new Set()) {
  if (allowed.has(group?.id)) return true;
  const name = String(group?.name || '');
  if (isTestGroupName(name) || resolveGroupProfile(name).key !== 'generic') return true;
  const value = normalizeForIntent(\`${'${name}'} ${'${group?.description || \'\'}'}\`);
  return /\\b(guincho|reboque|assistencia|socorro|prestador|prancha|transportes? de veiculos?)\\b/.test(value);
}

async function savedGroupsList() {
  const previousRegistry = await getRegistry();
  const allowed = await getAllowedGroupIds();
  return Object.values(previousRegistry)
    .filter((group) => isOperationalGroupCandidate(group, allowed))
    .map((group) => ({ ...group, selected: allowed.has(group.id) }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'pt-BR'));
}

`;
  s = replaceBetween(s, 'async function savedGroupsList() {', 'async function discoverGroups() {', savedGroupsBlock, 'saved groups filter');

  s = replaceOnce(s, "      for (const group of discovered.values()) await learningStore.syncGroup({ groupId: group.id, name: group.name, description: group.description || '' });", "      for (const group of discovered.values()) {\n        if (isOperationalGroupCandidate(group, allowed)) await learningStore.syncGroup({ groupId: group.id, name: group.name, description: group.description || '' });\n      }", 'learning sync operational groups');

  s = replaceOnce(s, `      return [...discovered.values()]
        .map((group) => ({ ...group, selected: validAllowed.includes(group.id) }))
        .sort((a, b) => String(a.name).localeCompare(String(b.name), 'pt-BR'));`, `      const effectiveAllowed = new Set(validAllowed);
      return [...discovered.values()]
        .filter((group) => isOperationalGroupCandidate(group, effectiveAllowed))
        .map((group) => ({ ...group, selected: effectiveAllowed.has(group.id) }))
        .sort((a, b) => String(a.name).localeCompare(String(b.name), 'pt-BR'));`, 'live groups filter');

  s = replaceOnce(s, `  return Object.values(previousRegistry)
    .map((group) => ({ ...group, selected: allowed.has(group.id) }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'pt-BR'));`, `  return Object.values(previousRegistry)
    .filter((group) => isOperationalGroupCandidate(group, allowed))
    .map((group) => ({ ...group, selected: allowed.has(group.id) }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'pt-BR'));`, 'fallback groups filter');

  s = replaceOnce(s, "    return res.json({ ok: true, groupCount: groups.length, exampleCount: groups.reduce((sum, group) => sum + group.examples, 0), groups });", "    return res.json({ ok: true, groupCount: groups.length, exampleCount: groups.reduce((sum, group) => sum + group.examples, 0), historicalTraining: historicalTrainingStats(), groups });", 'learning summary training stats');
  fs.writeFileSync(file, s);
}

{
  const file = 'api/worker/reload.js';
  let s = fs.readFileSync(file, 'utf8');
  if (!s.includes("'tools/training-runtime-index.mjs'")) {
    s = replaceOnce(s, "  'tools/tracker-freshness.mjs',\n", "  'tools/tracker-freshness.mjs',\n  'tools/training-runtime-index.mjs',\n", 'reload runtime training module');
  }
  fs.writeFileSync(file, s);
}

console.log('TRAINING_RUNTIME_PATCH_APPLIED');
