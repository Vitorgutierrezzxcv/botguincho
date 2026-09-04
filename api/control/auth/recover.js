import { controlPlaneConfigured, recoverPassword } from '../../../lib/control-plane.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  res.setHeader('cache-control', 'no-store');
  if (!controlPlaneConfigured()) return res.status(503).json({ error: 'control_plane_not_configured' });
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const redirectTo = String(req.body?.redirectTo || '').trim();
    if (!email.includes('@')) return res.status(400).json({ error: 'invalid_email' });
    await recoverPassword(email, redirectTo);
    return res.status(200).json({ ok: true });
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.message || 'recovery_failed' });
  }
}
