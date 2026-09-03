from pathlib import Path

worker = Path('api/worker/[...path].js')
s = worker.read_text(encoding='utf-8')
s = s.replace("import { authorizeTenantRequest } from '../../lib/control-plane.js';", "import { authorizeTenantRequest, requireMaster } from '../../lib/control-plane.js';\nimport { assetDataUrl, getPlatformBranding, publicBrandingPayload, updatePlatformBranding } from '../../lib/platform-branding.js';")
helper = r'''
function sendPlatformBrandAsset(res, dataUrl) {
  const match = /^data:([^;]+);base64,(.+)$/s.exec(String(dataUrl || ''));
  if (!match) return false;
  res.setHeader('content-type', match[1]);
  res.setHeader('cache-control', 'public, max-age=300, stale-while-revalidate=3600');
  res.status(200).send(Buffer.from(match[2].replace(/\s/g, ''), 'base64'));
  return true;
}

async function handlePlatformBranding(req, res) {
  const mode = String(req.query?.mode || 'public');
  try {
    if (mode === 'admin') {
      const session = await requireMaster(req);
      if (req.method === 'GET') {
        const row = await getPlatformBranding({ includeAssets: true });
        return res.status(200).json({ branding: row, public: publicBrandingPayload(row) });
      }
      if (!['PUT','PATCH','POST'].includes(req.method)) return res.status(405).json({ error: 'method_not_allowed' });
      const row = await updatePlatformBranding(req.body || {}, session);
      return res.status(200).json({ branding: row, public: publicBrandingPayload(row) });
    }
    if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
    const row = await getPlatformBranding({ includeAssets: true });
    const b = publicBrandingPayload(row);
    if (mode === 'asset') {
      const kind = String(req.query?.kind || 'app_icon');
      if (!['logo','app_icon','favicon'].includes(kind)) return res.status(400).json({ error: 'invalid_kind' });
      if (sendPlatformBrandAsset(res, assetDataUrl(row, kind))) return;
      res.writeHead(302, { location: '/icon.svg' });
      return res.end();
    }
    if (mode === 'manifest') {
      const manifest = {
        id: '/', name: b.platform_name, short_name: b.short_name, description: b.pwa_description,
        start_url: '/?source=pwa', scope: '/', display: 'standalone', display_override: ['standalone','minimal-ui'], orientation: 'any',
        background_color: '#ffffff', theme_color: b.primary_color, lang: 'pt-BR', dir: 'ltr', categories: ['business','productivity'],
        icons: [{ src: `/api/worker/branding?mode=asset&kind=app_icon&v=${encodeURIComponent(String(b.updated_at || ''))}`, sizes: 'any', purpose: 'any maskable' }],
        prefer_related_applications: false,
      };
      res.setHeader('content-type', 'application/manifest+json; charset=utf-8');
      return res.status(200).send(JSON.stringify(manifest));
    }
    const stamp = encodeURIComponent(String(b.updated_at || ''));
    return res.status(200).json({
      ...b,
      logo_url: `/api/worker/branding?mode=asset&kind=logo&v=${stamp}`,
      app_icon_url: `/api/worker/branding?mode=asset&kind=app_icon&v=${stamp}`,
      favicon_url: `/api/worker/branding?mode=asset&kind=favicon&v=${stamp}`,
      manifest_url: `/api/worker/branding?mode=manifest&v=${stamp}`,
    });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'branding_failed' });
  }
}

'''
needle = 'export default async function handler(req, res) {'
if 'async function handlePlatformBranding' not in s:
    s = s.replace(needle, helper + needle)
needle2 = "  const path = requestedPath(req);\n"
if "if (path === 'branding')" not in s:
    s = s.replace(needle2, needle2 + "\n  if (path === 'branding') return handlePlatformBranding(req, res);\n")
worker.write_text(s, encoding='utf-8')

# Keep the Hobby deployment at 12 functions: branding rides on the existing catch-all worker function.
for p in [Path('api/branding.js'), Path('api/branding/asset.js'), Path('api/branding/manifest.js'), Path('api/control/branding.js')]:
    if p.exists(): p.unlink()

# Repoint the browser/admin runtime to the consolidated route.
p = Path('public/branding.js')
s = p.read_text(encoding='utf-8')
s = s.replace("fetch('/api/branding'", "fetch('/api/worker/branding'")
s = s.replace("'/api/branding/manifest'", "'/api/worker/branding?mode=manifest'")
p.write_text(s, encoding='utf-8')

p = Path('public/branding-admin.js')
s = p.read_text(encoding='utf-8').replace("'/api/control/branding'", "'/api/worker/branding?mode=admin'")
p.write_text(s, encoding='utf-8')

for p in [Path('index.html'), Path('qr.html'), *Path('public').glob('*.html')]:
    if not p.exists(): continue
    s = p.read_text(encoding='utf-8')
    s = s.replace('/api/branding/manifest', '/api/worker/branding?mode=manifest')
    s = s.replace('/api/branding/asset?kind=app_icon', '/api/worker/branding?mode=asset&kind=app_icon')
    s = s.replace('/api/branding/asset?kind=favicon', '/api/worker/branding?mode=asset&kind=favicon')
    p.write_text(s, encoding='utf-8')

print('Branding consolidado no catch-all worker.')
