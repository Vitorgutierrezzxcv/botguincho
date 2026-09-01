import fs from 'node:fs';

function replaceRequired(text, before, after, label) {
  if (text.includes(after)) return text;
  if (!text.includes(before)) throw new Error(`Trecho não encontrado: ${label}`);
  return text.replace(before, after);
}

// 1) Learning engine: anonimização mais forte + busca lexical no histórico integral.
{
  const file = 'tools/learning-engine.mjs';
  let text = fs.readFileSync(file, 'utf8');
  const oldAnon = `export function anonymizeLearningText(value = '') {\n  return String(value || '')\n    .replace(/\\b(?:\\+?55\\s*)?(?:\\(?\\d{2}\\)?\\s*)?9?\\d{4}[-\\s]?\\d{4}\\b/g, '[TELEFONE]')\n    .replace(/\\b[A-Z]{3}[-\\s]?\\d[A-Z0-9]\\d{2}\\b/gi, '[PLACA]')\n    .slice(0, 6000);\n}`;
  const newAnon = `export function anonymizeLearningText(value = '') {\n  return String(value || '')\n    .replace(/\\b[\\w.+-]+@[\\w.-]+\\.[A-Za-z]{2,}\\b/g, '[EMAIL]')\n    .replace(/\\b(?:\\+?55\\s*)?(?:\\(?\\d{2}\\)?\\s*)?9?\\d{4}[-\\s]?\\d{4}\\b/g, '[TELEFONE]')\n    .replace(/\\b\\d{3}\\.?\\d{3}\\.?\\d{3}[-.]?\\d{2}\\b/g, '[DOCUMENTO]')\n    .replace(/\\b\\d{2}\\.?\\d{3}\\.?\\d{3}\\/?\\d{4}-?\\d{2}\\b/g, '[DOCUMENTO]')\n    .replace(/\\b[A-Z]{3}[-\\s]?\\d[A-Z0-9]\\d{2}\\b/gi, '[PLACA]')\n    .replace(/(\\b(?:BENEFICI[AÁ]RIO|SOLICITANTE|ASSOCIADO|RESPONS[AÁ]VEL|CLIENTE)\\s*:\\s*)[^\\n]+/gi, '$1[NOME]')\n    .replace(/(\\b(?:ENDERE[CÇ]O\\s+)?(?:ORIGEM|DESTINO)\\s*:\\s*)[^\\n]+/gi, '$1[ENDEREÇO]')\n    .slice(0, 6000);\n}`;
  text = replaceRequired(text, oldAnon, newAnon, 'anonymizeLearningText');

  const marker = `  async function getAll() { return readJson(knowledgeFile, {}); }`;
  const addition = `  let historyCache = { mtimeMs: -1, rows: [] };\n\n  async function loadHistoryRows() {\n    try {\n      const stat = await fs.stat(historyFile);\n      if (historyCache.mtimeMs === stat.mtimeMs) return historyCache.rows;\n      const raw = await fs.readFile(historyFile, 'utf8');\n      const rows = raw.split('\\n').filter(Boolean).map((line) => {\n        try { return JSON.parse(line); } catch { return null; }\n      }).filter(Boolean);\n      historyCache = { mtimeMs: stat.mtimeMs, rows };\n      return rows;\n    } catch (error) {\n      if (error?.code === 'ENOENT') return [];\n      throw error;\n    }\n  }\n\n  function retrievalTokens(value = '') {\n    const stop = new Set(['a','o','as','os','de','da','do','das','dos','e','em','no','na','nos','nas','um','uma','para','pra','pro','por','com','que','esse','essa','isso','ai','ae','pessoal','amigo']);\n    return normalize(value).replace(/[^a-z0-9 ]+/g, ' ').split(/\\s+/).filter((token) => token.length > 1 && !stop.has(token));\n  }\n\n  function retrievalCoverage(query, candidate) {\n    const q = new Set(retrievalTokens(query));\n    const c = new Set(retrievalTokens(candidate));\n    if (!q.size || !c.size) return 0;\n    let hits = 0;\n    for (const token of q) if (c.has(token)) hits += 1;\n    return hits / q.size;\n  }\n\n  async function searchHistory({ groupId = '', groupName = '', query = '', limit = 6 } = {}) {\n    const rows = await loadHistoryRows();\n    const q = String(query || '').trim();\n    if (!q || !rows.length) return [];\n    const wanted = Math.max(1, Math.min(8, Number(limit) || 6));\n    const queryIntent = inferLearningIntent(q);\n    const scored = [];\n\n    for (let i = 0; i < rows.length; i += 1) {\n      const row = rows[i];\n      if (!row?.text) continue;\n      const sameGroup = groupId && row.groupId === groupId;\n      const sameName = !sameGroup && groupName && normalize(row.groupName) === normalize(groupName);\n      const lexical = retrievalCoverage(q, row.text);\n      const intentMatch = queryIntent && queryIntent !== 'other' && row.intent === queryIntent;\n      const score = lexical * 0.55 + (intentMatch ? 0.25 : 0) + (sameGroup ? 0.20 : sameName ? 0.12 : 0);\n      if (score < (sameGroup ? 0.20 : 0.34)) continue;\n      scored.push({ i, row, score, sameGroup: Boolean(sameGroup || sameName) });\n    }\n\n    scored.sort((a, b) => Number(b.sameGroup) - Number(a.sameGroup) || b.score - a.score);\n    const selected = [];\n    const used = new Set();\n    for (const hit of scored) {\n      if (selected.length >= wanted) break;\n      const start = Math.max(0, hit.i - 2);\n      const end = Math.min(rows.length - 1, hit.i + 2);\n      const contextRows = [];\n      for (let j = start; j <= end; j += 1) {\n        const row = rows[j];\n        if (!row?.text || row.groupId !== hit.row.groupId) continue;\n        contextRows.push(row);\n      }\n      const context = contextRows.map((row) => \\`\\${row.direction === 'outgoing' ? 'PRESTADOR' : 'CENTRAL'}: \\${String(row.text).slice(0, 1600)}\\`).join('\\n').slice(0, 5000);\n      const key = context.slice(0, 600);\n      if (!context || used.has(key)) continue;\n      used.add(key);\n      selected.push({ group: hit.row.groupName || groupName, intent: hit.row.intent || 'other', score: Math.round(hit.score * 100) / 100, text: context });\n    }\n    return selected;\n  }\n\n${marker}`;
  if (!text.includes('async function searchHistory({ groupId')) {
    if (!text.includes(marker)) throw new Error('Marcador getAll não encontrado');
    text = text.replace(marker, addition);
  }
  text = replaceRequired(
    text,
    `  return { syncGroup, append, addHumanExample, getAll, approveCommercial, getIndex, saveIndex };`,
    `  return { syncGroup, append, addHumanExample, searchHistory, getAll, approveCommercial, getIndex, saveIndex };`,
    'learning store exports',
  );
  fs.writeFileSync(file, text);
}

