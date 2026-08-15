import { Sandbox } from '@vercel/sandbox';
import { getWorkerStatus, requestCredential } from '../../lib/sandbox-runtime.js';

const SANDBOX_NAME = 'botguincho-wa-vercel-v12';
const REPO_URL = 'https://github.com/Vitorgutierrezzxcv/botguincho.git';
const PORT = 3001;

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'method_not_allowed' });
  res.setHeader('cache-control', 'no-store');

  try {
    // Garante que o worker esteja acordado antes de encaminhar a leitura do Android.
    await getWorkerStatus(requestCredential(req));
    const sandbox = await Sandbox.getOrCreate({
      name: SANDBOX_NAME,
      source: { type: 'git', url: REPO_URL, depth: 1 },
      runtime: 'node22',
      resources: { vcpus: 2 },
      timeout: 40 * 60 * 1000,
      persistent: true,
      snapshotExpiration: 7 * 24 * 60 * 60 * 1000,
      keepLastSnapshots: { count: 1 },
      ports: [PORT],
      networkPolicy: 'allow-all',
      resume: true,
    });

    const headers = { 'content-type': 'application/json' };
    const pairCode = req.headers['x-botguincho-pair-code'];
    const agent = req.headers['x-botguincho-agent'];
    if (pairCode) headers['x-botguincho-pair-code'] = Array.isArray(pairCode) ? pairCode[0] : pairCode;
    if (agent) headers['x-botguincho-agent'] = Array.isArray(agent) ? agent[0] : agent;

    const response = await fetch(`${sandbox.domain(PORT)}/api/tracker-bridge`, {
      method: req.method,
      headers,
      body: req.method === 'POST' ? JSON.stringify(req.body ?? {}) : undefined,
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });

    const type = response.headers.get('content-type');
    if (type) res.setHeader('content-type', type);
    return res.status(response.status).send(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    return res.status(503).json({ error: 'tracker_bridge_unavailable', message: error instanceof Error ? error.message : String(error) });
  }
}
