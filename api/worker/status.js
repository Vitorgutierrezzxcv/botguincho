import { getWorkerStatus, requestCredential, requestTenant } from '../../lib/sandbox-runtime.js';
import { authorizeTenantRequest } from '../../lib/control-plane.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  res.setHeader('cache-control', 'no-store');
  const tenant = requestTenant(req);
  try {
    await authorizeTenantRequest(req, tenant);
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'tenant_access_failed' });
  }
  const credential = requestCredential(req, tenant);
  const status = await getWorkerStatus(credential, tenant);
  return res.status(200).json(status);
}
