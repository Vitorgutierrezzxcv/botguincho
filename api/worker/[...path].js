import crypto from 'node:crypto';
import { proxyWorker, requestCredential, requestTenant, sandboxDiagnostics } from '../../lib/sandbox-runtime.js';
import { authorizeTenantRequest, requireMaster } from '../../lib/control-plane.js';
import { assetDataUrl, getPlatformBranding, publicBrandingPayload, updatePlatformBranding } from '../../lib/platform-branding.js';

const REPO = 'Vitorgutierrezzxcv/botguincho';
const MEMORY_URL = 'https://pribndywguacekafhuyk.supabase.co/functions/v1/training-memory';
const EXTERNAL_WORKER_URL = String(process.env.BOTGUINCHO_WORKER_URL || '').trim().replace(/\/+$/, '');
const EXTERNAL_WORKER_TOKEN = String(process.env.BOTGUINCHO_ADMIN_TOKEN || '').trim();

const ROUTES = {
  activity: { methods: ['GET'], target: '/api/activity' },
  'ai-test': { methods: ['POST'], target: '/api/ai-test' },
  audit: { methods: ['GET'], target: '/api/audit' },
  billing: { methods: ['GET', 'POST'], target: '/api/billing' },
  'billing/driver-export': { methods: ['GET'], target: '/api/billing/driver-export' },
  'billing/export': { methods: ['GET'], target: '/api/billing/export' },
  capacity: { methods: ['GET'], target: '/api/capacity' },
  'commercial-catalog': { methods: ['GET'], target: '/api/commercial-catalog' },
  'group-knowledge': { methods: ['GET', 'POST'], target: '/api/group-knowledge' },
  groups: { methods: ['GET', 'POST'], target: '/api/groups' },
  health: { methods: ['GET'], target: '/api/health' },
  'learning-import': { methods: ['POST'], target: '/api/learning/import-history' },
  'learning-summary': { methods: ['GET'], target: '/api/learning/summary' },
  management: { methods: ['GET', 'POST'], target: '/api/management' },
  'route-test': { methods: ['POST'], target: '/api/route-test' },
  settings: { methods: ['GET', 'POST'], target: '/api/settings' },
  'test-center': { methods: ['GET', 'POST'], target: '/api/test-center' },
  tracker: { methods: ['GET', 'POST'], target: '/api/tracker' },
  'tracker-bridge': { methods: ['GET', 'POST'], target: '/api/tracker-bridge' },
};

function requestedPath(req) {
  const value = req.query?.path ?? req.query?.['...path'];
  const dynamicPath = (Array.isArray(value) ? value.join('/') : String(value || '')).replace(/^\/+|\/+$/g, '');
  if (dynamicPath) return dynamicPath;
  for (const candidate of [req.url, req.originalUrl]) {
    const pathname = String(candidate || '').split('?')[0];
    const marker = '/api/worker/';
    const index = pathname.indexOf(marker);
    if (index >= 0) return decodeURIComponent(pathname.slice(index + marker.length)).replace(/^\/+|\/+$/g, '');
  }
  return '';
}

function targetWithQuery(req, target) {
  const query = new URLSearchParams();
  for (const [key, raw] of Object.entries(req.query || {})) {
    if (key === 'path' || key === '...path' || key === 'companyId') continue;
    for (const value of Array.isArray(raw) ? raw : [raw]) query.append(key, String(value));
  }
  const suffix = query.toString();
  return suffix ? `${target}?${suffix}` : target;
}

function sanitizeTenant(value = '') {
  return String(value || 'cliente-teste').toLowerCase().trim().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 42) || 'cliente-teste';
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return Boolean(left.length && left.length === right.length && crypto.timingSafeEqual(left, right));
}

