const SUPABASE_URL = String(process.env.SUPABASE_URL || 'https://pribndywguacekafhuyk.supabase.co').replace(/\/$/, '');
const SUPABASE_ANON_KEY = String(process.env.SUPABASE_ANON_KEY || '');

function normalizePhone(v='') {
  let digits = String(v).replace(/\D/g, '');
  if (digits.length === 10 || digits.length === 11) digits = '55' + digits;
  return digits ? `+${digits}` : '';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  res.setHeader('cache-control', 'no-store');
  if (!SUPABASE_ANON_KEY) return res.status(503).json({ error: 'control_plane_not_configured' });
  const type = String(req.body?.type || 'email');
  const password = String(req.body?.password || '');
  const fullName = String(req.body?.fullName || '').trim();
  if (password.length < 8) return res.status(400).json({ error: 'password_too_short' });
  try {
    let r;
    if (type === 'phone') {
      const phone = normalizePhone(req.body?.phone || '');
      if (phone.replace(/\D/g, '').length < 12) return res.status(400).json({ error: 'invalid_phone' });
      r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/create_phone_password_user`, {
        method: 'POST',
        headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({ p_phone: phone, p_password: password, p_full_name: fullName || null }),
        cache: 'no-store',
      });
    } else {
      const email = String(req.body?.email || '').trim().toLowerCase();
      if (!email.includes('@')) return res.status(400).json({ error: 'invalid_email' });
      r = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
        method: 'POST',
        headers: { apikey: SUPABASE_ANON_KEY, 'content-type': 'application/json' },
        body: JSON.stringify({ email, password, data: { full_name: fullName } }),
        cache: 'no-store',
      });
    }
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(r.status).json({ error: d?.message || d?.msg || d?.error_description || d?.error || 'signup_failed' });
    return res.status(200).json(d || { ok: true });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'signup_failed' });
  }
}
