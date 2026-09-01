import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { inferTrainedIntent } from './trained-intent-engine.mjs';

function normalize(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(?:[a-z]\s+){2,}[a-z]\b/g, (match) => match.replace(/\s+/g, ''))
    .replace(/\s+/g, ' ')
    .trim();
}

function brNumber(value) {
  const text = String(value ?? '').trim().replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

export function anonymizeLearningText(value = '') {
  return String(value || '')
    .replace(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, '[EMAIL]')
    .replace(/\b(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?9?\d{4}[-\s]?\d{4}\b/g, '[TELEFONE]')
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}[-.]?\d{2}\b/g, '[DOCUMENTO]')
    .replace(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, '[DOCUMENTO]')
    .replace(/\b[A-Z]{3}[-\s]?\d[A-Z0-9]\d{2}\b/gi, '[PLACA]')
    .replace(/(\b(?:BENEFICI[AÁ]RIO|SOLICITANTE|ASSOCIADO|RESPONS[AÁ]VEL|CLIENTE)\s*:\s*)[^\n]+/gi, '$1[NOME]')
    .replace(/(\b(?:ENDERE[CÇ]O\s+)?(?:ORIGEM|DESTINO)\s*:\s*)[^\n]+/gi, '$1[ENDEREÇO]')
    .slice(0, 6000);
}

export function inferLearningIntent(text = '') {
  const value = normalize(text);
  if (!value) return 'empty';

  const hasOperationalContext = /\b(origem|destino|veiculo|placa|protocolo|reboque|guincho|pane|sinistro|servico|acionamento|associado|associacao|remocao)\b/.test(value);
  const administrativeSignal = /\b(reuniao|comunicado(?: interno)?|aviso(?: geral)?|treinamento|rotina financeira|financeiro|atualizacao de cadastro|documentos|tabelas de valores|pagamentos? dia|contas)\b/.test(value);

  // Horário em um comunicado (por exemplo, uma reunião amanhã às 9h) não é
  // agendamento de guincho. Exige também contexto operacional do atendimento.
  if (administrativeSignal && !hasOperationalContext) return 'administrative_notice';

  if (/\b(cancelou|cancelado|cancelada|pode deixar|conseguiu resolver|nao precisa mais|passou para outro|passar para outro|ja foi|protocolo errado|desconsidera|desconsiderar|sem saida|sem custos)\b/.test(value)) {
    return 'cancellation';
  }

  if (
    /\b(grupo (?:e|é) destinado exclusivamente|evitem o envio de mensagens informando disponibilidade|rotina financeira|pagamentos dia|atualizacao de cadastro|tabelas de valores|documentos|contas)\b/.test(value)
    || (/\bparceiros prestadores\b/.test(value) && /\b(?:financeiro|cadastro|pagamento|documentos)\b/.test(value))
  ) {
    return 'administrative_notice';
  }

  if (
    /\bpor enquanto nao siga\b/.test(value)
    || /\b(?:aguarde|aguarda|aguardando)\b.*\bautoriza/.test(value)
    || /\b(?:vou|vamos)\s+passar\b.*\b(?:adm|administrativo|setor)\b/.test(value)
    || /\b(?:caso|se)\s+autorizarem\b/.test(value)
    || /\bassim que (?:for|estiver) autorizado\b/.test(value)
  ) {
    return 'pending_approval';
  }

  // Follow-ups curtos de agenda aparecem logo depois de uma cotacao completa.
  // Comunicados administrativos ja foram filtrados acima, portanto "amanha as 7"
  // pode ser tratado como agendamento sem exigir repetir origem/destino.
  const shortSchedule = /^(?:amanha|hoje)(?:\s+(?:as|a))?\s+\d{1,2}(?:(?::|h)\d{0,2})?$/i.test(value);
  if (
    /\b(agendamento|agendado|agendada)\b/.test(value)
    || shortSchedule
    || /\bamanha\s+(?:as|a)?\s*\d{1,2}(?:(?::|h)\d{0,2})?\b/.test(value)
    || /\bpara o dia\s+\d{1,2}[\/.-]\d{1,2}/.test(value)
  ) {
    return 'scheduled_dispatch';
  }

  if (/\b(pode\s*(?:seguir|prosseguir|continuar|ir)|liberado|libera|autorizado|autorizada)\b/.test(value) || /^(?:seguir|prosseguir)\??$/.test(value)) return 'authorization';

  const hasClosingSignal = /\b(finalizamos|finalizado|finalizada|fechamento|fechado|concluido|concluida)\b/.test(value);
  const hasClosingData = /\b(km\s*total|km\s*totais|quilometragem\s*total|valor\s*total|fotos\s+no\s+destino|fotos\s+na\s+origem)\b/.test(value);
  if (hasClosingSignal || (hasClosingData && /\b(confere|final|fechar|fechamento)\b/.test(value))) return 'closure';

  if (/\b(valor|quanto fica|cotacao|preco|previa|km totais|quilometragem|valor de saida|valor da saida|qual valor total)\b/.test(value)) return 'quote';
  if (/\b(disponivel|disponibilidade|consegue esse|consegue uma remocao|tem reboque|tem guincho)\b/.test(value)) return 'availability';
  if (/\b(quanto tempo|previsao|eta|chega em|demora)\b/.test(value)) return 'eta';
  if (/\b(origem|destino|reboque|guincho|veiculo|pane|colisao|remocao|protocolo)\b/.test(value)) return 'dispatch';

  // Só consulta o corpus histórico quando as regras atuais não reconheceram a mensagem.
  // Isso mantém as regras críticas como fonte da verdade e usa o treinamento sem IA/token.
  const trainedIntent = inferTrainedIntent(text);
  if (trainedIntent) return trainedIntent;
  return 'other';
}

