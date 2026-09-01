// Índice determinístico gerado a partir dos 10 exports históricos anonimizados.
// O objetivo é reconhecer linguagem já observada sem chamar IA nem alterar regras comerciais.
const SOURCES = [{"group":"Assistência Segura x America Guincho","messageCount":568},{"group":"America Guincho/ Contagem/Betim MG X Company Truck","messageCount":1266},{"group":"América Guincho / Horizonte","messageCount":704},{"group":"América Guincho X Plus Assistência","messageCount":5202},{"group":"Prest. America Guinchos x Power","messageCount":1496},{"group":"America Reboque / Premium Assistência","messageCount":984},{"group":"AMÉRICA GUINCHO BETIM X SATURNO (SB)","messageCount":764},{"group":"America Guincho / Socorre Assistência","messageCount":1723},{"group":"América Betim e Região SOLUÇÃO ASSISTÊNCIA","messageCount":3192},{"group":"AMERICA GUINCHO - BETIM MG F15 X TOP BRASIL","messageCount":409}];
const PATTERN_SETS = [{"group":"Assistência Segura x America Guincho","intent":"availability","phrases":["disponível?","consulta traz veículo origem destino e maps antes da autorização"]},{"group":"Assistência Segura x America Guincho","intent":"authorization","phrases":["pode seguir","depois chega ficha formal com protocolo valor de tabela e previsão"]},{"group":"Assistência Segura x America Guincho","intent":"cancellation","phrases":["pode desconsiderar","cancelado sem custos"]},{"group":"America Guincho/ Contagem/Betim MG X Company Truck","intent":"availability","phrases":["Disponível? Valor e prévia?","Disponível? Valor e prévia? Quantos kms totais?"]},{"group":"America Guincho/ Contagem/Betim MG X Company Truck","intent":"quote","phrases":["Solicitação de cotação","Cotação Visão"]},{"group":"America Guincho/ Contagem/Betim MG X Company Truck","intent":"authorization","phrases":["Sim pode seguir","Pode seguir"]},{"group":"America Guincho/ Contagem/Betim MG X Company Truck","intent":"scheduled_dispatch","phrases":["agendado para data futura","agendamento"]},{"group":"America Guincho/ Contagem/Betim MG X Company Truck","intent":"cancellation","phrases":["não conseguirá realizar o atendimento","repasse para outro prestador"]},{"group":"America Guincho/ Contagem/Betim MG X Company Truck","intent":"closure","phrases":["finalizado"]},{"group":"América Guincho / Horizonte","intent":"availability","phrases":["disponível?"]},{"group":"América Guincho / Horizonte","intent":"eta","phrases":["tempo restante","prévia"]},{"group":"América Guincho / Horizonte","intent":"authorization","phrases":["protocolo definitivo","protocolo"]},{"group":"América Guincho / Horizonte","intent":"closure","phrases":["Finalizado"]},{"group":"América Guincho X Plus Assistência","intent":"availability","phrases":["Disponível?","Boa noite, disponível?","Conseguem esse?"]},{"group":"América Guincho X Plus Assistência","intent":"eta","phrases":["PREVIA?","prévia?"]},{"group":"América Guincho X Plus Assistência","intent":"quote","phrases":["qual valor da saída e do km?","valor e prévia?"]},{"group":"América Guincho X Plus Assistência","intent":"authorization","phrases":["Pode seguir?","Seguir?","pode seguir"]},{"group":"América Guincho X Plus Assistência","intent":"cancellation","phrases":["resolvido obrigada","pessoal pode deixar, conseguiu resolver lá","desconsiderar","cancelamento antes da execução"]},{"group":"América Guincho X Plus Assistência","intent":"closure","phrases":["confere fechamento?","fechamento"]},{"group":"América Guincho X Plus Assistência","intent":"scheduled_dispatch","phrases":["AGENDAMENTO AMANHÃ","agendamento amanhã"]},{"group":"Prest. America Guinchos x Power","intent":"availability","phrases":["valor e prévia","disponibilidade"]},{"group":"Prest. America Guinchos x Power","intent":"pending_approval","phrases":["vou passar o valor para o administrativo","por enquanto não siga"]},{"group":"Prest. America Guinchos x Power","intent":"authorization","phrases":["pode seguir"]},{"group":"Prest. America Guinchos x Power","intent":"cancellation","phrases":["cancelado sem saída"]},{"group":"Prest. America Guinchos x Power","intent":"closure","phrases":["nota fiscal","finalizado"]},{"group":"America Reboque / Premium Assistência","intent":"availability","phrases":["disponível?","consegue fazer?"]},{"group":"America Reboque / Premium Assistência","intent":"quote","phrases":["valor de saída","valor do km","cotação de utilitário"]},{"group":"America Reboque / Premium Assistência","intent":"eta","phrases":["prévia"]},{"group":"America Reboque / Premium Assistência","intent":"authorization","phrases":["pode seguir"]},{"group":"America Reboque / Premium Assistência","intent":"closure","phrases":["atendimento foi finalizado","fechamento"]},{"group":"AMÉRICA GUINCHO BETIM X SATURNO (SB)","intent":"availability","phrases":["Bom dia, disponível?","está disponível?"]},{"group":"AMÉRICA GUINCHO BETIM X SATURNO (SB)","intent":"quote","phrases":["Qual valor?","Qual valor total por favor?","qual valor e prévia?"]},{"group":"AMÉRICA GUINCHO BETIM X SATURNO (SB)","intent":"eta","phrases":["prévia"]},{"group":"AMÉRICA GUINCHO BETIM X SATURNO (SB)","intent":"authorization","phrases":["Pode seguir por favor","pode seguir"]},{"group":"AMÉRICA GUINCHO BETIM X SATURNO (SB)","intent":"scheduled_dispatch","phrases":["AGENDAMENTO PARA AMANHÃ","agendamento para amanhã"]},{"group":"AMÉRICA GUINCHO BETIM X SATURNO (SB)","intent":"closure","phrases":["KM TOTAL","valor do serviço","finalizado"]},{"group":"America Guincho / Socorre Assistência","intent":"availability","phrases":["disponibilidade","cotação"]},{"group":"America Guincho / Socorre Assistência","intent":"authorization","phrases":["pode seguir"]},{"group":"America Guincho / Socorre Assistência","intent":"scheduled_dispatch","phrases":["agendamento","horário futuro"]},{"group":"America Guincho / Socorre Assistência","intent":"cancellation","phrases":["cancelamento","associado pode cancelar"]},{"group":"America Guincho / Socorre Assistência","intent":"closure","phrases":["fechamento","ficou dentro da saída"]},{"group":"América Betim e Região SOLUÇÃO ASSISTÊNCIA","intent":"availability","phrases":["Disponível?","Olá, bom dia. Disponível para uma remoção?"]},{"group":"América Betim e Região SOLUÇÃO ASSISTÊNCIA","intent":"eta","phrases":["Qual a prévia?","60?"]},{"group":"América Betim e Região SOLUÇÃO ASSISTÊNCIA","intent":"authorization","phrases":["Pode seguir","PODE SEGUIR","seguir"]},{"group":"América Betim e Região SOLUÇÃO ASSISTÊNCIA","intent":"cancellation","phrases":["pode retornar","associado dispensou","conseguiu resolver","pode fechar na saída"]},{"group":"América Betim e Região SOLUÇÃO ASSISTÊNCIA","intent":"closure","phrases":["finalizado","fecha em quantos kms?","envie km totais e valor","finalizado na saída","confere?"]},{"group":"AMERICA GUINCHO - BETIM MG F15 X TOP BRASIL","intent":"availability","phrases":["Disponível?","Boa noite, disponível?"]},{"group":"AMERICA GUINCHO - BETIM MG F15 X TOP BRASIL","intent":"quote","phrases":["COTAÇÃO / VALOR, KMS E PREVIA","consegue me ajudar nesta cotação? valor e previa?"]},{"group":"AMERICA GUINCHO - BETIM MG F15 X TOP BRASIL","intent":"eta","phrases":["Qual prévia?","prévia??"]},{"group":"AMERICA GUINCHO - BETIM MG F15 X TOP BRASIL","intent":"authorization","phrases":["segue","pode seguir","bora","vou enviar"]},{"group":"AMERICA GUINCHO - BETIM MG F15 X TOP BRASIL","intent":"closure","phrases":["km total","valor final"]}];
const ENTRIES = PATTERN_SETS.flatMap((set) => set.phrases.map((phrase) => ({ group: set.group, intent: set.intent, phrase })));

