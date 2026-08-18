from pathlib import Path
p=Path('tools/vercel-whatsapp-worker.mjs')
s=p.read_text()

old="""  const context = memory
    .map((item) => `${item.role === 'assistant' ? 'Atendente' : 'Pessoa'}: ${item.text}`)
    .join('\\n');
  const live = trackerContext ? `\\n\\nDADOS AO VIVO LIDOS DO APP GCONNECT NO ANDROID:\\n${trackerContext}` : '';
  const content = [{
    type: 'input_text',
    text: `Grupo: ${groupName || groupId}\\nAutor: ${author || 'participante'}\\nHistórico recente:\\n${context || '(sem histórico)'}${live}\\n\\nMensagem atual:\\n${text || '[mensagem sem texto]'}`,
  }];
"""
new="""  const context = memory
    .map((item) => `${item.role === 'assistant' ? 'Atendente' : 'Pessoa'}: ${item.text}`)
    .join('\\n');
  const knowledge = (await learningStore.getAll())[groupId] || null;
  const learnedExamples = Array.isArray(knowledge?.examples) ? knowledge.examples.slice(-6) : [];
  const learnedText = learnedExamples.length
    ? `\\n\\nEXEMPLOS REAIS APRENDIDOS NESTE GRUPO (use apenas como referência de estilo e decisão operacional; nunca copie dados pessoais nem invente valores):\\n${learnedExamples.map((item) => `Recebido: ${item.trigger || '(sem contexto)'}\\nHumano respondeu: ${item.reply}`).join('\\n---\\n')}`
    : '';
  const live = trackerContext ? `\\n\\nDADOS AO VIVO LIDOS DO APP GCONNECT NO ANDROID:\\n${trackerContext}` : '';
  const content = [{
    type: 'input_text',
    text: `Grupo: ${groupName || groupId}\\nAutor: ${author || 'participante'}\\nHistórico recente:\\n${context || '(sem histórico)'}${learnedText}${live}\\n\\nMensagem atual:\\n${text || '[mensagem sem texto]'}`,
  }];
"""
if old not in s: raise SystemExit('ai context marker missing')
s=s.replace(old,new,1)

# Mark free-form AI reply so message_create does not learn the bot's own answer as human feedback.
old2="""    await msg.reply(reply);
    remember(msg.from, 'assistant', reply);
    logEvent('reply', `${groupName}: ${reply}`, { groupId: msg.from, intent: 'operational-ai' });
"""
new2="""    botReplyFingerprints.set(`${msg.from}|${normalizeForIntent(reply)}`, Date.now());
    await msg.reply(reply);
    remember(msg.from, 'assistant', reply);
    logEvent('reply', `${groupName}: ${reply}`, { groupId: msg.from, intent: 'operational-ai' });
"""
if old2 not in s: raise SystemExit('ai reply marker missing')
s=s.replace(old2,new2,1)

marker="app.get('/api/status', async (_req, res) => {"
block="""app.get('/api/learning/summary', async (_req, res) => {\n  try {\n    let raw = '';\n    try { raw = await fs.readFile(learningHistoryFile, 'utf8'); } catch (error) { if (error?.code !== 'ENOENT') throw error; }\n    const rows = raw.split('\\n').filter(Boolean).slice(-5000).map((line) => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);\n    const byIntent = {};\n    const byGroup = {};\n    for (const row of rows) {\n      byIntent[row.intent || 'unknown'] = (byIntent[row.intent || 'unknown'] || 0) + 1;\n      byGroup[row.groupId || 'unknown'] = (byGroup[row.groupId || 'unknown'] || 0) + 1;\n    }\n    const knowledge = await learningStore.getAll();\n    return res.json({ ok: true, records: rows.length, byIntent, byGroup, knowledgeGroups: Object.keys(knowledge).length, commercialReviewRequired: Object.values(knowledge).filter((x) => x.commercialStatus === 'review_required').length });\n  } catch (error) {\n    return res.status(500).json({ ok: false, error: String(error?.message || error) });\n  }\n});\n\n"""
if marker not in s: raise SystemExit('summary marker missing')
s=s.replace(marker,block+marker,1)
p.write_text(s)
print('ok')
