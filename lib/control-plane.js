const SUPABASE_URL = String(process.env.SUPABASE_URL || 'https://pribndywguacekafhuyk.supabase.co').replace(/\/$/, '');
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InByaWJuZHl3Z3VhY2VrYWZodXlrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY4OTY0OTQsImV4cCI6MjEwMjQ3MjQ5NH0.xHIYFkWzymWQl4iJYBOSGc5SVB0ce44Eh72m5c0C7bM';

export function controlPlaneConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

function headers(accessToken = '', extra = {}) {
  return {
    apikey: SUPABASE_ANON_KEY,
    authorization: `Bearer ${accessToken || SUPABASE_ANON_KEY}`,
    'content-type': 'application/json',
    ...extra,
  };
}

async function supabaseFetch(path, init = {}, accessToken = '') {
  if (!controlPlaneConfigured()) throw new Error('control_plane_not_configured');
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    headers: headers(accessToken, init.headers || {}),
    cache: 'no-store',
    signal: AbortSignal.timeout(12000),
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) {
    const message = data?.message || data?.msg || data?.error_description || data?.error || data?.hint || `supabase_http_${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return data;
}

export async function loginWithPassword(email, password) {
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
  if (!accessToken) return null;
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
  const memberships = await supabaseFetch(
    `/rest/v1/company_members?user_id=eq.${encodeURIComponent(user.id)}&active=eq.true&select=id,company_id,role,companies(id,slug,name,status,service_state,priority_cities,plan_code,tenant_provisioned,onboarding_step)`,
    {},
    token,
  );
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

export async function authorizeTenantRequest(req, companySlug) {
  if (String(companySlug || '') === 'cliente-teste') return { legacy: true };
  const session = await requireSession(req);
  if (isMaster(session)) return session;
  const allowed = session.memberships.some((m) => m.companies?.slug === companySlug && ['owner','operator'].includes(m.role));
  if (!allowed) {
    const error = new Error('forbidden');
    error.status = 403;
    throw error;
  }
  return session;
}

export async function listCompanies(session) {
  return supabaseFetch('/rest/v1/rpc/master_list_companies', { method: 'POST', body: '{}' }, session.token);
}

export async function createCompany(input = {}, session) {
  const slug = String(input.slug || '').toLowerCase().trim().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 42);
  const name = String(input.name || '').trim().slice(0, 120);
  if (!slug || slug.length < 2) throw Object.assign(new Error('invalid_slug'), { status: 400 });
  if (!name) throw Object.assign(new Error('name_required'), { status: 400 });
  return supabaseFetch('/rest/v1/rpc/master_create_company', {
    method: 'POST',
    body: JSON.stringify({
      p_slug: slug,
      p_name: name,
      p_service_state: String(input.service_state || 'MG').trim().toUpperCase().slice(0, 2),
      p_priority_cities: Array.isArray(input.priority_cities) ? input.priority_cities.map(x => String(x).trim()).filter(Boolean).slice(0, 50) : [],
      p_plan_code: String(input.plan_code || 'starter').trim().slice(0, 50),
      p_document: String(input.document || '').trim().slice(0, 40) || null,
      p_phone: String(input.phone || '').trim().slice(0, 40) || null,
      p_email: String(input.email || '').trim().slice(0, 160) || null,
    }),
  }, session.token);
}

export async function updateCompany(id, patch = {}, session) {
  return supabaseFetch('/rest/v1/rpc/master_update_company', {
    method: 'POST',
    body: JSON.stringify({ p_id: id, p_patch: patch || {} }),
  }, session.token);
}
