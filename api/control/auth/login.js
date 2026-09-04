import { controlPlaneConfigured, loginWithPassword, loginWithPhonePassword } from '../../../lib/control-plane.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  res.setHeader('cache-control', 'no-store');
  if (!controlPlaneConfigured()) return res.status(503).json({ error: 'control_plane_not_configured' });
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const phone = String(req.body?.phone || '').trim();
    const password = String(req.body?.password || '');
    if ((!email && !phone) || !password) return res.status(400).json({ error: 'identifier_password_required' });
    const auth = phone
      ? await loginWithPhonePassword(phone, password)
      : await loginWithPassword(email, password);
    return res.status(200).json({ access_token: auth.access_token, refresh_token: auth.refresh_token, expires_in: auth.expires_in, expires_at: auth.expires_at, user: auth.user });
  } catch (error) {
    return res.status(error.status || 401).json({ error: error.message || 'login_failed' });
  }
}
