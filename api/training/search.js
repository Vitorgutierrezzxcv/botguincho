import crypto from 'node:crypto';

const MEMORY_URL = 'https://pribndywguacekafhuyk.supabase.co/functions/v1/training-memory';
const WORKER_TOKEN = String(process.env.BOTGUINCHO_ADMIN_TOKEN || '').trim();

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return Boolean(left.length && left.length === right.length && crypto.timingSafeEqual(left, right));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  res.setHeader('cache-control', 'no-store');

  const supplied = String(req.headers['x-botguincho-token'] || '').trim();
  if (!WORKER_TOKEN || !safeEqual(supplied, WORKER_TOKEN)) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }

  const oidc = String(process.env.VERCEL_OIDC_TOKEN || '').trim();
  if (!oidc) return res.status(503).json({ ok: false, error: 'vercel_oidc_unavailable' });

  const query = String(req.body?.query || '').trim().slice(0, 800);
  const groupName = String(req.body?.groupName || '').trim().slice(0, 180);
  const limit = Math.max(1, Math.min(8, Number(req.body?.limit || 6)));
  if (query.length < 2) return res.status(200).json({ ok: true, results: [] });

  try {
    const response = await fetch(MEMORY_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${oidc}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ action: 'search', query, groupName, limit }),
      cache: 'no-store',
      signal: AbortSignal.timeout(7000),
    });
    const data = await response.json().catch(() => ({}));
    return res.status(response.ok ? 200 : response.status).json(data);
  } catch (error) {
    return res.status(503).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}