function norm(value = '') {
  return String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const STOP = new Set(['a','o','as','os','de','da','do','das','dos','e','em','no','na','nos','nas','um','uma','para','pra','pro','por','com','que','esse','essa','isso','ai','ae','pessoal','amigo']);

function tokens(value) {
  return norm(value).split(' ').filter((token) => token.length > 1 && !STOP.has(token));
}

function tokenCoverage(a, b) {
  const aa = new Set(tokens(a));
  const bb = new Set(tokens(b));
  if (!aa.size || !bb.size) return 0;
  let hit = 0;
  for (const token of aa) if (bb.has(token)) hit += 1;
  return hit / Math.min(aa.size, bb.size);
}

function bigrams(value) {
  const normalized = norm(value).replace(/ /g, '_');
  if (normalized.length < 2) return normalized ? [normalized] : [];
  const out = [];
  for (let i = 0; i < normalized.length - 1; i += 1) out.push(normalized.slice(i, i + 2));
  return out;
}

function dice(a, b) {
  const aa = bigrams(a);
  const bb = bigrams(b);
  if (!aa.length || !bb.length) return 0;
  const counts = new Map();
  for (const item of aa) counts.set(item, (counts.get(item) || 0) + 1);
  let hit = 0;
  for (const item of bb) {
    const left = counts.get(item) || 0;
    if (left > 0) {
      hit += 1;
      counts.set(item, left - 1);
    }
  }
  return (2 * hit) / (aa.length + bb.length);
}

function groupMatchScore(current, trained) {
  const a = norm(current);
  const b = norm(trained);
  if (!a || !b) return 0;
  if (a === b) return 1;
  return Math.max(tokenCoverage(a, b), dice(a, b));
}

const CRITICAL = new Set(['authorization', 'cancellation', 'closure', 'pending_approval']);

export function matchHistoricalTrainingIntent(text = '', groupName = '') {
  const value = norm(text);
  if (!value || value.length < 2) return null;

  let best = null;
  for (const entry of ENTRIES) {
    const phrase = norm(entry.phrase);
    if (!phrase) continue;

    const sameGroup = groupMatchScore(groupName, entry.group);
    const exact = value === phrase;
    const contained = Math.min(value.length, phrase.length) >= 4 && (value.includes(phrase) || phrase.includes(value));
    let score = exact ? 1 : contained ? 0.90 : (0.58 * dice(value, phrase) + 0.42 * tokenCoverage(value, phrase));

    if (sameGroup >= 0.72) score = Math.min(1, score + 0.06);

    // Estados críticos nunca são aprendidos por semelhança solta.
    // Exigem seguradora compatível e frase exata/fortemente contida.
    if (CRITICAL.has(entry.intent)) {
      if (sameGroup < 0.62 || (!exact && !contained) || score < 0.90) continue;
    }

    if (!best || score > best.score) best = { ...entry, score, sameGroup };
  }

  if (!best) return null;
  const minimum = CRITICAL.has(best.intent) ? 0.90 : 0.74;
  return best.score >= minimum ? best : null;
}

export function historicalTrainingStats() {
  return {
    groups: SOURCES.length,
    cataloguedMessages: 16308,
    screenshots: 184,
    lexicalPatterns: ENTRIES.length,
    mode: 'deterministic_retrieval',
    privacy: 'anonymized',
  };
}


export function historicalExamplesForAi(text = '', groupName = '', limit = 4) {
  const value = norm(text);
  if (!value) return [];
  const max = Math.min(6, Math.max(1, Number(limit) || 4));
  const seen = new Set();
  return ENTRIES
    .map((entry) => {
      const phrase = norm(entry.phrase);
      const sameGroup = groupMatchScore(groupName, entry.group);
      const exact = value === phrase;
      const contained = Math.min(value.length, phrase.length) >= 4 && (value.includes(phrase) || phrase.includes(value));
      const lexical = exact ? 1 : contained ? 0.94 : Math.max(dice(value, phrase), tokenCoverage(value, phrase));
      return { ...entry, score: Math.min(1, lexical * 0.78 + sameGroup * 0.22) };
    })
    .filter((entry) => entry.score >= 0.34)
    .sort((a, b) => b.score - a.score)
    .filter((entry) => {
      const key = `${entry.intent}:${norm(entry.phrase)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, max)
    .map(({ group, intent, phrase, score }) => ({ group, intent, phrase, score: Math.round(score * 100) / 100 }));
}