// 2) Worker: importação completa, export paginado e contexto local + Supabase antes da IA.
{
  const file = 'tools/vercel-whatsapp-worker.mjs';
  let text = fs.readFileSync(file, 'utf8');

  const clientMarker = `function getAiClient() {\n  if (!aiCredential) return null;\n  return new OpenAI({ apiKey: aiCredential, baseURL: 'https://ai-gateway.vercel.sh/v1' });\n}`;
  const clientWithMemory = `${clientMarker}\n\nasync function searchPersistentTrainingContext(text = '', groupName = '') {\n  if (!adminToken || !String(text || '').trim()) return [];\n  try {\n    const base = String(process.env.BOTGUINCHO_APP_URL || 'https://botguincho.vercel.app').replace(/\\/$/, '');\n    const response = await fetch(\\`${'${base}'}/api/worker/training-search?companyId=\\${encodeURIComponent(clientId)}\\`, {\n      method: 'POST',\n      headers: { 'content-type': 'application/json', 'x-botguincho-token': adminToken },\n      body: JSON.stringify({ query: String(text).slice(0, 800), groupName: String(groupName).slice(0, 180), limit: 6 }),\n      cache: 'no-store',\n      signal: AbortSignal.timeout(4500),\n    });\n    if (!response.ok) return [];\n    const data = await response.json().catch(() => ({}));\n    return Array.isArray(data?.results) ? data.results : [];\n  } catch {\n    return [];\n  }\n}`;
  if (!text.includes('async function searchPersistentTrainingContext(')) {
    text = replaceRequired(text, clientMarker, clientWithMemory, 'persistent training helper');
  }

  const oldAi = `  const knowledgeEntry = await getGroupKnowledgeEntry(groupId);\n  const learnedContext = learningContextForGroup(groupName, knowledgeEntry);`;
  const newAi = `  const knowledgeEntry = await getGroupKnowledgeEntry(groupId);\n  let learnedContext = learningContextForGroup(groupName, knowledgeEntry);\n  const [localHistory, persistentHistory] = await Promise.all([\n    learningStore.searchHistory({ groupId, groupName, query: text, limit: 5 }).catch(() => []),\n    searchPersistentTrainingContext(text, groupName),\n  ]);\n  const historicalCases = [\n    ...localHistory.map((item) => item?.text).filter(Boolean),\n    ...persistentHistory.map((item) => item?.sanitized_content).filter(Boolean),\n  ].map((item) => String(item).slice(0, 4200)).slice(0, 8);\n  if (historicalCases.length) {\n    learnedContext = [\n      learnedContext,\n      'CASOS REAIS SEMELHANTES (referência de linguagem e procedimento; nunca use valores, disponibilidade, ETA ou autorização históricos como verdade atual):',\n      historicalCases.join('\\n---\\n'),\n    ].filter(Boolean).join('\\n\\n');\n  }`;
  text = replaceRequired(text, oldAi, newAi, 'AI historical context');

  text = replaceRequired(
    text,
    `  const limit = Math.max(20, Math.min(2000, Number(requestedLimit || 500)));\n  const messages = await chat.fetchMessages({ limit });`,
    `  const requested = requestedLimit === 'all' ? 'all' : Number(requestedLimit || 500);\n  const limit = requested === 'all' ? Infinity : Math.max(20, Math.min(10000, requested));\n  const messages = await chat.fetchMessages({ limit });`,
    'full history limit',
  );
  text = replaceRequired(
    text,
    `  try { return res.json({ ok: true, ...(await importLearningHistory(String(req.body?.groupId || ''), req.body?.limit || 500)) });`,
    `  try { return res.json({ ok: true, ...(await importLearningHistory(String(req.body?.groupId || ''), req.body?.limit ?? 500)) });`,
    'import endpoint limit',
  );

  const importEndpoint = `app.post('/api/learning/import-history', async (req, res) => {\n  try { return res.json({ ok: true, ...(await importLearningHistory(String(req.body?.groupId || ''), req.body?.limit ?? 500)) });\n  catch (error) { return res.status(400).json({ ok: false, error: String(error?.message || error) }); }\n});`;
  const exportEndpoint = `${importEndpoint}\n\napp.get('/api/learning/export-history', async (req, res) => {\n  try {\n    const groupId = String(req.query?.groupId || '');\n    if (!groupId?.endsWith('@g.us')) return res.status(400).json({ ok: false, error: 'group_invalid' });\n    const allowed = await getAllowedGroupIds();\n    if (!allowed.has(groupId)) return res.status(403).json({ ok: false, error: 'group_not_authorized' });\n    const offset = Math.max(0, Number(req.query?.offset || 0));\n    const limit = Math.max(1, Math.min(1500, Number(req.query?.limit || 500)));\n    let raw = '';\n    try { raw = await fs.readFile(learningHistoryFile, 'utf8'); } catch (error) { if (error?.code !== 'ENOENT') throw error; }\n    const rows = raw.split('\\n').filter(Boolean).map((line) => { try { return JSON.parse(line); } catch { return null; } }).filter((row) => row?.groupId === groupId);\n    rows.sort((a, b) => new Date(a.at || 0) - new Date(b.at || 0));\n    const page = rows.slice(offset, offset + limit);\n    const knowledge = await getGroupKnowledgeEntry(groupId).catch(() => null);\n    return res.json({ ok: true, groupId, groupName: knowledge?.name || page[0]?.groupName || 'Grupo do WhatsApp', total: rows.length, offset, limit, rows: page });\n  } catch (error) {\n    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : String(error) });\n  }\n});`;
  if (!text.includes("app.get('/api/learning/export-history'")) {
    if (!text.includes(importEndpoint)) throw new Error('Endpoint de importação não encontrado para inserir export');
    text = text.replace(importEndpoint, exportEndpoint);
  }
  fs.writeFileSync(file, text);
}

