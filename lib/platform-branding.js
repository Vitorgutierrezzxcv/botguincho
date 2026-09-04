const SUPABASE_URL = String(process.env.SUPABASE_URL || 'https://pribndywguacekafhuyk.supabase.co').replace(/\/$/, '');
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InByaWJuZHl3Z3VhY2VrYWZodXlrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY4OTY0OTQsImV4cCI6MjEwMjQ3MjQ5NH0.xHIYFkWzymWQl4iJYBOSGc5SVB0ce44Eh72m5c0C7bM';

export const DEFAULT_PLATFORM_BRANDING = Object.freeze({
  platform_name: 'Acionador.ai',
  short_name: 'Acionador.ai',
  tagline: 'Automação inteligente para assistência 24h.',
  pwa_description: 'Automação inteligente para operações de assistência 24h.',
  primary_color: '#0877F9',
});

function headers(accessToken = '') {
  return {
    apikey: SUPABASE_ANON_KEY,
    authorization: `Bearer ${accessToken || SUPABASE_ANON_KEY}`,
    'content-type': 'application/json',
  };
}

async function supabase(path, init = {}, accessToken = '') {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    headers: { ...headers(accessToken), ...(init.headers || {}) },
    cache: 'no-store',
    signal: AbortSignal.timeout(12000),
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) {
    const error = new Error(data?.message || data?.error || data?.hint || `supabase_http_${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

function firstRow(data) {
  return Array.isArray(data) ? (data[0] || null) : data;
}

export async function getPlatformBranding({ includeAssets = false } = {}) {
  const fields = includeAssets
    ? 'id,platform_name,short_name,tagline,pwa_description,primary_color,logo_data_url,app_icon_data_url,favicon_data_url,pwa_icon_180_data_url,pwa_icon_192_data_url,pwa_icon_512_data_url,updated_at'
    : 'id,platform_name,short_name,tagline,pwa_description,primary_color,updated_at';
  try {
    const row = firstRow(await supabase(`/rest/v1/platform_branding?id=eq.default&select=${encodeURIComponent(fields)}`));
    return { ...DEFAULT_PLATFORM_BRANDING, ...(row || {}) };
  } catch (error) {
    if (!includeAssets) return { ...DEFAULT_PLATFORM_BRANDING, updated_at: null };
    throw error;
  }
}

function cleanDataUrl(value, maxLength = 950000) {
  const str = String(value || '').trim();
  if (!str) return '';
  if (str.length > maxLength) throw Object.assign(new Error('image_too_large'), { status: 413 });
  if (!/^data:image\/(png|jpe?g|webp|gif|svg\+xml|x-icon|vnd\.microsoft\.icon);base64,[a-z0-9+/=\r\n]+$/i.test(str)) {
    throw Object.assign(new Error('invalid_image'), { status: 400 });
  }
  return str;
}

export async function updatePlatformBranding(input = {}, session) {
  const patch = {};
  if ('platform_name' in input) patch.platform_name = String(input.platform_name || '').trim().slice(0, 80);
  if ('short_name' in input) patch.short_name = String(input.short_name || '').trim().slice(0, 30);
  if ('tagline' in input) patch.tagline = String(input.tagline || '').trim().slice(0, 180);
  if ('pwa_description' in input) patch.pwa_description = String(input.pwa_description || '').trim().slice(0, 240);
  if ('primary_color' in input) {
    const color = String(input.primary_color || '').trim().toUpperCase();
    if (!/^#[0-9A-F]{6}$/.test(color)) throw Object.assign(new Error('invalid_primary_color'), { status: 400 });
    patch.primary_color = color;
  }
  if ('logo_data_url' in input) patch.logo_data_url = cleanDataUrl(input.logo_data_url, 950000);
  if ('app_icon_data_url' in input) patch.app_icon_data_url = cleanDataUrl(input.app_icon_data_url, 950000);
  if ('favicon_data_url' in input) patch.favicon_data_url = cleanDataUrl(input.favicon_data_url, 350000);
  if ('pwa_icon_180_data_url' in input) patch.pwa_icon_180_data_url = cleanDataUrl(input.pwa_icon_180_data_url, 950000);
  if ('pwa_icon_192_data_url' in input) patch.pwa_icon_192_data_url = cleanDataUrl(input.pwa_icon_192_data_url, 950000);
  if ('pwa_icon_512_data_url' in input) patch.pwa_icon_512_data_url = cleanDataUrl(input.pwa_icon_512_data_url, 950000);
  if (!Object.keys(patch).length) throw Object.assign(new Error('empty_patch'), { status: 400 });
  const data = await supabase('/rest/v1/rpc/master_update_platform_branding', {
    method: 'POST',
    body: JSON.stringify({ p_patch: patch }),
  }, session.token);
  return firstRow(data) || data;
}

export function publicBrandingPayload(row = {}) {
  const merged = { ...DEFAULT_PLATFORM_BRANDING, ...row };
  const stamp = encodeURIComponent(String(merged.updated_at || Date.now()));
  return {
    platform_name: merged.platform_name,
    short_name: merged.short_name,
    tagline: merged.tagline,
    pwa_description: merged.pwa_description,
    primary_color: merged.primary_color,
    updated_at: merged.updated_at || null,
    has_logo: Boolean(merged.logo_data_url),
    has_app_icon: Boolean(merged.app_icon_data_url || merged.pwa_icon_192_data_url || merged.pwa_icon_512_data_url),
    has_favicon: Boolean(merged.favicon_data_url || merged.pwa_icon_192_data_url),
    logo_url: `/api/worker/branding?mode=asset&kind=logo&v=${stamp}`,
    app_icon_url: `/api/worker/branding?mode=asset&kind=app_icon&v=${stamp}`,
    apple_icon_url: `/api/worker/branding?mode=asset&kind=pwa_180&v=${stamp}`,
    app_icon_192_url: `/api/worker/branding?mode=asset&kind=pwa_192&v=${stamp}`,
    app_icon_512_url: `/api/worker/branding?mode=asset&kind=pwa_512&v=${stamp}`,
    favicon_url: `/api/worker/branding?mode=asset&kind=favicon&v=${stamp}`,
    manifest_url: `/api/worker/branding?mode=manifest&v=${stamp}`,
  };
}

export function assetDataUrl(row = {}, kind = '') {
  if (kind === 'logo') return row.logo_data_url || '';
  if (kind === 'favicon') return row.favicon_data_url || row.pwa_icon_192_data_url || row.app_icon_data_url || '';
  if (kind === 'pwa_180') return row.pwa_icon_180_data_url || row.pwa_icon_192_data_url || row.app_icon_data_url || '';
  if (kind === 'pwa_192') return row.pwa_icon_192_data_url || row.app_icon_data_url || '';
  if (kind === 'pwa_512') return row.pwa_icon_512_data_url || row.app_icon_data_url || '';
  // O HTML inicial do iOS ainda aponta para kind=app_icon antes do branding.js rodar.
  // Preferir o PNG 180x180 aqui garante que o Safari leia o ícone correto já no primeiro parse.
  if (kind === 'app_icon') return row.pwa_icon_180_data_url || row.pwa_icon_192_data_url || row.app_icon_data_url || row.pwa_icon_512_data_url || '';
  return '';
}
