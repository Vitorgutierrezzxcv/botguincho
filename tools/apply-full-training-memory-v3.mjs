import fs from 'node:fs';

function replaceRequired(text, before, after, label) {
  if (text.includes(after)) return text;
  if (!text.includes(before)) throw new Error(`Trecho não encontrado: ${label}`);
  return text.replace(before, after);
}

function lines(items) {
  return items.join('\n');
}

// 1) Learning engine: stronger anonymization + local full-history retrieval.
{
  const file = 'tools/learning-engine.mjs';
  let text = fs.readFileSync(file, 'utf8');

  const oldAnon = lines([
    "export function anonymizeLearningText(value = '') {",
    "  return String(value || '')",
    "    .replace(/\\b(?:\\+?55\\s*)?(?:\\(?\\d{2}\\)?\\s*)?9?\\d{4}[-\\s]?\\d{4}\\b/g, '[TELEFONE]')",
    "    .replace(/\\b[A-Z]{3}[-\\s]?\\d[A-Z0-9]\\d{2}\\b/gi, '[PLACA]')",
    "    .slice(0, 6000);",
    "}",
  ]);
  const newAnon = lines([
    "export function anonymizeLearningText(value = '') {",
    "  return String(value || '')",
    "    .replace(/\\b[\\w.+-]+@[\\w.-]+\\.[A-Za-z]{2,}\\b/g, '[EMAIL]')",
    "    .replace(/\\b(?:\\+?55\\s*)?(?:\\(?\\d{2}\\)?\\s*)?9?\\d{4}[-\\s]?\\d{4}\\b/g, '[TELEFONE]')",
    "    .replace(/\\b\\d{3}\\.?\\d{3}\\.?\\d{3}[-.]?\\d{2}\\b/g, '[DOCUMENTO]')",
    "    .replace(/\\b\\d{2}\\.?\\d{3}\\.?\\d{3}\\/?\\d{4}-?\\d{2}\\b/g, '[DOCUMENTO]')",
    "    .replace(/\\b[A-Z]{3}[-\\s]?\\d[A-Z0-9]\\d{2}\\b/gi, '[PLACA]')",
    "    .replace(/(\\b(?:BENEFICI[AÁ]RIO|SOLICITANTE|ASSOCIADO|RESPONS[AÁ]VEL|CLIENTE)\\s*:\\s*)[^\\n]+/gi, '$1[NOME]')",
    "    .replace(/(\\b(?:ENDERE[CÇ]O\\s+)?(?:ORIGEM|DESTINO)\\s*:\\s*)[^\\n]+/gi, '$1[ENDEREÇO]')",
    "    .slice(0, 6000);",
    "}",
  ]);
  text = replaceRequired(text, oldAnon, newAnon, 'anonymizeLearningText');

  const marker = "  async function getAll() { return readJson(knowledgeFile, {}); }";
  const retrieval = lines([
    "  let historyCache = { mtimeMs: -1, rows: [] };",
    "",
    "  async function loadHistoryRows() {",
    "    try {",
    "      const stat = await fs.stat(historyFile);",
    "      if (historyCache.mtimeMs === stat.mtimeMs) return historyCache.rows;",
    "      const raw = await fs.readFile(historyFile, 'utf8');",
    "      const rows = raw.split('\\n').filter(Boolean).map((line) => {",
    "        try { return JSON.parse(line); } catch { return null; }",
    "      }).filter(Boolean);",
    "      historyCache = { mtimeMs: stat.mtimeMs, rows };",
    "      return rows;",
    "    } catch (error) {",
    "      if (error?.code === 'ENOENT') return [];",
    "      throw error;",
    "    }",
    "  }",
    "",
    "  function retrievalTokens(value = '') {",
    "    const stop = new Set(['a','o','as','os','de','da','do','das','dos','e','em','no','na','nos','nas','um','uma','para','pra','pro','por','com','que','esse','essa','isso','ai','ae','pessoal','amigo']);",
    "    return normalize(value).replace(/[^a-z0-9 ]+/g, ' ').split(/\\s+/).filter((token) => token.length > 1 && !stop.has(token));",
    "  }",
    "",
    "  function retrievalCoverage(query, candidate) {",
    "    const q = new Set(retrievalTokens(query));",
    "    const c = new Set(retrievalTokens(candidate));",
    "    if (!q.size || !c.size) return 0;",
    "    let hits = 0;",
    "    for (const token of q) if (c.has(token)) hits += 1;",
    "    return hits / q.size;",
    "  }",
    "",
    "  async function searchHistory({ groupId = '', groupName = '', query = '', limit = 6 } = {}) {",
    "    const rows = await loadHistoryRows();",
    "    const q = String(query || '').trim();",
    "    if (!q || !rows.length) return [];",
    "    const wanted = Math.max(1, Math.min(8, Number(limit) || 6));",
    "    const queryIntent = inferLearningIntent(q);",
    "    const scored = [];",
    "",
    "    for (let i = 0; i < rows.length; i += 1) {",
    "      const row = rows[i];",
    "      if (!row?.text) continue;",
    "      const sameGroup = Boolean(groupId && row.groupId === groupId);",
    "      const sameName = Boolean(!sameGroup && groupName && normalize(row.groupName) === normalize(groupName));",
    "      const lexical = retrievalCoverage(q, row.text);",
    "      const intentMatch = queryIntent && queryIntent !== 'other' && row.intent === queryIntent;",
    "      const score = lexical * 0.55 + (intentMatch ? 0.25 : 0) + (sameGroup ? 0.20 : sameName ? 0.12 : 0);",
    "      if (score < (sameGroup ? 0.20 : 0.34)) continue;",
    "      scored.push({ i, row, score, sameGroup: sameGroup || sameName });",
    "    }",
    "",
    "    scored.sort((a, b) => Number(b.sameGroup) - Number(a.sameGroup) || b.score - a.score);",
    "    const selected = [];",
    "    const used = new Set();",
    "    for (const hit of scored) {",
    "      if (selected.length >= wanted) break;",
    "      const start = Math.max(0, hit.i - 2);",
    "      const end = Math.min(rows.length - 1, hit.i + 2);",
    "      const contextRows = [];",
    "      for (let j = start; j <= end; j += 1) {",
    "        const row = rows[j];",
    "        if (!row?.text || row.groupId !== hit.row.groupId) continue;",
    "        contextRows.push(row);",
    "      }",
    "      const context = contextRows.map((row) => `${row.direction === 'outgoing' ? 'PRESTADOR' : 'CENTRAL'}: ${String(row.text).slice(0, 1600)}`).join('\\n').slice(0, 5000);",
    "      const key = context.slice(0, 600);",
    "      if (!context || used.has(key)) continue;",
    "      used.add(key);",
    "      selected.push({ group: hit.row.groupName || groupName, intent: hit.row.intent || 'other', score: Math.round(hit.score * 100) / 100, text: context });",
    "    }",
    "    return selected;",
    "  }",
    "",
    marker,
  ]);
  if (!text.includes("async function searchHistory({ groupId")) {
    if (!text.includes(marker)) throw new Error('Marcador getAll não encontrado');
    text = text.replace(marker, retrieval);
  }
  text = replaceRequired(
    text,
    "  return { syncGroup, append, addHumanExample, getAll, approveCommercial, getIndex, saveIndex };",
    "  return { syncGroup, append, addHumanExample, searchHistory, getAll, approveCommercial, getIndex, saveIndex };",
    'learning store exports',
  );
  fs.writeFileSync(file, text);
}

