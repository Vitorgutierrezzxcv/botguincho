from pathlib import Path
p=Path('tools/vercel-whatsapp-worker.mjs')
s=p.read_text()

anchor="const geocodeCacheFile = path.join(clientDir, 'geocode-cache.json');\n"
insert="const managementFile = path.join(clientDir, 'management.json');\n"
if insert not in s:
    if anchor not in s: raise SystemExit('management constant anchor missing')
    s=s.replace(anchor,anchor+insert,1)

anchor2="async function getPairCode() {\n"
block=r'''const DEFAULT_MANAGEMENT = {
  company: { name: 'Central Guincho', document: '', phone: '', email: '' },
  calls: [],
  clients: [],
  finance: [],
  fleet: [{ id: 'fleet-gsw0h17', plate: 'GSW0H17', name: 'Guincho principal', status: 'disponivel', driver: '', notes: '' }],
  automations: [
    { id: 'auto-confirm', name: 'Confirmar acionamento automaticamente', enabled: true, trigger: 'dispatch', action: 'confirm_eta' },
    { id: 'auto-finance', name: 'Criar receita ao concluir chamado', enabled: true, trigger: 'call_completed', action: 'create_revenue' },
    { id: 'auto-overdue', name: 'Destacar recebimentos vencidos', enabled: true, trigger: 'daily', action: 'flag_overdue' }
  ],
  updatedAt: null,
};

function normalizeManagement(data = {}) {
  return {
    company: { ...DEFAULT_MANAGEMENT.company, ...(data.company || {}) },
    calls: Array.isArray(data.calls) ? data.calls : [],
    clients: Array.isArray(data.clients) ? data.clients : [],
    finance: Array.isArray(data.finance) ? data.finance : [],
    fleet: Array.isArray(data.fleet) ? data.fleet : DEFAULT_MANAGEMENT.fleet,
    automations: Array.isArray(data.automations) ? data.automations : DEFAULT_MANAGEMENT.automations,
    updatedAt: data.updatedAt || null,
  };
}

async function getManagement() {
  return normalizeManagement(await readJson(managementFile, DEFAULT_MANAGEMENT));
}

async function saveManagement(next) {
  const normalized = normalizeManagement({ ...next, updatedAt: new Date().toISOString() });
  await writeJson(managementFile, normalized);
  return normalized;
}

function cleanManagementItem(value = {}) {
  const out = {};
  for (const [key, raw] of Object.entries(value || {})) {
    if (typeof raw === 'string') out[key] = raw.trim().slice(0, 2000);
    else if (typeof raw === 'number' && Number.isFinite(raw)) out[key] = raw;
    else if (typeof raw === 'boolean' || raw === null) out[key] = raw;
  }
  if (!out.id) out.id = crypto.randomUUID();
  if (!out.createdAt) out.createdAt = new Date().toISOString();
  out.updatedAt = new Date().toISOString();
  return out;
}

async function applyManagementAction(body = {}) {
  const state = await getManagement();
  const action = String(body.action || 'get');
  const collection = String(body.collection || '');
  const allowed = new Set(['calls','clients','finance','fleet','automations']);

  if (action === 'replace_company') {
    state.company = { ...state.company, ...cleanManagementItem(body.item || {}) };
    delete state.company.id; delete state.company.createdAt; delete state.company.updatedAt;
    return saveManagement(state);
  }
  if (!allowed.has(collection)) throw new Error('collection_invalid');
  if (action === 'upsert') {
    const item = cleanManagementItem(body.item || {});
    const idx = state[collection].findIndex((x) => x.id === item.id);
    if (idx >= 0) state[collection][idx] = { ...state[collection][idx], ...item };
    else state[collection].unshift(item);
    return saveManagement(state);
  }
  if (action === 'delete') {
    const id = String(body.id || '');
    state[collection] = state[collection].filter((x) => x.id !== id);
    return saveManagement(state);
  }
  if (action === 'toggle_automation') {
    const id = String(body.id || '');
    state.automations = state.automations.map((x) => x.id === id ? { ...x, enabled: body.enabled !== false, updatedAt: new Date().toISOString() } : x);
    return saveManagement(state);
  }
  throw new Error('action_invalid');
}

'''
if 'const DEFAULT_MANAGEMENT = {' not in s:
    if anchor2 not in s: raise SystemExit('management functions anchor missing')
    s=s.replace(anchor2,block+anchor2,1)

route_anchor="app.get('/api/status', async (_req, res) => {\n"
routes=r'''app.get('/api/management', async (_req, res) => {
  try {
    return res.json({ ok: true, data: await getManagement() });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

app.post('/api/management', async (req, res) => {
  try {
    const data = await applyManagementAction(req.body || {});
    logEvent('management', `Gestão atualizada: ${String(req.body?.action || 'update')} ${String(req.body?.collection || '')}`.trim());
    return res.json({ ok: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(message.includes('invalid') ? 400 : 500).json({ ok: false, error: message });
  }
});

'''
if "app.get('/api/management'" not in s:
    if route_anchor not in s: raise SystemExit('route anchor missing')
    s=s.replace(route_anchor,routes+route_anchor,1)

p.write_text(s)
print('management backend patch applied')
