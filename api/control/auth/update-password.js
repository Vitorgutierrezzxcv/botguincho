const SUPABASE_URL = String(process.env.SUPABASE_URL || 'https://pribndywguacekafhuyk.supabase.co').replace(/\/$/, '');
const SUPABASE_ANON_KEY = String(process.env.SUPABASE_ANON_KEY || '');

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  res.setHeader('cache-control', 'no-store');
  if (!SUPABASE_ANON_KEY) return res.status(503).json({ error: 'control_plane_not_configured' });
  const token = String(req.headers?.authorization || '').replace(/^Bearer\s+/i, '').trim();
  const password = String(req.body?.password || '');
  if (!token) return res.status(401).json({ error: 'recovery_token_required' });
  if (password.length < 8) return res.status(400).json({ error: 'password_too_short' });
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      method: 'PUT',
      headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ password }),
      cache: 'no-store',
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(r.status).json({ error: d?.message || d?.msg || d?.error_description || 'password_update_failed' });
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'password_update_failed' });
  }
}
