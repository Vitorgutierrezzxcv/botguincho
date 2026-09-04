import { controlPlaneConfigured, loginWithPassword, loginWithPhonePassword, recoverPassword, signupWithPassword } from '../../../lib/control-plane.js';

const SUPABASE_URL = 'https://pribndywguacekafhuyk.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InByaWJuZHl3Z3VhY2VrYWZodXlrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY4OTY0OTQsImV4cCI6MjEwMjQ3MjQ5NH0.xHIYFkWzymWQl4iJYBOSGc5SVB0ce44Eh72m5c0C7bM';

function normalizePhone(v='') {
  let digits = String(v).replace(/\D/g, '');
  if (digits.length === 10 || digits.length === 11) digits = '55' + digits;
  return digits ? `+${digits}` : '';
}

async function jsonFetch(url, init = {}) {
  const r = await fetch(url, { ...init, cache: 'no-store' });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(d?.message || d?.msg || d?.error_description || d?.error || 'auth_failed');
    e.status = r.status;
    throw e;
  }
  return d;
}

export default async function handler(req, res) {
  res.setHeader('cache-control', 'no-store');

  if (req.method === 'GET' && String(req.query?.health || '') === '1') {
    try {
      const r = await fetch(`${SUPABASE_URL}/auth/v1/settings`, {
        headers: { apikey: SUPABASE_ANON_KEY },
        cache: 'no-store',
      });
      const body = await r.json().catch(() => ({}));
      return res.status(r.ok ? 200 : 502).json({
        ok: r.ok,
        supabase_status: r.status,
        project_ref: 'pribndywguacekafhuyk',
        key_type: 'legacy_anon',
        error: r.ok ? null : (body?.message || body?.msg || body?.error || 'supabase_health_failed'),
      });
    } catch (error) {
      return res.status(502).json({ ok: false, error: error.message || 'supabase_health_failed' });
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  if (!controlPlaneConfigured()) return res.status(503).json({ error: 'control_plane_not_configured' });
  const action = String(req.body?.action || 'login');
  try {
    if (action === 'recover') {
      const email = String(req.body?.email || '').trim().toLowerCase();
      if (!email.includes('@')) return res.status(400).json({ error: 'invalid_email' });
      await recoverPassword(email, String(req.body?.redirectTo || '').trim());
      return res.status(200).json({ ok: true });
    }

    if (action === 'update_password') {
      const token = String(req.headers?.authorization || '').replace(/^Bearer\s+/i, '').trim();
      const password = String(req.body?.password || '');
      if (!token) return res.status(401).json({ error: 'recovery_token_required' });
      if (password.length < 8) return res.status(400).json({ error: 'password_too_short' });
      await jsonFetch(`${SUPABASE_URL}/auth/v1/user`, {
        method: 'PUT',
        headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      return res.status(200).json({ ok: true });
    }

    if (action === 'signup') {
      const type = String(req.body?.type || 'email');
      const password = String(req.body?.password || '');
      const fullName = String(req.body?.fullName || '').trim();
      if (password.length < 8) return res.status(400).json({ error: 'password_too_short' });
      if (type === 'phone') {
        const phone = normalizePhone(req.body?.phone || '');
        if (phone.replace(/\D/g, '').length < 12) return res.status(400).json({ error: 'invalid_phone' });
        const d = await jsonFetch(`${SUPABASE_URL}/rest/v1/rpc/create_phone_password_user`, {
          method: 'POST',
          headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'content-type': 'application/json' },
          body: JSON.stringify({ p_phone: phone, p_password: password, p_full_name: fullName || null }),
        });
        return res.status(200).json(d || { ok: true });
      }
      const email = String(req.body?.email || '').trim().toLowerCase();
      const d = await signupWithPassword(email, password, { full_name: fullName });
      return res.status(200).json(d || { ok: true });
    }

    const email = String(req.body?.email || '').trim().toLowerCase();
    const phone = normalizePhone(req.body?.phone || '');
    const password = String(req.body?.password || '');
    if ((!email && !phone) || !password) return res.status(400).json({ error: 'identifier_password_required' });
    const auth = phone ? await loginWithPhonePassword(phone, password) : await loginWithPassword(email, password);
    return res.status(200).json({ access_token: auth.access_token, refresh_token: auth.refresh_token, expires_in: auth.expires_in, expires_at: auth.expires_at, user: auth.user });
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.message || 'auth_failed' });
  }
}
