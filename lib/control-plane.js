const SUPABASE_URL = 'https://pribndywguacekafhuyk.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InByaWJuZHl3Z3VhY2VrYWZodXlrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY4OTY0OTQsImV4cCI6MjEwMjQ3MjQ5NH0.xHIYFkWzymWQl4iJYBOSGc5SVB0ce44Eh72m5c0C7bM';
const BOOTSTRAP_MASTER_EMAIL = String(process.env.BOTGUINCHO_BOOTSTRAP_MASTER_EMAIL || 'comercialvittorgutierrez@gmail.com').toLowerCase().trim();
const PROD_RECOVERY_REDIRECT = 'https://botguincho.vercel.app/login.html?recovery=1';

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

export async function signupWithPassword(email, password, metadata = {}) {
  const normalizedEmail = String(email || '').toLowerCase().trim();
  if (!normalizedEmail.includes('@')) throw Object.assign(new Error('invalid_email'), { status: 400 });
  if (String(password || '').length < 8) throw Object.assign(new Error('password_too_short'), { status: 400 });
  const response = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ email: normalizedEmail, password, data: metadata || {} }),
    cache: 'no-store',
    signal: AbortSignal.timeout(12000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.msg || data?.error_description || data?.message || 'signup_failed');
    error.status = response.status;
    throw error;
  }
  return data;
}

async function passwordGrant(payload = {}) {
  if (!controlPlaneConfigured()) throw Object.assign(new Error('control_plane_not_configured'), { status: 503 });
  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON_KEY, 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    cache: 'no-store',
    signal: AbortSignal.timeout(12000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.msg || data?.error_description || data?.message || 'login_failed');
    error.status = response.status;
    throw error;
  }
  return data;
}

export async function loginWithPassword(email, password) {
  return passwordGrant({ email: String(email || '').trim().toLowerCase(), password: String(password || '') });
}

export async function loginWithPhonePassword(phone, password) {
  return passwordGrant({ phone: String(phone || '').trim(), password: String(password || '') });
}

export async function recoverPassword(email, redirectTo) {
  if (!controlPlaneConfigured()) throw Object.assign(new Error('control_plane_not_configured'), { status: 503 });
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail.includes('@')) throw Object.assign(new Error('invalid_email'), { status: 400 });
  const requested = String(redirectTo || '').trim();
  const safeRedirect = requested.startsWith('https://botguincho.vercel.app/') ? requested : PROD_RECOVERY_REDIRECT;
  const url = `${SUPABASE_URL}/auth/v1/recover?redirect_to=${encodeURIComponent(safeRedirect)}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ email: normalizedEmail }),
    cache: 'no-store',
    signal: AbortSignal.timeout(12000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.msg || data?.error_description || data?.message || 'recovery_failed');
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

  try {
    await supabaseFetch('/rest/v1/rpc/claim_my_company_invites', { method: 'POST', body: '{}' }, token);
  } catch (error) {
    if (![400, 404].includes(Number(error?.status))) throw error;
  }

  const memberships = await supabaseFetch(
    `/rest/v1/company_members?user_id=eq.${encodeURIComponent(user.id)}&active=eq.true&select=id,company_id,role,companies(id,slug,name,contact_name,status,service_state,priority_cities,plan_code,tenant_provisioned,onboarding_step)`,
    {},
    token,
  );
  let profile = null;
  try {
    const rows = await supabaseFetch(`/rest/v1/user_profiles?user_id=eq.${encodeURIComponent(user.id)}&select=user_id,full_name,phone`, {}, token);
    profile = Array.isArray(rows) ? (rows[0] || null) : rows;
  } catch (error) {
    if (![400, 404].includes(Number(error?.status))) throw error;
  }
  return { token, user, profile, memberships: Array.isArray(memberships) ? memberships : [] };
}

export function isMaster(session) {
  const email = String(session?.user?.email || '').toLowerCase().trim();
  return email === BOOTSTRAP_MASTER_EMAIL || session?.memberships?.some((m) => m.role === 'master');
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

function sanitizeCompanyInput(input = {}) {
  const slug = String(input.slug || '').toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 42);
  const name = String(input.name || '').trim().slice(0, 120);
  if (!slug || slug.length < 2) throw Object.assign(new Error('invalid_slug'), { status: 400 });
  if (!name) throw Object.assign(new Error('name_required'), { status: 400 });
  return { slug, name };
}

export async function createCompany(input = {}, session) {
  const { slug, name } = sanitizeCompanyInput(input);
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

export async function createMyCompany(input = {}, session) {
  const { slug, name } = sanitizeCompanyInput(input);
  return supabaseFetch('/rest/v1/rpc/create_my_company', {
    method: 'POST',
    body: JSON.stringify({
      p_name: name,
      p_slug: slug,
      p_contact_name: String(input.contact_name || input.full_name || '').trim().slice(0, 120) || null,
      p_phone: String(input.phone || '').trim().slice(0, 40) || null,
      p_email: String(input.email || session?.user?.email || '').trim().slice(0, 160) || null,
      p_service_state: String(input.service_state || 'MG').trim().toUpperCase().slice(0, 2),
      p_priority_cities: Array.isArray(input.priority_cities) ? input.priority_cities.map(x => String(x).trim()).filter(Boolean).slice(0, 50) : [],
    }),
  }, session.token);
}

export async function updateMyProfile(input = {}, session) {
  return supabaseFetch('/rest/v1/rpc/update_my_profile', {
    method: 'POST',
    body: JSON.stringify({
      p_full_name: String(input.full_name || '').trim().slice(0, 120) || null,
      p_phone: String(input.phone || '').trim().slice(0, 40) || null,
    }),
  }, session.token);
}

export async function updateCompany(id, patch = {}, session) {
  return supabaseFetch('/rest/v1/rpc/master_update_company', {
    method: 'POST',
    body: JSON.stringify({ p_id: id, p_patch: patch || {} }),
  }, session.token);
}

export async function createCompanyInvite(companyId, email, role = 'owner', session) {
  const normalizedEmail = String(email || '').toLowerCase().trim();
  const normalizedRole = ['owner','operator'].includes(role) ? role : 'operator';
  if (!companyId) throw Object.assign(new Error('company_required'), { status: 400 });
  if (!normalizedEmail.includes('@')) throw Object.assign(new Error('invalid_email'), { status: 400 });
  return supabaseFetch('/rest/v1/rpc/master_create_company_invite', {
    method: 'POST',
    body: JSON.stringify({ p_company_id: companyId, p_email: normalizedEmail, p_role: normalizedRole }),
  }, session.token);
}

export async function listCompanyAccess(companyId, session) {
  if (!companyId) throw Object.assign(new Error('company_required'), { status: 400 });
  return supabaseFetch('/rest/v1/rpc/master_list_company_access', {
    method: 'POST',
    body: JSON.stringify({ p_company_id: companyId }),
  }, session.token);
}