async function isGitHubActionsToken(req) {
  const auth = String(req.headers.authorization || '');
  if (!auth.startsWith('Bearer ')) return false;
  try {
    const response = await fetch('https://api.github.com/installation/repositories?per_page=100', {
      headers: {
        authorization: auth,
        accept: 'application/vnd.github+json',
        'user-agent': 'botguincho-training-memory',
        'x-github-api-version': '2022-11-28',
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return false;
    const data = await response.json();
    return Array.isArray(data.repositories) && data.repositories.some((repo) => repo.full_name === REPO);
  } catch {
    return false;
  }
}

function sameOriginBrowser(req) {
  try {
    const origin = String(req.headers.origin || req.headers.referer || '');
    const host = new URL(origin).hostname;
    return host === 'botguincho.vercel.app' || host.endsWith('.botguincho.vercel.app') || host === 'botguincho-vitorgutierrezzxcvs-projects.vercel.app';
  } catch {
    return false;
  }
}

async function authorizeTrainingSync(req, companyId) {
  if (await isGitHubActionsToken(req)) return { github: true };
  if (companyId === 'cliente-teste' && sameOriginBrowser(req)) return { legacyBrowser: true };
  return authorizeTenantRequest(req, companyId);
}

async function externalWorkerFetch(path, init = {}) {
  if (!EXTERNAL_WORKER_URL || !EXTERNAL_WORKER_TOKEN) throw new Error('external_worker_not_configured');
  const { timeoutMs = 50000, ...fetchInit } = init;
  const response = await fetch(`${EXTERNAL_WORKER_URL}${path}`, {
    ...fetchInit,
    headers: {
      'content-type': 'application/json',
      'x-botguincho-token': EXTERNAL_WORKER_TOKEN,
      ...(fetchInit.headers || {}),
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || `worker_http_${response.status}`);
  return data;
}

async function memoryFetch(payload, timeoutMs = 12000) {
  const oidc = String(process.env.VERCEL_OIDC_TOKEN || '').trim();
  const credential = oidc || EXTERNAL_WORKER_TOKEN;
  if (!credential) throw new Error('memory_auth_unavailable');
  const response = await fetch(MEMORY_URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${credential}`, 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    cache: 'no-store',
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || `memory_http_${response.status}`);
  return data;
}

function chunkTrainingRows(rows, globalOffset, groupName) {
  const result = [];
  const size = 12;
  for (let i = 0; i < rows.length; i += size) {
    const slice = rows.slice(i, i + size);
    if (!slice.length) continue;
    const start = globalOffset + i + 1;
    const end = start + slice.length - 1;
    const content = slice.map((row) => {
      const role = row.direction === 'outgoing' ? 'PRESTADOR' : 'CENTRAL';
      const at = String(row.at || '').slice(0, 19);
      return `${at ? `[${at}] ` : ''}${role}: ${String(row.text || '').trim()}`;
    }).filter(Boolean).join('\n');
    if (!content.trim()) continue;
    result.push({
      chunk_index: 10000 + Math.floor((start - 1) / size) + 1,
      group_name: groupName,
      started_at: slice[0]?.at || '',
      ended_at: slice.at(-1)?.at || '',
      start_seq: start,
      end_seq: end,
      intent_tags: [...new Set(slice.map((row) => String(row.intent || '')).filter((x) => x && x !== 'empty'))].slice(0, 12),
      sanitized_content: content.slice(0, 18000),
      raw_content: '',
    });
  }
  return result;
}

async function syncTrainingGroup(groupId, { importFirst = true } = {}) {
  if (!groupId?.endsWith('@g.us')) throw new Error('group_invalid');
  let imported = null;
  if (importFirst) {
    imported = await externalWorkerFetch('/api/learning/import-history', {
      method: 'POST',
      body: JSON.stringify({ groupId, limit: 10000 }),
      timeoutMs: 50000,
    });
  }

  const sourceHash = crypto.createHash('sha256').update(groupId).digest('hex').slice(0, 20);
  const sourceSha = crypto.createHash('sha256').update(`runtime-history:${groupId}`).digest('hex');
  const pageSize = 1200;
  let offset = 0;
  let total = 0;
  let syncedChunks = 0;
  let groupName = imported?.groupName || 'Grupo do WhatsApp';
  let firstAt = '';
  let lastAt = '';

  do {
    const page = await externalWorkerFetch(`/api/learning/export-history?groupId=${encodeURIComponent(groupId)}&offset=${offset}&limit=${pageSize}`, { timeoutMs: 15000 });
    const rows = Array.isArray(page.rows) ? page.rows : [];
    total = Number(page.total || rows.length || 0);
    groupName = page.groupName || groupName;
    if (!firstAt && rows[0]?.at) firstAt = rows[0].at;
    if (rows.at(-1)?.at) lastAt = rows.at(-1).at;
    if (!rows.length) break;

    const chunks = chunkTrainingRows(rows, offset, groupName);
    if (chunks.length) {
      const source = {
        source_key: `runtime-history-${sourceHash}`,
        source_type: 'whatsapp_runtime_history',
        filename: `runtime-${sourceHash}.jsonl`,
        group_name: groupName,
        sha256: sourceSha,
        message_count: total,
        started_at: firstAt || rows[0]?.at || '',
        ended_at: lastAt || rows.at(-1)?.at || '',
        raw_text: '',
        metadata: { mode: 'full_history_sync', privacy: 'anonymized', source: 'persistent_worker' },
      };
      await memoryFetch({ action: 'sync', sources: [{ source, chunks }] });
      syncedChunks += chunks.length;
    }
    offset += rows.length;
  } while (offset < total);

  return {
    groupId,
    groupName,
    available: imported?.available ?? total,
    imported: imported?.imported ?? 0,
    totalMessages: total,
    syncedChunks,
  };
}

function handleTrainingAuthVerify(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  const supplied = String(req.headers['x-botguincho-token'] || '').trim();
  if (!EXTERNAL_WORKER_TOKEN || !safeEqual(supplied, EXTERNAL_WORKER_TOKEN)) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }
  return res.status(200).json({ ok: true });
}

async function handleTrainingSearch(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  const supplied = String(req.headers['x-botguincho-token'] || '').trim();
  if (!EXTERNAL_WORKER_TOKEN || !safeEqual(supplied, EXTERNAL_WORKER_TOKEN)) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }
  try {
    const query = String(req.body?.query || '').trim().slice(0, 800);
    const groupName = String(req.body?.groupName || '').trim().slice(0, 180);
    const limit = Math.max(1, Math.min(8, Number(req.body?.limit || 6)));
    if (query.length < 2) return res.status(200).json({ ok: true, results: [] });
    return res.status(200).json(await memoryFetch({ action: 'search', query, groupName, limit }, 7000));
  } catch (error) {
    return res.status(503).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}

async function handleTrainingSync(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  const companyId = sanitizeTenant(req.query?.companyId || req.body?.companyId || 'cliente-teste');
  try {
    await authorizeTrainingSync(req, companyId);
    const action = String(req.body?.action || 'sync');
    if (action === 'verify') {
      return res.status(200).json(await memoryFetch({
        action: 'search',
        query: String(req.body?.query || 'pode seguir').slice(0, 800),
        groupName: String(req.body?.groupName || '').slice(0, 180),
        limit: 6,
      }));
    }
    if (action !== 'sync') return res.status(400).json({ ok: false, error: 'action_invalid' });
    const result = await syncTrainingGroup(String(req.body?.groupId || ''), { importFirst: req.body?.importFirst !== false });
    return res.status(200).json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = /unauthorized/.test(message) ? 401 : /forbidden/.test(message) ? 403 : 500;
    return res.status(status).json({ ok: false, error: message });
  }
}

function sendPlatformBrandAsset(res, dataUrl) {
  const match = /^data:([^;]+);base64,(.+)$/s.exec(String(dataUrl || ''));
  if (!match) return false;
  res.setHeader('content-type', match[1]);
  res.setHeader('cache-control', 'no-store, max-age=0, must-revalidate');
  res.setHeader('x-content-type-options', 'nosniff');
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
    const stamp = encodeURIComponent(String(b.updated_at || Date.now()));
    if (mode === 'asset') {
      const kind = String(req.query?.kind || 'app_icon');
      if (!['logo','app_icon','favicon','pwa_180','pwa_192','pwa_512'].includes(kind)) return res.status(400).json({ error: 'invalid_kind' });
      if (sendPlatformBrandAsset(res, assetDataUrl(row, kind))) return;
      res.writeHead(302, { location: '/icon.svg' });
      return res.end();
    }
    if (mode === 'manifest') {
      const manifest = {
        id: '/',
        name: b.platform_name || 'Acionador.ai',
        short_name: b.short_name || b.platform_name || 'Acionador.ai',
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
        icons: [
          { src: `/icons/icon-192.png?v=${stamp}`, sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: `/icons/icon-512.png?v=${stamp}`, sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: `/icons/icon-512.png?v=${stamp}`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        prefer_related_applications: false,
      };
      res.setHeader('content-type', 'application/manifest+json; charset=utf-8');
      res.setHeader('cache-control', 'no-store, max-age=0, must-revalidate');
      return res.status(200).send(JSON.stringify(manifest));
    }
    return res.status(200).json({
      ...b,
      logo_url: `/api/worker/branding?mode=asset&kind=logo&v=${stamp}`,
      app_icon_url: `/icons/icon-512.png?v=${stamp}`,
      apple_icon_url: `/apple-touch-icon.png?v=${stamp}`,
      app_icon_192_url: `/icons/icon-192.png?v=${stamp}`,
      app_icon_512_url: `/icons/icon-512.png?v=${stamp}`,
      favicon_url: `/favicon.png?v=${stamp}`,
      manifest_url: `/manifest.webmanifest?v=${stamp}`,
    });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'branding_failed' });
  }
}

export default async function handler(req, res) {
  res.setHeader('cache-control', 'no-store');
  const path = requestedPath(req);

  if (path === 'branding') return handlePlatformBranding(req, res);

  if (path === 'runtime-version') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
    return res.status(200).json({ ok: true, version: 'simple-dispatch-v1', maxConcurrentCalls: 2, secondCallEtaCapMinutes: 60 });
  }

  if (path === 'diagnostics') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
    const result = await sandboxDiagnostics(requestCredential(req), requestTenant(req));
    return res.status(result.ok ? 200 : 503).json(result);
  }

  if (path === 'training-auth-verify') return handleTrainingAuthVerify(req, res);
  if (path === 'training-search') return handleTrainingSearch(req, res);
  if (path === 'training-sync') return handleTrainingSync(req, res);

  if (path === 'operational-mode') {
    if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'method_not_allowed' });
    const forcedReq = {
      ...req,
      method: 'POST',
      headers: req.headers,
      body: { simpleMode: true, aiEnabled: false, replyEveryMessage: false, humanTakeover: false },
    };
    return proxyWorker(forcedReq, res, '/api/settings');
  }

  const route = ROUTES[path];
  if (!route) return res.status(404).json({ error: 'route_not_found' });
  if (!route.methods.includes(req.method)) return res.status(405).json({ error: 'method_not_allowed' });
  return proxyWorker(req, res, targetWithQuery(req, route.target));
}