// 2) Worker: complete import/export + local and Supabase retrieval before AI.
{
  const file = 'tools/vercel-whatsapp-worker.mjs';
  let text = fs.readFileSync(file, 'utf8');

  const clientMarker = lines([
    "function getAiClient() {",
    "  if (!aiCredential) return null;",
    "  return new OpenAI({ apiKey: aiCredential, baseURL: 'https://ai-gateway.vercel.sh/v1' });",
    "}",
  ]);
  const helper = lines([
    clientMarker,
    "",
    "async function searchPersistentTrainingContext(messageText = '', groupName = '') {",
    "  if (!adminToken || !String(messageText || '').trim()) return [];",
    "  try {",
    "    const base = String(process.env.BOTGUINCHO_APP_URL || 'https://botguincho.vercel.app').replace(/\\/$/, '');",
    "    const response = await fetch(`${base}/api/worker/training-search?companyId=${encodeURIComponent(clientId)}`, {",
    "      method: 'POST',",
    "      headers: { 'content-type': 'application/json', 'x-botguincho-token': adminToken },",
    "      body: JSON.stringify({ query: String(messageText).slice(0, 800), groupName: String(groupName).slice(0, 180), limit: 6 }),",
    "      cache: 'no-store',",
    "      signal: AbortSignal.timeout(4500),",
    "    });",
    "    if (!response.ok) return [];",
    "    const data = await response.json().catch(() => ({}));",
    "    return Array.isArray(data?.results) ? data.results : [];",
    "  } catch {",
    "    return [];",
    "  }",
    "}",
  ]);
  if (!text.includes('async function searchPersistentTrainingContext(')) {
    text = replaceRequired(text, clientMarker, helper, 'persistent training helper');
  }

  const oldAi = lines([
    "  const knowledgeEntry = await getGroupKnowledgeEntry(groupId);",
    "  const learnedContext = learningContextForGroup(groupName, knowledgeEntry);",
  ]);
  const newAi = lines([
    "  const knowledgeEntry = await getGroupKnowledgeEntry(groupId);",
    "  let learnedContext = learningContextForGroup(groupName, knowledgeEntry);",
    "  const [localHistory, persistentHistory] = await Promise.all([",
    "    learningStore.searchHistory({ groupId, groupName, query: text, limit: 5 }).catch(() => []),",
    "    searchPersistentTrainingContext(text, groupName),",
    "  ]);",
    "  const historicalCases = [",
    "    ...localHistory.map((item) => item?.text).filter(Boolean),",
    "    ...persistentHistory.map((item) => item?.sanitized_content).filter(Boolean),",
    "  ].map((item) => String(item).slice(0, 4200)).slice(0, 8);",
    "  if (historicalCases.length) {",
    "    learnedContext = [",
    "      learnedContext,",
    "      'CASOS REAIS SEMELHANTES (referência de linguagem e procedimento; nunca use valores, disponibilidade, ETA ou autorização históricos como verdade atual):',",
    "      historicalCases.join('\\n---\\n'),",
    "    ].filter(Boolean).join('\\n\\n');",
    "  }",
  ]);
  text = replaceRequired(text, oldAi, newAi, 'AI historical context');

  text = replaceRequired(
    text,
    "  const limit = Math.max(20, Math.min(2000, Number(requestedLimit || 500)));\n  const messages = await chat.fetchMessages({ limit });",
    "  const requested = requestedLimit === 'all' ? 'all' : Number(requestedLimit || 500);\n  const limit = requested === 'all' ? Infinity : Math.max(20, Math.min(10000, requested));\n  const messages = await chat.fetchMessages({ limit });",
    'full history limit',
  );
  text = replaceRequired(
    text,
    "  try { return res.json({ ok: true, ...(await importLearningHistory(String(req.body?.groupId || ''), req.body?.limit || 500)) });",
    "  try { return res.json({ ok: true, ...(await importLearningHistory(String(req.body?.groupId || ''), req.body?.limit ?? 500)) });",
    'import endpoint limit',
  );

  const exportEndpoint = lines([
    "app.get('/api/learning/export-history', async (req, res) => {",
    "  try {",
    "    const groupId = String(req.query?.groupId || '');",
    "    if (!groupId?.endsWith('@g.us')) return res.status(400).json({ ok: false, error: 'group_invalid' });",
    "    const allowed = await getAllowedGroupIds();",
    "    if (!allowed.has(groupId)) return res.status(403).json({ ok: false, error: 'group_not_authorized' });",
    "    const offset = Math.max(0, Number(req.query?.offset || 0));",
    "    const limit = Math.max(1, Math.min(1500, Number(req.query?.limit || 500)));",
    "    let raw = '';",
    "    try { raw = await fs.readFile(learningHistoryFile, 'utf8'); } catch (error) { if (error?.code !== 'ENOENT') throw error; }",
    "    const rows = raw.split('\\n').filter(Boolean).map((line) => { try { return JSON.parse(line); } catch { return null; } }).filter((row) => row?.groupId === groupId);",
    "    rows.sort((a, b) => new Date(a.at || 0) - new Date(b.at || 0));",
    "    const page = rows.slice(offset, offset + limit);",
    "    const knowledge = await getGroupKnowledgeEntry(groupId).catch(() => null);",
    "    return res.json({ ok: true, groupId, groupName: knowledge?.name || page[0]?.groupName || 'Grupo do WhatsApp', total: rows.length, offset, limit, rows: page });",
    "  } catch (error) {",
    "    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : String(error) });",
    "  }",
    "});",
    "",
  ]);
  if (!text.includes("app.get('/api/learning/export-history'")) {
    const summaryMarker = "app.get('/api/learning/summary', async (_req, res) => {";
    if (!text.includes(summaryMarker)) throw new Error('Marcador learning summary não encontrado');
    text = text.replace(summaryMarker, exportEndpoint + summaryMarker);
  }

  fs.writeFileSync(file, text);
}

