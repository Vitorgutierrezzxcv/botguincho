import { getPlatformBranding, publicBrandingPayload } from '../lib/platform-branding.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  res.setHeader('cache-control', 'no-store, max-age=0');
  try {
    const row = await getPlatformBranding({ includeAssets: true });
    return res.status(200).json(publicBrandingPayload(row));
  } catch (error) {
    return res.status(500).json({ error: error.message || 'branding_failed' });
  }
}
