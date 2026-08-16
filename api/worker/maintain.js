import { maintainWorker, requestCredential, requestTenant } from '../../lib/sandbox-runtime.js';

const REPO = 'Vitorgutierrezzxcv/botguincho';

async function isGitHubActionsToken(req) {
  const auth = String(req.headers.authorization || '');
  if (!auth.startsWith('Bearer ')) return false;

  try {
    const response = await fetch('https://api.github.com/installation/repositories?per_page=100', {
      headers: {
        authorization: auth,
        accept: 'application/vnd.github+json',
        'user-agent': 'botguincho-worker-maintainer',
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

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  res.setHeader('cache-control', 'no-store');

  if (!(await isGitHubActionsToken(req))) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    const tenant = requestTenant(req);
    const result = await maintainWorker(requestCredential(req, tenant), tenant);
    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
