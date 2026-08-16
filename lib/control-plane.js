const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

export function controlPlaneConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_SERVICE_ROLE_KEY);
}

function headers(key, extra = {}) {
  return { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json', ...extra };
}

async function supabaseFetch(path, init = {}, key = SUPABASE_SERVICE_ROLE_KEY) {
  if (!controlPlaneConfigured()) throw new Error('control_plane_not_configured');
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    headers: headers(key, init.headers || {}),
    cache: 'no-store',
    signal: AbortSignal.timeout(12000),
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) {
    const message = data?.msg || data?.message || data?.error_description || data?.error || `supabase_http_${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return data;
}

export async function loginWithPassword(email, password) {
  if (!controlPlaneConfigured()) throw new Error('control_plane_not_configured');
  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
    cache: 'no-store',
    signal: AbortSignal.timeout(12000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.msg || data?.error_description || 'login_failed');
    error.status = response.status;
    throw error;
  }
  return data;
}

export async function userFromAccessToken(accessToken) {
  if (!controlPlaneConfigured() || !accessToken) return null;
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) return null;
  return response.json();
}

function bearer(req) {
  const auth = String(req.headers?.authorization || '');
  return auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
}

export async function requireSession(req) {
  const token = bearer(req);
  const user = await userFromAccessToken(token);
  if (!user?.id) {
    const error = new Error('unauthorized');
    error.status = 401;
    throw error;
  }
  const memberships = await supabaseFetch(`/rest/v1/company_members?user_id=eq.${encodeURIComponent(user.id)}&active=eq.true&select=id,company_id,role,companies(id,slug,name,status,service_state,priority_cities,plan_code,tenant_provisioned,onboarding_step)`);
  return { token, user, memberships: Array.isArray(memberships) ? memberships : [] };
}

export function isMaster(session) {
  return session?.memberships?.some((m) => m.role === 'master');
}

export async function requireMaster(req) {
  const session = await requireSession(req);
  if (!isMaster(session)) {
    const error = new Error('forbidden');
    error.status = 403;
    throw error;
  }
  return session;
}

export async function listCompanies() {
  return supabaseFetch('/rest/v1/companies?select=*&order=created_at.desc');
}

export async function createCompany(input = {}) {
  const slug = String(input.slug || '').toLowerCase().trim().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 42);
  if (!slug || slug.length < 2) throw Object.assign(new Error('invalid_slug'), { status: 400 });
  const body = {
    slug,
    name: String(input.name || '').trim().slice(0, 120),
    document: String(input.document || '').trim().slice(0, 40) || null,
    phone: String(input.phone || '').trim().slice(0, 40) || null,
    email: String(input.email || '').trim().slice(0, 160) || null,
    service_state: String(input.service_state || 'MG').trim().toUpperCase().slice(0, 2),
    priority_cities: Array.isArray(input.priority_cities) ? input.priority_cities.map(x => String(x).trim()).filter(Boolean).slice(0, 50) : [],
    plan_code: String(input.plan_code || 'starter').trim().slice(0, 50),
    status: 'onboarding',
    onboarding_step: 'company',
  };
  if (!body.name) throw Object.assign(new Error('name_required'), { status: 400 });
  const rows = await supabaseFetch('/rest/v1/companies?select=*', {
    method: 'POST',
    headers: { prefer: 'return=representation' },
    body: JSON.stringify(body),
  });
  const company = rows?.[0];
  if (company?.id) {
    await supabaseFetch('/rest/v1/tenant_settings', {
      method: 'POST',
      headers: { prefer: 'return=minimal' },
      body: JSON.stringify({ company_id: company.id }),
    });
    await supabaseFetch('/rest/v1/subscriptions', {
      method: 'POST',
      headers: { prefer: 'return=minimal' },
      body: JSON.stringify({ company_id: company.id, plan_code: body.plan_code, status: 'trialing' }),
    });
  }
  return company;
}

export async function updateCompany(id, patch = {}) {
  const allowed = {};
  for (const key of ['name','document','phone','email','status','service_state','plan_code','tenant_provisioned','onboarding_step']) {
    if (patch[key] !== undefined) allowed[key] = patch[key];
  }
  if (Array.isArray(patch.priority_cities)) allowed.priority_cities = patch.priority_cities.map(x => String(x).trim()).filter(Boolean).slice(0, 50);
  const rows = await supabaseFetch(`/rest/v1/companies?id=eq.${encodeURIComponent(id)}&select=*`, {
    method: 'PATCH',
    headers: { prefer: 'return=representation' },
    body: JSON.stringify(allowed),
  });
  return rows?.[0] || null;
}
