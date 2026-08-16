from pathlib import Path
p=Path('tools/vercel-whatsapp-worker.mjs')
s=p.read_text()

# persistent audit file
anchor="const managementFile = path.join(clientDir, 'management.json');\n"
if "const auditFile" not in s:
    s=s.replace(anchor, anchor+"const auditFile = path.join(clientDir, 'audit.jsonl');\n",1)

# circuit state
anchor="const sharedLocations = new Map();\n"
if "const routeProviderState" not in s:
    s=s.replace(anchor,anchor+"const routeProviderState = new Map();\n",1)

# persist logEvent
old="""function logEvent(type, message, meta = {}) {
  activity.unshift({ id: Date.now() + Math.random(), at: new Date().toISOString(), type, message, meta });
  if (activity.length > 100) activity.length = 100;
  console.log(`[worker:${clientId}] ${type}: ${message}`);
}"""
new="""function logEvent(type, message, meta = {}) {
  const entry = { id: Date.now() + Math.random(), at: new Date().toISOString(), type, message, meta };
  activity.unshift(entry);
  if (activity.length > 100) activity.length = 100;
  console.log(`[worker:${clientId}] ${type}: ${message}`);
  void ensureDir()
    .then(() => fs.appendFile(auditFile, `${JSON.stringify(entry)}\\n`))
    .catch(() => undefined);
}"""
if old in s:
    s=s.replace(old,new,1)

# dispatch fingerprint helper before recordDispatchInManagement
anchor="async function recordDispatchInManagement({ groupId, groupName, text, originAddress, destinationAddress, eta }) {\n"
block=r'''function dispatchFingerprint({ groupId = '', vehicle = '', service = '', originAddress = '', destinationAddress = '' } = {}) {
  const normalized = [groupId, vehicle, service, originAddress, destinationAddress]
    .map((value) => normalizeForIntent(String(value || '')).replace(/\s+/g, ' ').trim())
    .join('|');
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 24);
}

'''
if 'function dispatchFingerprint' not in s:
    s=s.replace(anchor,block+anchor,1)

# strengthen management dedupe
old="""    const now = Date.now();
    const existing = state.calls.find((call) => {
      const age = now - new Date(call.createdAt || 0).getTime();
      return call.sourceGroupId === groupId && age < 15 * 60 * 1000 && call.origin === (originAddress || '') && !['concluido','cancelado'].includes(call.status);
    });
    const patch = {
      id: existing?.id || crypto.randomUUID(),"""
new="""    const now = Date.now();
    const dispatchKey = dispatchFingerprint({ groupId, vehicle, service, originAddress, destinationAddress });
    const existing = state.calls.find((call) => {
      const age = now - new Date(call.createdAt || 0).getTime();
      if (call.dispatchKey && call.dispatchKey === dispatchKey && age < 2 * 60 * 60 * 1000) return true;
      return call.sourceGroupId === groupId && age < 15 * 60 * 1000 && call.origin === (originAddress || '') && call.destination === (destinationAddress || '') && !['concluido','cancelado'].includes(call.status);
    });
    const patch = {
      id: existing?.id || crypto.randomUUID(),
      dispatchKey,"""
if old in s:
    s=s.replace(old,new,1)
else:
    print('management dedupe anchor not found or already patched')

# circuit breaker helpers before routeBetween
anchor="async function routeBetween(start, end) {\n"
block=r'''function routeProviderCanTry(name) {
  const state = routeProviderState.get(name);
  return !state?.openUntil || Date.now() >= state.openUntil;
}

function routeProviderSuccess(name) {
  routeProviderState.set(name, { failures: 0, openUntil: 0, lastSuccessAt: new Date().toISOString() });
}

function routeProviderFailure(name) {
  const current = routeProviderState.get(name) || { failures: 0, openUntil: 0 };
  const failures = Number(current.failures || 0) + 1;
  const openUntil = failures >= 3 ? Date.now() + 2 * 60 * 1000 : 0;
  routeProviderState.set(name, { ...current, failures, openUntil, lastFailureAt: new Date().toISOString() });
  if (openUntil) logEvent('circuit-breaker', `Roteador ${name} suspenso por 2 minutos após ${failures} falhas.`);
}

'''
if 'function routeProviderCanTry' not in s:
    s=s.replace(anchor,block+anchor,1)

# modify route loop to skip/open/reset
old="""  for (const provider of providers) {
    const url = `${provider.base}${coordinates}?overview=false&steps=false&alternatives=false`;
    try {"""
new="""  for (const provider of providers) {
    if (!routeProviderCanTry(provider.name)) {
      logEvent('route-fallback', `Roteador ${provider.name} temporariamente em circuit breaker; usando alternativa.`);
      continue;
    }
    const url = `${provider.base}${coordinates}?overview=false&steps=false&alternatives=false`;
    try {"""
if old in s:
    s=s.replace(old,new,1)
old="""      if (provider.name !== 'osrm-main') {
        logEvent('route-fallback', `Rota calculada pelo fallback ${provider.name}.`);
      }
      return {"""
new="""      routeProviderSuccess(provider.name);
      if (provider.name !== 'osrm-main') {
        logEvent('route-fallback', `Rota calculada pelo fallback ${provider.name}.`);
      }
      return {"""
