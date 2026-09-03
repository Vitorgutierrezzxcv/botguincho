import { requireMaster } from '../../lib/control-plane.js';
import { getPlatformBranding, publicBrandingPayload, updatePlatformBranding } from '../../lib/platform-branding.js';

export default async function handler(req, res) {
  if (!['GET','PUT','PATCH'].includes(req.method)) return res.status(405).json({ error: 'method_not_allowed' });
  res.setHeader('cache-control', 'no-store, max-age=0');
  try {
    const session = await requireMaster(req);
    if (req.method === 'GET') {
      const row = await getPlatformBranding({ includeAssets: true });
      return res.status(200).json({ branding: row, public: publicBrandingPayload(row) });
    }
    const row = await updatePlatformBranding(req.body || {}, session);
    return res.status(200).json({ branding: row, public: publicBrandingPayload(row) });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'branding_admin_failed' });
  }
}
