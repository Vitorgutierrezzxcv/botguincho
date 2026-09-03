import { getPlatformBranding, publicBrandingPayload } from '../../lib/platform-branding.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  try {
    const row = await getPlatformBranding({ includeAssets: true });
    const b = publicBrandingPayload(row);
    const manifest = {
      id: '/',
      name: b.platform_name,
      short_name: b.short_name,
      description: b.pwa_description,
      start_url: '/?source=pwa',
      scope: '/',
      display: 'standalone',
      display_override: ['standalone','minimal-ui'],
      orientation: 'any',
      background_color: '#ffffff',
      theme_color: b.primary_color,
      lang: 'pt-BR',
      dir: 'ltr',
      categories: ['business','productivity'],
      icons: [{ src: b.app_icon_url, sizes: 'any', type: 'image/png', purpose: 'any maskable' }],
      prefer_related_applications: false,
    };
    res.setHeader('content-type', 'application/manifest+json; charset=utf-8');
    res.setHeader('cache-control', 'no-store, max-age=0');
    return res.status(200).send(JSON.stringify(manifest));
  } catch (error) {
    return res.status(500).json({ error: error.message || 'manifest_failed' });
  }
}