export function parseCommercialDescription(description = '') {
  const raw = String(description || '').trim();
  const lines = raw.replace(/\r/g, '').split('\n').map((x) => x.trim()).filter(Boolean);
  const services = {};
  const aliases = [
    ['leve', /(?:reboque\s+leve|\bleve\b)/i],
    ['moto', /(?:reboque\s+moto|\bmoto\b)/i],
    ['utilitario', /(?:reboque\s+utilit[aá]rio|\butilit[aá]rio\b)/i],
    ['pesado', /(?:reboque\s+pesado|\bpesado\b)/i],
  ];
  for (let i = 0; i < lines.length; i += 1) {
    const key = aliases.find(([, re]) => re.test(lines[i]))?.[0];
    if (!key) continue;
    const text = [lines[i], lines[i + 1] || '', lines[i + 2] || '', lines[i + 3] || ''].join(' ');
    const base = text.match(/(?:sa[ií]da\s*)?(?:r\$\s*)?(\d{2,4}[.,]\d{2})/i);
    const included = text.match(/at[eé]\s*(\d{1,4})\s*km/i);
    const perKm = text.match(/(?:^|\s)(\d{1,2}[.,]\d{2})\s*(?:por\s*km|\/\s*km|km\b)/i);
    const earth = text.match(/(?:estrada\s+de\s+terra|kmt)\s*[:r$\s]*(\d{1,2}[.,]\d{2})/i);
    services[key] = {
      basePrice: base ? brNumber(base[1]) : null,
      includedKm: included ? Number(included[1]) : null,
      pricePerKm: perKm ? brNumber(perKm[1]) : null,
      dirtRoadPricePerKm: earth ? brNumber(earth[1]) : null,
    };
  }
  const worked = raw.match(/(?:hora\s+trabalhada|\bhp\b)\s*[:r$\s]*(\d{1,4}[.,]\d{2})/i);
  const stopped = raw.match(/(?:hora\s+parada|\bht\b)\s*[:r$\s]*(\d{1,4}[.,]\d{2})/i);
  const invoice = raw.match(/(?:nota\s+fiscal|\bnf\b|emiss[aã]o\s+de\s+nf)\s*[:+r$\s]*(\d{1,4}[.,]\d{2})/i);
  const tollAllowed = /\bped[aá]gio\b/i.test(raw) && !/\bped[aá]gio\b[^\n]{0,40}\b(?:nao|não)\s+(?:paga|incluso|aceito)\b/i.test(raw);
  const noSkates = /n[aã]o\s+tem\s+patins?/i.test(raw);
  return {
    raw,
    services,
    workedHour: worked ? brNumber(worked[1]) : null,
    stoppedHour: stopped ? brNumber(stopped[1]) : null,
    invoiceFee: invoice ? brNumber(invoice[1]) : null,
    tollAllowed,
    noSkates,
    detected: Boolean(Object.keys(services).length || worked || stopped || invoice || tollAllowed || noSkates),
  };
}

