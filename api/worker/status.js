import { getWorkerStatus, requestCredential } from '../../lib/sandbox-runtime.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  res.setHeader('cache-control', 'no-store');
  const status = await getWorkerStatus(requestCredential(req));
  return res.status(200).json(status);
}
