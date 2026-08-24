import { proxyWorker, requestCredential, requestTenant, sandboxDiagnostics } from '../../lib/sandbox-runtime.js';

const ROUTES = {
  activity: { methods: ['GET'], target: '/api/activity' },
  'ai-test': { methods: ['POST'], target: '/api/ai-test' },
  audit: { methods: ['GET'], target: '/api/audit' },
  billing: { methods: ['GET', 'POST'], target: '/api/billing' },
  'billing/driver-export': { methods: ['GET'], target: '/api/billing/driver-export' },
  'billing/export': { methods: ['GET'], target: '/api/billing/export' },
  capacity: { methods: ['GET'], target: '/api/capacity' },
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
  const value = req.query?.path;
  return (Array.isArray(value) ? value.join('/') : String(value || '')).replace(/^\/+|\/+$/g, '');
}

function targetWithQuery(req, target) {
  const query = new URLSearchParams();
  for (const [key, raw] of Object.entries(req.query || {})) {
    if (key === 'path' || key === 'companyId') continue;
    for (const value of Array.isArray(raw) ? raw : [raw]) query.append(key, String(value));
  }
  const suffix = query.toString();
  return suffix ? `${target}?${suffix}` : target;
}

export default async function handler(req, res) {
  res.setHeader('cache-control', 'no-store');
  const path = requestedPath(req);

  if (path === 'runtime-version') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
    return res.status(200).json({ ok: true, version: 'simple-dispatch-v1', maxConcurrentCalls: 2, secondCallEtaCapMinutes: 60 });
  }

  if (path === 'diagnostics') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
    const result = await sandboxDiagnostics(requestCredential(req), requestTenant(req));
    return res.status(result.ok ? 200 : 503).json(result);
  }

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
