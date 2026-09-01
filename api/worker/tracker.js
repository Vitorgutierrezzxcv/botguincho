import { authorizeTenantRequest } from '../../lib/control-plane.js';
import { requestTenant } from '../../lib/sandbox-runtime.js';
import { trackerAgeSeconds } from '../../tools/tracker-freshness.mjs';

const WORKER_URL = String(process.env.BOTGUINCHO_WORKER_URL || '').trim().replace(/\/+$/, '');
const WORKER_TOKEN = String(process.env.BOTGUINCHO_ADMIN_TOKEN || '').trim();

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  res.setHeader('cache-control', 'no-store');
  const tenant = requestTenant(req);
  try {
    await authorizeTenantRequest(req, tenant);
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'tenant_access_failed' });
  }
  if (!WORKER_URL || !WORKER_TOKEN) return res.status(503).json({ error: 'worker_unavailable' });

  try {
    const upstream = await fetch(`${WORKER_URL}/api/tracker`, {
      headers: { 'x-botguincho-token': WORKER_TOKEN },
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });
    const body = await upstream.json().catch(() => ({}));
    if (!upstream.ok) return res.status(upstream.status).json({ error: body?.error || 'tracker_upstream_failed' });

    const { pairCode: _pairCode, ...safe } = body || {};
    const ageSeconds = trackerAgeSeconds(safe.lastLocation);
    const connected = ageSeconds !== null && ageSeconds <= 120;

    return res.status(200).json({
      ...safe,
      configured: Boolean(safe.pairingConfigured ?? body?.configured),
      pairingConfigured: Boolean(safe.pairingConfigured ?? body?.configured),
      connected,
      ageSeconds,
      stale: Boolean(safe.lastLocation) && !connected,
    });
  } catch (error) {
    return res.status(503).json({ error: 'tracker_unavailable', message: String(error?.message || error) });
  }
}
