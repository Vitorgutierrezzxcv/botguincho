import { authorizeTenantRequest } from '../../lib/control-plane.js';
import { requestTenant } from '../../lib/sandbox-runtime.js';

const WORKER_URL = String(process.env.BOTGUINCHO_WORKER_URL || '').trim().replace(/\/+$/, '');
const WORKER_TOKEN = String(process.env.BOTGUINCHO_ADMIN_TOKEN || '').trim();

function finiteTimestamp(value) {
  const parsed = Date.parse(String(value || '').trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function parseBrazilianDate(value = '') {
  const match = String(value || '').trim().match(/(?:^|\D)(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})(?:\D+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!match) return null;
  const [, day, month, year, hour = '00', minute = '00', second = '00'] = match;
  const d = Number(day), m = Number(month), y = Number(year);
  if (d < 1 || d > 31 || m < 1 || m > 12 || y < 2000 || y > 2200) return null;
  return finiteTimestamp(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}-03:00`);
}

function sourceTimestamp(reading) {
  const structured = finiteTimestamp(reading?.sourceUpdatedAt);
  if (structured !== null) return structured;
  const raw = String(reading?.lastUpdateText || '').trim();
  if (raw) {
    const direct = finiteTimestamp(raw);
    if (direct !== null) return direct;
    const brazilian = parseBrazilianDate(raw);
    if (brazilian !== null) return brazilian;
  }
  return finiteTimestamp(reading?.receivedAt);
}

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
    const timestamp = sourceTimestamp(safe.lastLocation);
    const ageSeconds = timestamp === null ? null : Math.max(0, Math.round((Date.now() - timestamp) / 1000));
    const connected = ageSeconds !== null && ageSeconds <= 90;

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
