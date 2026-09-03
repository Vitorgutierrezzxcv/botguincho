import { assetDataUrl, getPlatformBranding } from '../../lib/platform-branding.js';

function sendDataUrl(res, dataUrl) {
  const match = /^data:([^;]+);base64,(.+)$/s.exec(String(dataUrl || ''));
  if (!match) return false;
  const mime = match[1];
  const body = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
  res.setHeader('content-type', mime);
  res.setHeader('cache-control', 'public, max-age=300, stale-while-revalidate=3600');
  res.status(200).send(body);
  return true;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  const kind = String(req.query?.kind || 'app_icon');
  if (!['logo','app_icon','favicon'].includes(kind)) return res.status(400).json({ error: 'invalid_kind' });
  try {
    const row = await getPlatformBranding({ includeAssets: true });
    if (sendDataUrl(res, assetDataUrl(row, kind))) return;
    res.setHeader('cache-control', 'no-store');
    res.writeHead(302, { location: '/icon.svg' });
    return res.end();
  } catch {
    res.writeHead(302, { location: '/icon.svg' });
    return res.end();
  }
}
