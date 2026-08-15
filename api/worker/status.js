import { getWorkerStatus, requestCredential } from '../../lib/sandbox-runtime.js';
import { applyOperationalHotfix } from '../../lib/operational-hotfix.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  res.setHeader('cache-control', 'no-store');

  const credential = requestCredential(req);

  try {
    await applyOperationalHotfix(credential);
  } catch (error) {
    console.error('Falha ao aplicar modo operacional:', error);
  }

  const status = await getWorkerStatus(credential);
  return res.status(200).json(status);
}