// 3) Painel: botão passa a importar tudo e sincronizar com a memória persistente.
for (const file of ['app.js', 'public/app.js']) {
  let text = fs.readFileSync(file, 'utf8');
  const old = `window.importGroupHistory=async id=>{if(!confirm('Importar até 1.000 mensagens disponíveis deste grupo para aprendizado? O robô não responderá mensagens antigas.'))return;const d=await api('/api/worker/learning-import',{method:'POST',body:JSON.stringify({groupId:id,limit:1000})});alert(\\`${'${d.imported||0}'} mensagens novas importadas.\\`);await loadKnowledge()};`;
  const next = `window.importGroupHistory=async id=>{if(!confirm('Importar todo o histórico disponível deste grupo para aprendizado? O robô não responderá mensagens antigas.'))return;const d=await api('/api/worker/training-sync',{method:'POST',body:JSON.stringify({action:'sync',groupId:id,importFirst:true})});alert(\\`Histórico sincronizado: \\${d.totalMessages||0} mensagens na memória · \\${d.imported||0} novas nesta importação.\\`);await loadKnowledge()};`;
  text = replaceRequired(text, old, next, `UI ${file}`);
  text = text.replace('>Importar histórico</button>', '>Importar histórico completo</button>');
  fs.writeFileSync(file, text);
}

console.log('FULL_TRAINING_MEMORY_PATCH_OK');
