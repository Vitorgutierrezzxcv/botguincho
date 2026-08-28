const SUPABASE_URL = String(process.env.SUPABASE_URL || 'https://pribndywguacekafhuyk.supabase.co').replace(/\/$/, '');
const SUPABASE_ANON_KEY = String(process.env.SUPABASE_ANON_KEY || '');

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  res.setHeader('cache-control', 'no-store');
  if (!SUPABASE_URL) return res.status(503).json({ ok: false, auth: false });
  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/settings`, {
      headers: SUPABASE_ANON_KEY ? { apikey: SUPABASE_ANON_KEY } : {},
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    return res.status(response.ok ? 200 : 503).json({ ok: response.ok, auth: response.ok });
  } catch {
    return res.status(503).json({ ok: false, auth: false });
  }
}
