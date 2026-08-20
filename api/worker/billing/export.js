import { proxyWorker } from '../../../lib/sandbox-runtime.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  const batchId = encodeURIComponent(String(req.query?.batchId || ''));
  return proxyWorker(req, res, `/api/billing/export?batchId=${batchId}`);
}
