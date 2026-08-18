import fs from 'node:fs/promises';
import crypto from 'node:crypto';

function normalize(value = '') {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function brNumber(value) {
  const text = String(value ?? '').trim().replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

export function anonymizeLearningText(value = '') {
  return String(value || '')
    .replace(/\b(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?9?\d{4}[-\s]?\d{4}\b/g, '[TELEFONE]')
    .replace(/\b[A-Z]{3}[-\s]?\d[A-Z0-9]\d{2}\b/gi, '[PLACA]')
    .slice(0, 6000);
}

export function inferLearningIntent(text = '') {
  const value = normalize(text);
  if (!value) return 'empty';
  if (/\b(cancelou|cancelado|pode deixar|conseguiu resolver|nao precisa mais|passou para outro|ja foi|protocolo errado|desconsidera)\b/.test(value)) return 'cancellation';
  if (/\b(pode seguir|seguir|pode ir|liberado|libera|fechado|confirmado|manda|enviando)\b/.test(value)) return 'authorization';
  if (/\b(finalizamos|finalizado|fechamento|quantos km|km totais|valor total|fotos no destino|fotos na origem)\b/.test(value)) return 'closure';
  if (/\b(valor|quanto fica|cotacao|preco|previa|km totais|quilometragem)\b/.test(value)) return 'quote';
  if (/\b(disponivel|disponibilidade|consegue esse|consegue uma remocao|tem reboque|tem guincho)\b/.test(value)) return 'availability';
  if (/\b(quanto tempo|previsao|eta|chega em|demora)\b/.test(value)) return 'eta';
  if (/\b(origem|destino|reboque|guincho|veiculo|pane|colisao|remocao)\b/.test(value)) return 'dispatch';
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
  const noSkates = /n[aã]o\s+tem\s+patins?/i.test(raw);
  return {
    raw,
    services,
    workedHour: worked ? brNumber(worked[1]) : null,
    stoppedHour: stopped ? brNumber(stopped[1]) : null,
    noSkates,
    detected: Boolean(Object.keys(services).length || worked || stopped || noSkates),
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
    all[groupId] = {
      ...prev,
      groupId,
      name: name || prev.name || 'Grupo do WhatsApp',
      description: desc || prev.description || '',
      descriptionHash: hash,
      draftCommercialRules: draft,
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

  async function getAll() { return readJson(knowledgeFile, {}); }
  async function approveCommercial(groupId) {
    const all = await readJson(knowledgeFile, {});
    const entry = all[groupId];
    if (!entry?.draftCommercialRules?.detected) throw new Error('commercial_rules_missing');
    all[groupId] = { ...entry, approvedCommercialRules: entry.draftCommercialRules, commercialStatus: 'approved', commercialApprovedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    await writeJson(knowledgeFile, all);
    return all[groupId];
  }
  async function getIndex() { return readJson(indexFile, {}); }
  async function saveIndex(index) { return writeJson(indexFile, index); }

  return { syncGroup, append, addHumanExample, getAll, approveCommercial, getIndex, saveIndex };
}
