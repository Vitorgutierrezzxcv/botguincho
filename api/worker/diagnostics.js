import { sandboxDiagnostics } from '../../lib/sandbox-runtime.js';
import { browserRepairDiagnostics } from '../../lib/sandbox-repair.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  res.setHeader('cache-control', 'no-store');
  const result = await sandboxDiagnostics();
  const repairLogs = await browserRepairDiagnostics();
  res.status(result.ok ? 200 : 503).json({
    ...result,
    repairLogs: repairLogs.slice(-8000),
  });
}
