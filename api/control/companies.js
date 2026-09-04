import { controlPlaneConfigured, requireMaster, requireSession, listCompanies, createCompany, createMyCompany, updateCompany } from '../../lib/control-plane.js';
import { inviteCompanyUser, listCompanyUsers } from '../../lib/account-users.js';

export default async function handler(req, res) {
  if (!['GET','POST','PATCH'].includes(req.method)) return res.status(405).json({ error: 'method_not_allowed' });
  res.setHeader('cache-control', 'no-store');
  if (!controlPlaneConfigured()) return res.status(503).json({ error: 'control_plane_not_configured' });
  try {
    const action = String(req.query?.action || req.body?.action || '');

    if (req.method === 'POST' && action === 'self_create') {
      const session = await requireSession(req);
      const company = await createMyCompany(req.body?.company || req.body || {}, session);
      return res.status(201).json({ company });
    }

    if (req.method === 'GET' && action === 'access') {
      const session = await requireSession(req);
      const companyId = String(req.query?.companyId || '').trim();
      if (!companyId) return res.status(400).json({ error: 'company_required' });
      const users = await listCompanyUsers(companyId, session);
      return res.status(200).json({ users: Array.isArray(users) ? users : [] });
    }

    if (req.method === 'POST' && action === 'invite_user') {
      const session = await requireSession(req);
      const companyId = String(req.body?.companyId || '').trim();
      if (!companyId) return res.status(400).json({ error: 'company_required' });
      const invite = await inviteCompanyUser(companyId, req.body?.email, req.body?.role, session);
      return res.status(201).json({ invite });
    }

    const session = await requireMaster(req);
    if (req.method === 'GET') return res.status(200).json({ companies: await listCompanies(session) });
    if (req.method === 'POST') return res.status(201).json({ company: await createCompany(req.body || {}, session) });
    const id = String(req.body?.id || '').trim();
    if (!id) return res.status(400).json({ error: 'id_required' });
    return res.status(200).json({ company: await updateCompany(id, req.body?.patch || {}, session) });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'companies_failed' });
  }
}
