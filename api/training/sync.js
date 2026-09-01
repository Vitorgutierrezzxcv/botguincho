import crypto from 'node:crypto';
import { authorizeTenantRequest } from '../../lib/control-plane.js';

const REPO = 'Vitorgutierrezzxcv/botguincho';
const MEMORY_URL = 'https://pribndywguacekafhuyk.supabase.co/functions/v1/training-memory';
const WORKER_URL = String(process.env.BOTGUINCHO_WORKER_URL || '').trim().replace(/\/+$/, '');
const WORKER_TOKEN = String(process.env.BOTGUINCHO_ADMIN_TOKEN || '').trim();

function sanitizeTenant(value = '') {
  return String(value || 'cliente-teste').toLowerCase().trim().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 42) || 'cliente-teste';
}

async function isGitHubActionsToken(req) {
  const auth = String(req.headers.authorization || '');
  if (!auth.startsWith('Bearer ')) return false;
  try {
    const response = await fetch('https://api.github.com/installation/repositories?per_page=100', {
      headers: {
        authorization: auth,
        accept: 'application/vnd.github+json',
        'user-agent': 'botguincho-training-sync',
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
    return host === 'botguincho.vercel.app' || host.endsWith('.botguincho.vercel.app');
  } catch {
    return false;
  }
}

async function authorize(req, companyId) {
  if (await isGitHubActionsToken(req)) return { github: true };
  if (companyId === 'cliente-teste' && sameOriginBrowser(req)) return { legacyBrowser: true };
  return authorizeTenantRequest(req, companyId);
}

async function workerFetch(path, init = {}) {
  if (!WORKER_URL || !WORKER_TOKEN) throw new Error('external_worker_not_configured');
  const response = await fetch(`${WORKER_URL}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      'x-botguincho-token': WORKER_TOKEN,
      ...(init.headers || {}),
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(init.timeoutMs || 50000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || `worker_http_${response.status}`);
  return data;
}

async function memoryFetch(payload) {
  const oidc = String(process.env.VERCEL_OIDC_TOKEN || '').trim();
  if (!oidc) throw new Error('vercel_oidc_unavailable');
  const response = await fetch(MEMORY_URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${oidc}`, 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    cache: 'no-store',
    signal: AbortSignal.timeout(12000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || `memory_http_${response.status}`);
  return data;
}

function chunkRows(rows, globalOffset, groupName) {
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

async function syncGroup(groupId, { importFirst = true } = {}) {
  if (!groupId?.endsWith('@g.us')) throw new Error('group_invalid');
  let imported = null;
  if (importFirst) {
    imported = await workerFetch('/api/learning/import-history', {
      method: 'POST',
      body: JSON.stringify({ groupId, limit: 'all' }),
      timeoutMs: 50000,
    });
  }

  const sourceHash = crypto.createHash('sha256').update(groupId).digest('hex').slice(0, 20);
  const pageSize = 1200;
  let offset = 0;
  let total = 0;
  let syncedChunks = 0;
  let groupName = imported?.groupName || 'Grupo do WhatsApp';
  let firstAt = '';
  let lastAt = '';

  do {
    const page = await workerFetch(`/api/learning/export-history?groupId=${encodeURIComponent(groupId)}&offset=${offset}&limit=${pageSize}`, { timeoutMs: 15000 });
    const rows = Array.isArray(page.rows) ? page.rows : [];
    total = Number(page.total || rows.length || 0);
    groupName = page.groupName || groupName;
    if (!firstAt && rows[0]?.at) firstAt = rows[0].at;
    if (rows.at(-1)?.at) lastAt = rows.at(-1).at;
    if (!rows.length) break;

    const chunks = chunkRows(rows, offset, groupName);
    if (chunks.length) {
      const source = {
        source_key: `runtime-history-${sourceHash}`,
        source_type: 'whatsapp_runtime_history',
        filename: `runtime-${sourceHash}.jsonl`,
        group_name: groupName,
        sha256: crypto.createHash('sha256').update(`runtime-history:${groupId}`).digest('hex'),
        message_count: total,
        started_at: firstAt || rows[0]?.at || '',
        ended_at: lastAt || rows.at(-1)?.at || '',
        raw_text: '',
        metadata: { mode: 'full_history_sync', privacy: 'anonymized', source: 'persistent_worker' },
      };
      const result = await memoryFetch({ action: 'sync', sources: [{ source, chunks }] });
      if (!result?.ok) throw new Error('memory_sync_failed');
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

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  res.setHeader('cache-control', 'no-store');
  const companyId = sanitizeTenant(req.query?.companyId || req.body?.companyId || 'cliente-teste');

  try {
    await authorize(req, companyId);
    const action = String(req.body?.action || 'sync');

    if (action === 'verify') {
      const result = await memoryFetch({
        action: 'search',
        query: String(req.body?.query || 'pode seguir').slice(0, 800),
        groupName: String(req.body?.groupName || '').slice(0, 180),
        limit: 6,
      });
      return res.status(200).json(result);
    }

    if (action !== 'sync') return res.status(400).json({ ok: false, error: 'action_invalid' });
    const groupId = String(req.body?.groupId || '');
    const result = await syncGroup(groupId, { importFirst: req.body?.importFirst !== false });
    return res.status(200).json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = /unauthorized/.test(message) ? 401 : /forbidden/.test(message) ? 403 : 500;
    return res.status(status).json({ ok: false, error: message });
  }
}
