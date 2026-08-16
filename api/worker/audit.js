import { proxyWorker } from '../../lib/sandbox-runtime.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  const limit = encodeURIComponent(String(req.query?.limit || 100));
  return proxyWorker(req, res, `/api/audit?limit=${limit}`);
}
