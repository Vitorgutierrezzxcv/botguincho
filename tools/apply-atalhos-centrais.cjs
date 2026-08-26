// Amplia o reconhecimento deterministico com as formas curtas reais das centrais.
// Base empirica: 4.828 pares pergunta/resposta de 9 grupos (jan-ago/2026).
const fs = require('fs');
const path = require('path');
const root = process.argv[2] || '/r';
let changed = 0;

// ---------------------------------------------------------------- 1) intents
const okFile = path.join(root, 'tools/operational-knowledge.mjs');
let ok = fs.readFileSync(okFile, 'utf8');
if (ok.includes('RECONHECE_ATALHOS')) {
  console.log('operational-knowledge.mjs: ja aplicado');
} else {
  const anchor = "  if ((base === 'administrative_notice' || hasAdministrativeSignals(value)) && !hasOperationalContext(value)) return 'administrative_notice';";
  if (!ok.includes(anchor)) throw new Error('ancora do classificador nao encontrada');
  const block = anchor + `

  // RECONHECE_ATALHOS — formas curtas que as centrais usam o tempo todo e que
  // antes caiam em "other", ou seja, silencio. Extraidas de 4.828 pares reais.
  const administrativeContext = /\\b(nota fiscal|nfe?|pagamento|faturamento|cadastro|email|tabela)\\b/.test(value);

  // "60?" logo depois de uma oportunidade e "consegue chegar em 60 minutos?".
  // Os valores comerciais praticados nao sao multiplos de 5 nessa faixa, entao
  // o multiplo de 5 separa a pergunta de tempo de uma proposta de preco.
  const shortMinutes = value.match(/^(\\d{2,3})\\s*\\?+$/);
  if (shortMinutes) {
    const minutes = Number(shortMinutes[1]);
    if (minutes >= 10 && minutes <= 180 && minutes % 5 === 0) return 'eta';
  }
  // "chegando?", "chegou?", "achou?", "proximo?" sao perguntas de status, nunca
  // o relato de chegada do proprio motorista.
  if (/^(?:ja\\s+)?(?:chegou|chegando|chegaram)\\s*\\?+$/.test(value)
    || /^(?:achou|localizou|encontrou)\\s*\\?+$/.test(value)
    || /^proximos?\\s*\\?+$/.test(value)
    || /^\\S{4,10}\\s+chegando\\s*\\?*$/.test(value)) return 'eta';

  const baseFareQuestion = /^(?:qual\\s+)?(?:[ao]\\s+)?saida\\s*(?:amigo|pessoal|ai|ae)?\\s*\\?+$/.test(value)
    || /\\bvalor\\s+d[ae]\\s+saida\\b/.test(value)
    || /\\b(?:fica|fecha|fechou)\\s+n?[ao]?\\s*saida\\s*\\?+/.test(value);
  const kmQuestion = /^kms?\\s*\\?+$/.test(value)
    || /\\b(?:fechou|deu|ficou|deram)\\s+(?:em\\s+)?quantos?\\s+kms?\\b/.test(value);
  if (kmQuestion || baseFareQuestion) return activeService ? 'value_summary' : 'quote';

  // "consegue?" isolado e oferta de servico. Verbos de contato (chamar, ligar,
  // falar) ficam de fora de proposito: nao sao pergunta de disponibilidade.
  const serviceOfferQuestion = /^consegue\\s*\\?+$/.test(value)
    || /\\bconsegue\\s+(?:fazer|atender|pegar|buscar|ir|assumir|realizar)\\b/.test(value)
    || /\\b(?:pode|tem como|da pra)\\s+(?:fazer|atender|pegar|assumir)\\b/.test(value);
  // Um pedido vago ("consegue buscar?") continua sendo acionamento incompleto:
  // pedir origem/destino/veiculo e mais util do que responder "disponivel".
  if (serviceOfferQuestion && !activeService && !hasIncompleteDispatch(value)) return 'availability';

  const dropSignal = /\\bcancel(?:a|ar|ei|ou|ada|ado|amos|e|em|amento)\\b/.test(value)
    || /\\bnao\\s+(?:vai|ira|sera)\\s+(?:mais\\s+)?(?:precisa\\w*|necessari\\w*)\\b/.test(value)
    || /\\b(?:vai|ira)\\s+precisar\\s+mais\\s+nao\\b/.test(value)
    || /\\bnao\\s+(?:e|sera)\\s+mais\\s+necessari\\w*\\b/.test(value)
    || /\\bnao\\s+precisa\\s+(?:mais|nao)\\b/.test(value);
  if (dropSignal && !administrativeContext) return 'cancellation';`;
  ok = ok.replace(anchor, block);
  fs.writeFileSync(okFile, ok);
  changed++;
  console.log('operational-knowledge.mjs: atalhos adicionados');
}

// -------------------------------------------------------------- 2) fallbacks
const wFile = path.join(root, 'tools/vercel-whatsapp-worker.mjs');
let w = fs.readFileSync(wFile, 'utf8');
if (w.includes('ATALHOS_FALLBACK')) {
  console.log('vercel-whatsapp-worker.mjs: ja aplicado');
} else {
  const oldEta = `function asksEta(text = '') {
  const value = normalizeForIntent(text);
  return /\\b(quanto tempo|`;
  if (!w.includes(oldEta)) throw new Error('ancora asksEta nao encontrada');
  w = w.replace(oldEta, `function asksEta(text = '') {
  const value = normalizeForIntent(text);
  // ATALHOS_FALLBACK: "60?", "chegando?", "proximo?" tambem sao perguntas de tempo.
  const shortMinutes = value.match(/^(\\d{2,3})\\s*\\?+$/);
  if (shortMinutes) {
    const minutes = Number(shortMinutes[1]);
    if (minutes >= 10 && minutes <= 180 && minutes % 5 === 0) return true;
  }
  if (/^(?:ja\\s+)?(?:chegou|chegando|chegaram)\\s*\\?+$/.test(value)
    || /^(?:achou|localizou|encontrou)\\s*\\?+$/.test(value)
    || /^proximos?\\s*\\?+$/.test(value)) return true;
  return /\\b(quanto tempo|`);

  const oldDist = `  return /\\b(qual (?:a )?distancia|quanto(?:s)? km|`;
  if (!w.includes(oldDist)) throw new Error('ancora asksDistance nao encontrada');
  w = w.replace(oldDist, `  if (/^kms?\\s*\\?+$/.test(value)) return true;
  return /\\b(qual (?:a )?distancia|quanto(?:s)? km|`);

  const oldAvail = `  return /\\b(disponivel|disponibilidade|tem guincho|tem reboque|consegue atender|`;
  if (!w.includes(oldAvail)) throw new Error('ancora asksAvailability nao encontrada');
  w = w.replace(oldAvail, `  if (/^consegue\\s*\\?+$/.test(value)) return true;
  if (/\\bconsegue\\s+(?:fazer|atender|pegar|buscar|ir|assumir|realizar)\\b/.test(value)) return true;
  return /\\b(disponivel|disponibilidade|tem guincho|tem reboque|consegue atender|`);
  fs.writeFileSync(wFile, w);
  changed++;
  console.log('vercel-whatsapp-worker.mjs: fallbacks ampliados');
}
console.log(changed ? 'PATCH APLICADO' : 'NADA A FAZER');
