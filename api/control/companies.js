import { controlPlaneConfigured, requireMaster, listCompanies, createCompany, updateCompany } from '../../lib/control-plane.js';

export default async function handler(req, res) {
  if (!['GET','POST','PATCH'].includes(req.method)) return res.status(405).json({ error: 'method_not_allowed' });
  res.setHeader('cache-control', 'no-store');
  if (!controlPlaneConfigured()) return res.status(503).json({ error: 'control_plane_not_configured' });
  try {
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
