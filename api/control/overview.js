import { requireMaster, listCompanies } from '../../lib/control-plane.js';

const CACHE_TTL_MS = 30_000;
let cached = null;

function baseUrl(req) {
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  if (!host) throw new Error('host_unavailable');
  return `${proto}://${host}`;
}

async function fetchJson(url, init = {}, timeoutMs = 18_000) {
  const response = await fetch(url, {
    ...init,
    cache: 'no-store',
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!response.ok) throw new Error(data?.error || data?.message || `HTTP ${response.status}`);
  return data || {};
}

function localDayKey(value = new Date()) {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date(value));
  } catch {
    return new Date(value).toISOString().slice(0, 10);
  }
}

function summarizeManagement(payload = {}) {
  const state = payload.data || payload || {};
  const calls = Array.isArray(state.calls) ? state.calls : [];
  const today = localDayKey();
  const open = calls.filter((c) => !['concluido','cancelado'].includes(String(c.status || '').toLowerCase()));
  const todayCalls = calls.filter((c) => c.createdAt && localDayKey(c.createdAt) === today);
  return {
    callsOpen: open.length,
    callsToday: todayCalls.length,
    callsTotal: calls.length,
    fleetTotal: Array.isArray(state.fleet) ? state.fleet.length : 0,
  };
}

function summarizeHealth(payload = {}) {
  const checks = payload.checks || {};
  return {
    overall: payload.status || (payload.ok ? 'operational' : 'attention'),
    whatsapp: {
      ok: Boolean(checks.whatsapp?.ok),
      status: checks.whatsapp?.status || 'unknown',
    },
    tracker: {
      ok: Boolean(checks.tracker?.ok),
      status: checks.tracker?.status || 'unknown',
      ageSeconds: Number.isFinite(checks.tracker?.ageSeconds) ? checks.tracker.ageSeconds : null,
      plate: checks.tracker?.plate || null,
      address: checks.tracker?.address || null,
    },
    routes: {
      ok: Boolean(checks.routes?.ok),
      providers: checks.routes?.providers || {},
    },
    ai: {
      ok: Boolean(checks.ai?.ok),
      status: checks.ai?.status || 'unknown',
    },
    groupsSelected: Number(payload.groupsSelected || 0),
    checkedAt: payload.checkedAt || new Date().toISOString(),
    recentErrors: Array.isArray(payload.recentErrors) ? payload.recentErrors.slice(0, 5) : [],
  };
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      try { results[index] = await mapper(items[index], index); }
      catch (error) { results[index] = { error: String(error?.message || error) }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, Math.max(items.length, 1)) }, () => worker()));
  return results;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  res.setHeader('cache-control', 'no-store');

  try {
    const session = await requireMaster(req);
    const force = String(req.query?.force || '') === '1';
    if (!force && cached && Date.now() - cached.at < CACHE_TTL_MS) {
      return res.status(200).json({ ...cached.payload, cached: true });
    }

    const companies = await listCompanies(session);
    const list = Array.isArray(companies) ? companies.slice(0, 50) : [];
    const origin = baseUrl(req);
    const auth = String(req.headers.authorization || '');

    const snapshots = await mapLimit(list, 4, async (company) => {
      const base = {
        id: company.id,
        slug: company.slug,
        name: company.name,
        status: company.status,
        planCode: company.plan_code,
        serviceState: company.service_state,
        tenantProvisioned: Boolean(company.tenant_provisioned),
        onboardingStep: company.onboarding_step,
      };

      if (!company.tenant_provisioned && company.slug !== 'cliente-teste') {
        return { ...base, operational: false, state: 'not_provisioned', health: null, management: null, alerts: ['Tenant ainda não provisionado.'] };
      }

      const headers = {
        authorization: auth,
        'x-botguincho-company-id': company.slug,
      };
      const q = `companyId=${encodeURIComponent(company.slug)}`;
      const [healthResult, managementResult] = await Promise.allSettled([
        fetchJson(`${origin}/api/worker/health?${q}`, { headers }),
        fetchJson(`${origin}/api/worker/management?${q}`, { headers }),
      ]);

      const health = healthResult.status === 'fulfilled' ? summarizeHealth(healthResult.value) : null;
      const management = managementResult.status === 'fulfilled' ? summarizeManagement(managementResult.value) : null;
      const alerts = [];
      if (!health) alerts.push('Diagnóstico indisponível.');
      else {
        if (!health.whatsapp.ok) alerts.push('WhatsApp não está pronto.');
        if (!health.tracker.ok) alerts.push('Rastreador sem leitura recente.');
        if (!health.routes.ok) alerts.push('Rotas indisponíveis.');
        if (health.recentErrors?.length) alerts.push(`${health.recentErrors.length} ocorrência(s) recente(s).`);
      }
      if (!management) alerts.push('Gestão indisponível.');

      return {
        ...base,
        operational: health?.overall === 'operational',
        state: health?.overall || (health ? 'attention' : 'unavailable'),
        health,
        management,
        alerts,
      };
    });

    const summary = {
      total: snapshots.length,
      operational: snapshots.filter((x) => x?.operational).length,
      attention: snapshots.filter((x) => x && !x.operational && x.state !== 'not_provisioned').length,
      notProvisioned: snapshots.filter((x) => x?.state === 'not_provisioned').length,
      whatsappOnline: snapshots.filter((x) => x?.health?.whatsapp?.ok).length,
      trackerOnline: snapshots.filter((x) => x?.health?.tracker?.ok).length,
    };

    const payload = { ok: true, checkedAt: new Date().toISOString(), summary, companies: snapshots };
    cached = { at: Date.now(), payload };
    return res.status(200).json({ ...payload, cached: false });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'overview_failed' });
  }
}