if old in s:
    s=s.replace(old,new,1)
old="""    } catch (error) {
      lastError = error;
      logEvent('warning', `Falha no roteador ${provider.name}; tentando alternativa.`, {"""
new="""    } catch (error) {
      lastError = error;
      routeProviderFailure(provider.name);
      logEvent('warning', `Falha no roteador ${provider.name}; tentando alternativa.`, {"""
if old in s:
    s=s.replace(old,new,1)

# add dispatch id/key into state inside handleDispatch after addresses
old="""  const originCoordinates = location || (!originAddress ? shared?.coordinates || null : null);
  const originMoment = originCoordinates && !originAddress && shared?.at
    ? new Date(shared.at).toISOString()
    : new Date().toISOString();

  const state = await setDispatchState(msg.from, {"""
new="""  const originCoordinates = location || (!originAddress ? shared?.coordinates || null : null);
  const originMoment = originCoordinates && !originAddress && shared?.at
    ? new Date(shared.at).toISOString()
    : new Date().toISOString();
  const vehicle = extractLabeledField(readableText, 'Veículo') || extractLabeledField(readableText, 'Veiculo') || '';
  const service = extractLabeledField(readableText, 'Serviço') || extractLabeledField(readableText, 'Servico') || 'Reboque';
  const dispatchKey = dispatchFingerprint({ groupId: msg.from, vehicle, service, originAddress, destinationAddress });
  const previousState = await getDispatchState(msg.from);
  const dispatchId = previousState?.activeDispatchKey === dispatchKey && previousState?.activeDispatchId
    ? previousState.activeDispatchId
    : crypto.randomUUID();

  const state = await setDispatchState(msg.from, {
    activeDispatchId: dispatchId,
    activeDispatchKey: dispatchKey,
    activeDispatchStartedAt: previousState?.activeDispatchKey === dispatchKey ? previousState.activeDispatchStartedAt : new Date().toISOString(),"""
if old in s:
    s=s.replace(old,new,1)

# enrich dispatch reply log meta
old="""    intent: eta ? 'dispatch' : 'dispatch-safe-mode',
    etaMinutes: eta?.minutes ?? null,
  });"""
new="""    intent: eta ? 'dispatch' : 'dispatch-safe-mode',
    etaMinutes: eta?.minutes ?? null,
    dispatchId,
    dispatchKey,
  });"""
if old in s:
    s=s.replace(old,new,1)

# health builder + routes before management endpoint
anchor="app.get('/api/management', async (_req, res) => {\n"
block=r'''async function buildOperationalHealth() {
  const reading = await getTrackerReading();
  const ageSeconds = reading?.receivedAt ? Math.max(0, Math.round((Date.now() - new Date(reading.receivedAt).getTime()) / 1000)) : null;
  const trackerFresh = Number.isFinite(ageSeconds) && ageSeconds <= 120;
  const settings = await getSettings();
  const recentErrors = activity.filter((item) => ['error','warning','safety'].includes(item.type)).slice(0, 8);
  const routeProviders = Object.fromEntries(['osrm-main','osrm-osmde'].map((name) => {
    const state = routeProviderState.get(name) || { failures: 0, openUntil: 0 };
    return [name, {
      status: state.openUntil && state.openUntil > Date.now() ? 'degraded' : 'ok',
      failures: state.failures || 0,
      openUntil: state.openUntil ? new Date(state.openUntil).toISOString() : null,
      lastSuccessAt: state.lastSuccessAt || null,
      lastFailureAt: state.lastFailureAt || null,
    }];
  }));
  const checks = {
    whatsapp: { ok: waStatus === 'pronto', status: waStatus },
    tracker: { ok: trackerFresh, status: trackerFresh ? 'online' : 'stale', ageSeconds, plate: reading?.plate || null, address: reading?.address || null },
    ai: { ok: Boolean(aiCredential) && settings.aiEnabled !== false, status: aiCredential ? (settings.aiEnabled === false ? 'disabled' : 'online') : 'not_configured' },
    routes: { ok: Object.values(routeProviders).some((item) => item.status === 'ok'), providers: routeProviders },
  };
  const criticalOk = checks.whatsapp.ok && checks.tracker.ok && checks.routes.ok;
  return {
    ok: criticalOk,
    status: criticalOk ? 'operational' : 'attention',
    checkedAt: new Date().toISOString(),
    checks,
    groupsSelected: (await getAllowedGroupIds()).size,
    recentErrors,
  };
}

app.get('/api/health', async (_req, res) => {
  try {
    return res.json(await buildOperationalHealth());
  } catch (error) {
    return res.status(500).json({ ok: false, status: 'error', error: error instanceof Error ? error.message : String(error) });
  }
});

app.get('/api/audit', async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(200, Number(req.query.limit || 100)));
    let raw = '';
    try { raw = await fs.readFile(auditFile, 'utf8'); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
    const entries = raw.split('\\n').filter(Boolean).slice(-limit).reverse().map((line) => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
    return res.json({ ok: true, entries });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

'''
if "app.get('/api/health'" not in s:
    s=s.replace(anchor,block+anchor,1)

p.write_text(s)
print('phase2 reliability patch applied')
