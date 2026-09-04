import { controlPlaneConfigured, requireSession, isMaster } from '../../lib/control-plane.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  res.setHeader('cache-control', 'no-store');
  if (!controlPlaneConfigured()) return res.status(503).json({ error: 'control_plane_not_configured' });
  try {
    const session = await requireSession(req);
    return res.status(200).json({
      user: {
        id: session.user.id,
        email: session.user.email || null,
        phone: session.user.phone || session.profile?.phone || null,
        name: session.profile?.full_name || session.user.user_metadata?.full_name || session.user.user_metadata?.name || null,
      },
      profile: session.profile || null,
      master: isMaster(session),
      memberships: session.memberships,
    });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'session_failed' });
  }
}