// 3) Dashboard button: complete import + Supabase sync.
for (const file of ['app.js', 'public/app.js']) {
  let text = fs.readFileSync(file, 'utf8');
  const old = "window.importGroupHistory=async id=>{if(!confirm('Importar até 1.000 mensagens disponíveis deste grupo para aprendizado? O robô não responderá mensagens antigas.'))return;const d=await api('/api/worker/learning-import',{method:'POST',body:JSON.stringify({groupId:id,limit:1000})});alert(`${d.imported||0} mensagens novas importadas.`);await loadKnowledge()};";
  const next = "window.importGroupHistory=async id=>{if(!confirm('Importar todo o histórico disponível deste grupo para aprendizado? O robô não responderá mensagens antigas.'))return;const d=await api('/api/worker/training-sync',{method:'POST',body:JSON.stringify({action:'sync',groupId:id,importFirst:true})});alert(`Histórico sincronizado: ${d.totalMessages||0} mensagens na memória · ${d.imported||0} novas nesta importação.`);await loadKnowledge()};";
  text = replaceRequired(text, old, next, `UI ${file}`);
  text = text.replace('>Importar histórico</button>', '>Importar histórico completo</button>');
  fs.writeFileSync(file, text);
}

console.log('FULL_TRAINING_MEMORY_PATCH_OK');