export function createLearningStore({ knowledgeFile, historyFile, indexFile }) {
  const readJson = async (file, fallback) => {
    try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch (error) { if (error?.code === 'ENOENT') return fallback; throw error; }
  };
  const writeJson = async (file, value) => fs.writeFile(file, JSON.stringify(value, null, 2), { mode: 0o600 });

  async function syncGroup({ groupId, name = '', description = '' }) {
    const all = await readJson(knowledgeFile, {});
    const prev = all[groupId] || {};
    const desc = String(description || '').trim();
    const hash = desc ? crypto.createHash('sha256').update(desc).digest('hex').slice(0, 20) : prev.descriptionHash || '';
    const changed = Boolean(desc && hash !== prev.descriptionHash);
    const draft = desc ? parseCommercialDescription(desc) : prev.draftCommercialRules || null;
    const commercialVersions = Array.isArray(prev.commercialVersions) ? prev.commercialVersions.slice(-29) : [];

    if (changed && draft?.detected) {
      commercialVersions.push({
        descriptionHash: hash,
        rules: draft,
        status: 'review_required',
        observedAt: new Date().toISOString(),
      });
    }

    all[groupId] = {
      ...prev,
      groupId,
      name: name || prev.name || 'Grupo do WhatsApp',
      description: desc || prev.description || '',
      descriptionHash: hash,
      draftCommercialRules: draft,
      commercialVersions,
      commercialStatus: changed && draft?.detected ? 'review_required' : prev.commercialStatus || (draft?.detected ? 'review_required' : 'none'),
      examples: Array.isArray(prev.examples) ? prev.examples.slice(-40) : [],
      updatedAt: new Date().toISOString(),
    };
    await writeJson(knowledgeFile, all);
    return all[groupId];
  }

  async function append(record = {}) {
    const row = {
      id: record.id || crypto.randomUUID(),
      at: record.at || new Date().toISOString(),
      groupId: String(record.groupId || ''),
      groupName: String(record.groupName || '').slice(0, 180),
      direction: record.direction === 'outgoing' ? 'outgoing' : 'incoming',
      source: String(record.source || 'live'),
      intent: String(record.intent || inferLearningIntent(record.text || '')),
      text: anonymizeLearningText(record.text || ''),
      triggerText: anonymizeLearningText(record.triggerText || ''),
    };
    await fs.appendFile(historyFile, `${JSON.stringify(row)}\n`);
    return row;
  }

  async function addHumanExample({ groupId, groupName, triggerText, replyText }) {
    const row = await append({ groupId, groupName, direction: 'outgoing', source: 'human-live', text: replyText, triggerText });
    const all = await readJson(knowledgeFile, {});
    const entry = all[groupId] || await syncGroup({ groupId, name: groupName });
    const examples = Array.isArray(entry.examples) ? entry.examples : [];
    examples.push({ at: row.at, trigger: anonymizeLearningText(triggerText).slice(0, 1200), reply: anonymizeLearningText(replyText).slice(0, 800), intent: inferLearningIntent(triggerText) });
    all[groupId] = { ...entry, examples: examples.slice(-40), updatedAt: new Date().toISOString() };
    await writeJson(knowledgeFile, all);
    return all[groupId];
  }

  let historyCache = { mtimeMs: -1, rows: [] };

  async function loadHistoryRows() {
    try {
      const stat = await fs.stat(historyFile);
      if (historyCache.mtimeMs === stat.mtimeMs) return historyCache.rows;
      const raw = await fs.readFile(historyFile, 'utf8');
      const rows = raw.split('\n').filter(Boolean).map((line) => {
        try { return JSON.parse(line); } catch { return null; }
      }).filter(Boolean);
      historyCache = { mtimeMs: stat.mtimeMs, rows };
      return rows;
    } catch (error) {
      if (error?.code === 'ENOENT') return [];
      throw error;
    }
  }

  function retrievalTokens(value = '') {
    const stop = new Set(['a','o','as','os','de','da','do','das','dos','e','em','no','na','nos','nas','um','uma','para','pra','pro','por','com','que','esse','essa','isso','ai','ae','pessoal','amigo']);
    return normalize(value).replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((token) => token.length > 1 && !stop.has(token));
  }

  function retrievalCoverage(query, candidate) {
    const q = new Set(retrievalTokens(query));
    const c = new Set(retrievalTokens(candidate));
    if (!q.size || !c.size) return 0;
    let hits = 0;
    for (const token of q) if (c.has(token)) hits += 1;
    return hits / q.size;
  }

  async function searchHistory({ groupId = '', groupName = '', query = '', limit = 6 } = {}) {
    const rows = await loadHistoryRows();
    const q = String(query || '').trim();
    if (!q || !rows.length) return [];
    const wanted = Math.max(1, Math.min(8, Number(limit) || 6));
    const queryIntent = inferLearningIntent(q);
    const scored = [];

    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      if (!row?.text) continue;
      const sameGroup = Boolean(groupId && row.groupId === groupId);
      const sameName = Boolean(!sameGroup && groupName && normalize(row.groupName) === normalize(groupName));
      const lexical = retrievalCoverage(q, row.text);
      const intentMatch = queryIntent && queryIntent !== 'other' && row.intent === queryIntent;
      const score = lexical * 0.55 + (intentMatch ? 0.25 : 0) + (sameGroup ? 0.20 : sameName ? 0.12 : 0);
      if (score < (sameGroup ? 0.20 : 0.34)) continue;
      scored.push({ i, row, score, sameGroup: sameGroup || sameName });
    }

    scored.sort((a, b) => Number(b.sameGroup) - Number(a.sameGroup) || b.score - a.score);
    const selected = [];
    const used = new Set();
    for (const hit of scored) {
      if (selected.length >= wanted) break;
      const start = Math.max(0, hit.i - 2);
      const end = Math.min(rows.length - 1, hit.i + 2);
      const contextRows = [];
      for (let j = start; j <= end; j += 1) {
        const row = rows[j];
        if (!row?.text || row.groupId !== hit.row.groupId) continue;
        contextRows.push(row);
      }
      const context = contextRows.map((row) => `${row.direction === 'outgoing' ? 'PRESTADOR' : 'CENTRAL'}: ${String(row.text).slice(0, 1600)}`).join('\n').slice(0, 5000);
      const key = context.slice(0, 600);
      if (!context || used.has(key)) continue;
      used.add(key);
      selected.push({ group: hit.row.groupName || groupName, intent: hit.row.intent || 'other', score: Math.round(hit.score * 100) / 100, text: context });
    }
    return selected;
  }

  async function getAll() { return readJson(knowledgeFile, {}); }

  async function approveCommercial(groupId) {
    const all = await readJson(knowledgeFile, {});
    const entry = all[groupId];
    if (!entry?.draftCommercialRules?.detected) throw new Error('commercial_rules_missing');
    const approvedAt = new Date().toISOString();
    const versions = Array.isArray(entry.commercialVersions)
      ? entry.commercialVersions.map((version) => version.descriptionHash === entry.descriptionHash
        ? { ...version, status: 'approved', approvedAt }
        : version)
      : [];
    all[groupId] = {
      ...entry,
      approvedCommercialRules: entry.draftCommercialRules,
      commercialVersions: versions,
      commercialStatus: 'approved',
      commercialApprovedAt: approvedAt,
      updatedAt: approvedAt,
    };
    await writeJson(knowledgeFile, all);
    return all[groupId];
  }

  async function getIndex() { return readJson(indexFile, {}); }
  async function saveIndex(index) { return writeJson(indexFile, index); }

  return { syncGroup, append, addHumanExample, searchHistory, getAll, approveCommercial, getIndex, saveIndex };
}
