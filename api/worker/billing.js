import { proxyWorker } from '../../lib/sandbox-runtime.js';

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'method_not_allowed' });
  return proxyWorker(req, res, '/api/billing');
}
