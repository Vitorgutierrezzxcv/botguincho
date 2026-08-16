import { requireMaster, createCompanyInvite, listCompanyAccess } from '../../lib/control-plane.js';

export default async function handler(req, res) {
  if (!['GET','POST'].includes(req.method)) return res.status(405).json({ error: 'method_not_allowed' });
  res.setHeader('cache-control', 'no-store');

  try {
    const session = await requireMaster(req);
    const companyId = String(req.method === 'GET' ? req.query?.companyId || '' : req.body?.companyId || '').trim();
    if (!companyId) return res.status(400).json({ error: 'company_required' });

    if (req.method === 'GET') {
      const access = await listCompanyAccess(companyId, session);
      return res.status(200).json({ access: Array.isArray(access) ? access : [] });
    }

    const invite = await createCompanyInvite(
      companyId,
      String(req.body?.email || ''),
      String(req.body?.role || 'owner'),
      session,
    );
    const access = await listCompanyAccess(companyId, session);
    return res.status(201).json({ invite, access: Array.isArray(access) ? access : [] });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'access_failed' });
  }
}
