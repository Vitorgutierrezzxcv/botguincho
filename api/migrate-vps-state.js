import { ensureWorkerSandbox, maintainWorker } from '../lib/sandbox-runtime.js';

export default async function handler(req, res) {
  res.setHeader('cache-control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  const oldUrl = String(process.env.BOTGUINCHO_WORKER_URL || '').trim().replace(/\/+$/, '');
  const oldToken = String(process.env.BOTGUINCHO_ADMIN_TOKEN || '').trim();
  if (!oldUrl || !oldToken) {
    return res.status(503).json({ ok: false, error: 'legacy_worker_env_missing' });
  }

  const sandbox = await ensureWorkerSandbox('cliente-teste');

  await sandbox.runCommand({
    cmd: 'bash',
    args: ['-lc', "pkill -f '[n]ode tools/vercel-whatsapp-worker.mjs' >/dev/null 2>&1 || true"],
    signal: AbortSignal.timeout(8000),
  }).catch(() => undefined);

  const migrationScript = String.raw`
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const base = String(process.env.OLD_URL || '').replace(/\\/+$/, '');
const token = process.env.OLD_TOKEN || '';
const clientId = 'cliente-teste';
const clientDir = '/vercel/sandbox/.botguincho-data/' + clientId;

async function fetchJson(route) {
  const response = await fetch(base + route, {
    headers: { 'x-botguincho-token': token, 'content-type': 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(15000),
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!response.ok) throw new Error(route + ': HTTP ' + response.status + ' ' + JSON.stringify(data).slice(0,500));
  return data;
}

async function writeJson(name, value) {
  await fs.writeFile(path.join(clientDir, name), JSON.stringify(value, null, 2), { mode: 0o600 });
}

(async () => {
  await fs.mkdir(clientDir, { recursive: true });
  const backupDir = path.join(clientDir, 'pre-vps-migration-' + Date.now());
  await fs.mkdir(backupDir, { recursive: true });

  const filesToBackup = [
    'settings.json','management.json','groups.json','group-registry.json',
    'group-knowledge.json','learning-history.jsonl','learning-index.json',
    'gconnect-reading.json','audit.jsonl','test-center.json'
  ];
  for (const name of filesToBackup) {
    await fs.copyFile(path.join(clientDir, name), path.join(backupDir, name)).catch(() => undefined);
  }

  const [settingsRaw, managementRaw, groupsRaw, knowledgeRaw, trackerRaw, auditRaw, testRaw, learningRaw] =
    await Promise.all([
      fetchJson('/api/settings'),
      fetchJson('/api/management'),
      fetchJson('/api/groups'),
      fetchJson('/api/group-knowledge'),
      fetchJson('/api/tracker'),
      fetchJson('/api/audit?limit=200'),
      fetchJson('/api/test-center'),
      fetchJson('/api/learning/summary'),
    ]);

  const settings = { ...(settingsRaw || {}) };
  delete settings.apiKeyConfigured;

  const management = managementRaw?.data || {};
  const groups = Array.isArray(groupsRaw?.groups) ? groupsRaw.groups : [];
  const knowledgeGroups = Array.isArray(knowledgeRaw?.groups) ? knowledgeRaw.groups : [];
  const learningGroups = Array.isArray(learningRaw?.groups) ? learningRaw.groups : [];

  const selected = new Set();
  for (const g of groups) if (g?.selected && g?.id) selected.add(g.id);
  for (const g of learningGroups) if (g?.groupId) selected.add(g.groupId);
  for (const g of knowledgeGroups) if (g?.groupId) selected.add(g.groupId);

  const registry = {};
  for (const g of groups) {
    if (!g?.id) continue;
    registry[g.id] = {
      id: g.id,
      name: g.name || 'Grupo do WhatsApp',
      description: g.description || '',
      lastSeenAt: g.lastSeenAt || new Date().toISOString(),
    };
  }
  for (const g of knowledgeGroups) {
    if (!g?.groupId || registry[g.groupId]) continue;
    registry[g.groupId] = {
      id: g.groupId,
      name: g.name || 'Grupo do WhatsApp',
      description: g.description || '',
      lastSeenAt: g.updatedAt || new Date().toISOString(),
    };
  }

  const knowledge = {};
  for (const g of knowledgeGroups) if (g?.groupId) knowledge[g.groupId] = g;

  const historyRows = [];
  for (const groupId of selected) {
    let offset = 0;
    while (true) {
      const page = await fetchJson('/api/learning/export-history?groupId=' + encodeURIComponent(groupId) + '&offset=' + offset + '&limit=1500');
      const rows = Array.isArray(page?.rows) ? page.rows : [];
      historyRows.push(...rows);
      offset += rows.length;
      if (!rows.length || offset >= Number(page?.total || 0)) break;
    }
  }
  historyRows.sort((a,b) => new Date(a?.at || 0) - new Date(b?.at || 0));
  const index = {};
  for (const row of historyRows) {
    if (!row.id) {
      row.id = crypto.createHash('sha1').update(
        String(row.at || '') + '|' + String(row.groupId || '') + '|' + String(row.direction || '') + '|' + String(row.text || '')
      ).digest('hex');
    }
    index[row.id] = row.at || new Date().toISOString();
  }

  await writeJson('settings.json', settings);
  await writeJson('management.json', management);
  await writeJson('groups.json', { groupIds: [...selected] });
  await writeJson('group-registry.json', registry);
  await writeJson('group-knowledge.json', knowledge);
  await fs.writeFile(path.join(clientDir, 'learning-history.jsonl'),
    historyRows.map(row => JSON.stringify(row)).join('\\n') + (historyRows.length ? '\\n' : ''), { mode: 0o600 });
  await writeJson('learning-index.json', index);

  if (trackerRaw?.lastLocation) await writeJson('gconnect-reading.json', trackerRaw.lastLocation);

  const auditEntries = Array.isArray(auditRaw?.entries) ? auditRaw.entries.slice().reverse() : [];
  await fs.writeFile(path.join(clientDir, 'audit.jsonl'),
    auditEntries.map(row => JSON.stringify(row)).join('\\n') + (auditEntries.length ? '\\n' : ''), { mode: 0o600 });

  await writeJson('test-center.json', { history: Array.isArray(testRaw?.history) ? testRaw.history : [] });

  const summary = {
    ok: true,
    backupDir,
    counts: {
      calls: Array.isArray(management?.calls) ? management.calls.length : 0,
      clients: Array.isArray(management?.clients) ? management.clients.length : 0,
      insurers: Array.isArray(management?.insurers) ? management.insurers.length : 0,
      finance: Array.isArray(management?.finance) ? management.finance.length : 0,
      fleet: Array.isArray(management?.fleet) ? management.fleet.length : 0,
      billingProfiles: Array.isArray(management?.billingProfiles) ? management.billingProfiles.length : 0,
      driverPayrolls: Array.isArray(management?.driverPayrolls) ? management.driverPayrolls.length : 0,
      groupsDiscovered: groups.length,
      groupsSelected: selected.size,
      knowledgeGroups: knowledgeGroups.length,
      historyRows: historyRows.length,
      auditEntries: auditEntries.length,
      testRuns: Array.isArray(testRaw?.history) ? testRaw.history.length : 0,
      trackerCopied: Boolean(trackerRaw?.lastLocation),
    },
  };
  process.stdout.write(JSON.stringify(summary));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
`;

  const result = await sandbox.runCommand({
    cmd: 'node',
    args: ['-e', migrationScript],
    env: { OLD_URL: oldUrl, OLD_TOKEN: oldToken },
    signal: AbortSignal.timeout(55000),
  });

  let stdout = '';
  let stderr = '';
  try { stdout = await result.stdout(); } catch {}
  try { stderr = await result.stderr(); } catch {}

  if (result.exitCode !== 0) {
    await maintainWorker(process.env.VERCEL_OIDC_TOKEN || process.env.AI_GATEWAY_API_KEY || '', 'cliente-teste').catch(() => undefined);
    return res.status(500).json({ ok: false, error: 'migration_command_failed', exitCode: result.exitCode, stderr: stderr.slice(-4000) });
  }

  const restarted = await maintainWorker(process.env.VERCEL_OIDC_TOKEN || process.env.AI_GATEWAY_API_KEY || '', 'cliente-teste');
  let summary = {};
  try { summary = JSON.parse(stdout || '{}'); } catch { summary = { raw: stdout.slice(-4000) }; }

  return res.status(200).json({ ...summary, restarted });
}
