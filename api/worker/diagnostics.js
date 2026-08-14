import { sandboxDiagnostics } from '../../lib/sandbox-runtime.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  res.setHeader('cache-control', 'no-store');
  const result = await sandboxDiagnostics();
  res.status(result.ok ? 200 : 503).json(result);
}
