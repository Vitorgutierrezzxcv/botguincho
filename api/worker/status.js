import { getWorkerStatus, requestCredential } from '../../lib/sandbox-runtime.js';

let operationalModeApplied = false;

async function ensureOperationalMode(req) {
  if (operationalModeApplied) return;
  const host = req.headers.host;
  if (!host) return;

  try {
    const protocol = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
    const response = await fetch(`${protocol}://${host}/api/worker/operational-mode`, {
      method: 'GET',
      headers: {
        ...(req.headers.authorization ? { authorization: req.headers.authorization } : {}),
        ...(req.headers.cookie ? { cookie: req.headers.cookie } : {}),
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(12000),
    });
    if (response.ok) operationalModeApplied = true;
  } catch {
    // O status continua funcionando mesmo se a sincronização precisar ser tentada no próximo refresh.
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  res.setHeader('cache-control', 'no-store');
  await ensureOperationalMode(req);
  const status = await getWorkerStatus(requestCredential(req));
  return res.status(200).json(status);
}
