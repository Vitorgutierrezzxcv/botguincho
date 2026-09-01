import { inferLearningIntent } from './learning-engine.mjs';
import { matchHistoricalTrainingIntent } from './training-runtime-index.mjs';

function norm(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(?:[a-z]\s+){2,}[a-z]\b/g, (match) => match.replace(/\s+/g, ''))
    .replace(/\s+/g, ' ')
    .trim();
}

const GROUP_PROFILES = [
  {
    key: 'solucao', match: /solucao assistencia/,
    evidence: ['Fotos dos quatro ângulos na origem', 'Fotos dos quatro ângulos no destino', 'Checklist/assinatura quando exigido'],
    safeguards: ['availability_is_not_authorization', 'version_rates'],
  },
  {
    key: 'top-brasil', match: /top brasil/,
    evidence: ['Fotos dos quatro lados e checklist quando constarem no protocolo'],
    safeguards: ['quote_is_not_dispatch', 'toll_separate'],
  },
  {
    key: 'saturno', match: /saturno|\bsb\b/,
    evidence: ['Frente, traseira e laterais na origem', 'Checklist visível/assinado', 'Foto do veículo na prancha', 'Vídeo 360 quando exigido pelo protocolo'],
    stoppedHourRequiresReview: true,
    safeguards: ['stopped_hour_needs_explicit_approval', 'scheduled_is_not_immediate'],
  },
  {
    key: 'plus', match: /plus assistencia/,
    evidence: ['Checklist/fotos exigidos pelo protocolo/WebPrestador'],
    associationRequired: true,
    safeguards: ['association_can_change_rate', 'toll_separate', 'worked_hour_versioned', 'math_divergence_review'],
  },
  {
    key: 'company-truck', match: /company truck/,
    evidence: ['Vídeo com placa e veículo sobre o reboque', 'Vídeo identificando Company Truck, data e horário', 'Nota fiscal quando exigida'],
    safeguards: ['cotacao_visao_never_authorizes', 'evidence_before_invoice', 'invoice_extra_requires_approval'],
  },
  {
    key: 'horizonte', match: /horizonte/,
    evidence: ['Evidências e checklist descritos no protocolo'],
    formalProtocolCanAuthorize: true,
    absentCustomerWaitMinutes: 10,
    safeguards: ['formal_protocol_after_acceptance_can_authorize'],
  },
  {
    key: 'socorre', match: /socorre assistencia|\bsocorre\b/,
    evidence: ['Fotos/checklist conforme protocolo da associação'],
    associationRequired: true,
    safeguards: ['association_required_before_pricing'],
  },
  {
    key: 'premium', match: /premium assistencia/,
    evidence: ['Fotos/checklist conforme protocolo'],
    safeguards: ['payment_calendar_ambiguous'],
  },
  {
    key: 'assistencia-segura', match: /assistencia segura/,
    evidence: ['Fotos/checklist conforme protocolo'],
    safeguards: ['administrative_notices_are_silent'],
  },
  {
    key: 'power', match: /\bpower\b/,
    evidence: ['Fotos do embarque no WebPrestador', 'Evidências exigidas antes do faturamento'],
    proactiveAvailabilityForbidden: true,
    safeguards: ['pending_admin_approval_blocks_execution', 'no_proactive_availability'],
  },
];

export function resolveGroupProfile(groupName = '') {
  const name = norm(groupName);
  return GROUP_PROFILES.find((profile) => profile.match.test(name)) || {
    key: 'generic', match: /.^/, evidence: [], safeguards: [],
  };
}

function hasFormalProtocol(text = '') {
  const value = norm(text);
  if (!/\b(protocolo|acionamento|webprestador)\b/.test(value)) return false;
  const operationalFields = ['origem', 'destino', 'veiculo', 'placa', 'servico', 'cliente', 'associado', 'solicitante']
    .filter((field) => value.includes(field)).length;
  return operationalFields >= 2 || /https?:\/\//.test(text);
}

function hasQuoteSignals(text = '') {
  const value = norm(text);
  return /\b(cotacao|valor e previa|valor,?\s*km|valor total\?|qual valor|quanto fica|preco|km totais|quilometragem total)\b/.test(value)
    || (/\bdisponivel/.test(value) && /\b(valor|previa|km)\b/.test(value));
}

function hasStructuredServiceRequest(text = '') {
  const value = norm(text);
  const hasOrigin = /\borigem\s*[:=\-]/.test(value);
  const hasDestination = /\bdestino\s*[:=\-]/.test(value);
  const hasServiceOrVehicle = /\bservico(?:\s+selecionado)?\b|\breboque\b|\bguincho\b|\butilitario\b|\bveiculo\b|\bmodelo\b|\bplaca\b|\bmotivo\b/.test(value);
  return hasOrigin && hasDestination && hasServiceOrVehicle;
}

function hasOperationalContext(value = '') {
  return /\b(origem|destino|veiculo|placa|protocolo|reboque|guincho|pane|sinistro|servico|acionamento|associado|associacao|remocao|cliente)\b/.test(value);
}

function hasAdministrativeSignals(value = '') {
  return /\b(reuniao|comunicado(?: interno)?|aviso(?: geral)?|treinamento|rotina financeira|financeiro|atualizacao de cadastro|documentos|tabelas? de valores|pagamentos? dia|contas)\b/.test(value);
}

function hasIncompleteDispatch(value = '') {
  const hasOrigin = /\borigem\s*[:=\-]/.test(value);
  const hasDestination = /\bdestino\s*[:=\-]/.test(value);
  const hasVehicle = /\b(veiculo|carro|moto|modelo)\s*[:=\-]/.test(value) || /\b(carro|moto|veiculo|carro de passeio|utilitario|motocicleta)\b/.test(value);
  const vagueRequest = /\b(parado|pane|buscar|socorro|guincho|reboque)\b/.test(value);
  return (hasOrigin || hasDestination || hasVehicle || vagueRequest) && !(hasOrigin && hasDestination && hasVehicle);
}

export function classifyRuntimeIntent(text = '', groupName = '', recentCall = null) {
  const value = norm(text);
  const profile = resolveGroupProfile(groupName);
  const base = inferLearningIntent(text);

  const activeService = ['autorizado','a_caminho','em_atendimento','aguardando_fechamento'].includes(recentCall?.status);
  const evidenceContext = activeService || recentCall?.status === 'concluido';
  if ((base === 'administrative_notice' || hasAdministrativeSignals(value)) && !hasOperationalContext(value)) return 'administrative_notice';

  // Uma ficha completa sem protocolo formal e uma nova cotacao, mesmo quando ja
  // existe outra corrida ativa no grupo. Perguntas explicitas de disponibilidade
  // continuam no fluxo availability, que tambem registra a cotacao no painel.
  if (hasStructuredServiceRequest(text) && !hasFormalProtocol(text) && base !== 'availability' && base !== 'authorization' && base !== 'scheduled_dispatch' && base !== 'cancellation' && base !== 'pending_approval' && base !== 'closure') return 'quote';

  // RECONHECE_ATALHOS — formas curtas que as centrais usam o tempo todo e que
  // antes caiam em "other", ou seja, silencio. Extraidas de 4.828 pares reais.
  const administrativeContext = /\b(nota fiscal|nfe?|pagamento|faturamento|cadastro|email|tabela)\b/.test(value);

  // "60?" logo depois de uma oportunidade e "consegue chegar em 60 minutos?".
  // Os valores comerciais praticados nao sao multiplos de 5 nessa faixa, entao
  // o multiplo de 5 separa a pergunta de tempo de uma proposta de preco.
  const shortMinutes = value.match(/^(\d{2,3})\s*\?+$/);
  if (shortMinutes) {
    const minutes = Number(shortMinutes[1]);
    if (minutes >= 10 && minutes <= 180 && minutes % 5 === 0) return 'eta';
  }
  // "chegando?", "chegou?", "achou?", "proximo?" sao perguntas de status, nunca
  // o relato de chegada do proprio motorista.
  if (/^(?:ja\s+)?(?:chegou|chegando|chegaram)\s*\?+$/.test(value)
    || /^(?:achou|localizou|encontrou)\s*\?+$/.test(value)
    || /^proximos?\s*\?+$/.test(value)
    || /^\S{4,10}\s+chegando\s*\?*$/.test(value)) return 'eta';

  const baseFareQuestion = /^(?:qual\s+)?(?:[ao]\s+)?saida\s*(?:amigo|pessoal|ai|ae)?\s*\?+$/.test(value)
    || /\bvalor\s+d[ae]\s+saida\b/.test(value)
    || /\b(?:fica|fecha|fechou)\s+n?[ao]?\s*saida\s*\?+/.test(value);
  const kmQuestion = /^kms?\s*\?+$/.test(value)
    || /\b(?:fechou|deu|ficou|deram)\s+(?:em\s+)?quantos?\s+kms?\b/.test(value);
  if (kmQuestion || baseFareQuestion) return activeService ? 'value_summary' : 'quote';

  // "consegue?" isolado e oferta de servico. Verbos de contato (chamar, ligar,
  // falar) ficam de fora de proposito: nao sao pergunta de disponibilidade.
  const serviceOfferQuestion = /^consegue\s*\?+$/.test(value)
    || /\bconsegue\s+(?:fazer|atender|pegar|buscar|ir|assumir|realizar)\b/.test(value)
    || /\b(?:pode|tem como|da pra)\s+(?:fazer|atender|pegar|assumir)\b/.test(value);
  // Um pedido vago ("consegue buscar?") continua sendo acionamento incompleto:
  // pedir origem/destino/veiculo e mais util do que responder "disponivel".
  if (serviceOfferQuestion && !activeService && !hasIncompleteDispatch(value)) return 'availability';

  const dropSignal = /\bcancel(?:a|ar|ei|ou|ada|ado|amos|e|em|amento)\b/.test(value)
    || /\bnao\s+(?:vai|ira|sera)\s+(?:mais\s+)?(?:precisa\w*|necessari\w*)\b/.test(value)
    || /\b(?:vai|ira)\s+precisar\s+mais\s+nao\b/.test(value)
    || /\bnao\s+(?:e|sera)\s+mais\s+necessari\w*\b/.test(value)
    || /\bnao\s+precisa\s+(?:mais|nao)\b/.test(value);
  if (dropSignal && !administrativeContext) return 'cancellation';

  const dirtRoadEndSignal = /\b(saiu|saimos|saindo|fim|terminou|acabou)\b.{0,28}\b(estrada|rua|trecho)\s+de\s+terra\b|\bvoltou\s+(o\s+)?asfalto\b/.test(value);
  const dirtRoadSignal = /\b(estrada|rua|trecho)\s+de\s+terra\b|\bcomeca\s+(aqui\s+)?(a\s+)?terra\b|\bacabou\s+o\s+asfalto\b/.test(value);
  if (activeService && dirtRoadEndSignal) return 'dirt_road_end';
  if (activeService && dirtRoadSignal) return 'dirt_road_start';
  const arrivalSignal = /\b(guincho|prestador|motorista)\s+(ja\s+)?(chegou|esta no local)|\bchegamos?\s+(ao|no)\s+local\b/.test(value);
  const noTowSignal = /\b(carro|veiculo)\s+(voltou a\s+)?(funcionou|ligou|pegou)\b|\b(nao quer|n quer|nao deseja|recusou)\s+(levar|remover|rebocar)|\b(dispensou|dispensa)\s+(o\s+)?guincho\b|\bsem\s+reboque\b/.test(value);
  if (activeService && noTowSignal && (arrivalSignal || recentCall?.arrivalConfirmed === true || recentCall?.status === 'em_atendimento')) return 'arrival_without_tow';
  if (activeService && noTowSignal) return 'cancellation';
  if (activeService && arrivalSignal) return 'arrival';

  if (activeService && /\b(cliente|segurado|associado)\b.{0,30}\b(nao esta|nao chegou|ausente|nao apareceu|demorando)\b|\baguardando\s+(o\s+)?(cliente|segurado|associado)\b/.test(value)) return 'waiting_customer';
  if (activeService && /\b(novo|alteracao|mudou|troca)\b.{0,24}\bdestino\b|\bdestino\s+alterado\b/.test(value)) return 'address_update';
  if (activeService && /\b(veiculo|carro|moto)\b.{0,24}\b(na prancha|embarcado|carregado|guinchado)\b|\bembarque\s+(concluido|realizado)\b/.test(value)) return 'loaded';
  if (activeService && /\b(chegou|chegamos|entregue|entregamos)\b.{0,28}\b(destino|oficina|patio)\b/.test(value)) return 'destination_arrival';
  if (activeService && /\b(saindo|saiu|a caminho|em deslocamento|iniciando deslocamento)\b/.test(value)) return 'departure';
  if (evidenceContext && (/\b(fotos?|checklist|video|evidencias?)\b.{0,30}\b(enviad\w*|anexad\w*|realizad\w*|concluid\w*|feito|pronto)\b/.test(value) || value === '[imagem recebida]')) return 'evidence';
  if (evidenceContext && /\bprotocolo\b/.test(value)) return 'protocol_update';

  if (base === 'cancellation') return 'cancellation';
  if (base === 'pending_approval') return 'pending_approval';
  if (base === 'scheduled_dispatch' && (hasOperationalContext(value) || /\bagendamento|agendado|agendada\b/.test(value))) return 'scheduled_dispatch';

  if (profile.key === 'company-truck' && /cotacao\s+visao|tipo\s*:\s*visao/.test(value)) return 'quote';

  // A mesma pergunta de valor muda de significado conforme o estado do chamado.
  // Depois da autorização/execução, frases de finalização são fechamento, não nova cotação.
  const valueSummaryQuestion = /\b(fecha\s+em\s+quantos|quantos\s+(?:km|quilometros)|km\s+totais?|quilometragem\s+total|envie\s+os?\s+quilometros|envie.{0,24}\bvalor|qual\s+(?:o\s+)?valor(?:\s+total)?|valor\s+(?:e|com)\s+(?:os?\s+)?km)\b/.test(value);
  const explicitClosure = /\b(finaliz(?:e|ado|ada|amos)|fechamento\s+(?:concluido|final)|conclu(?:a|ido|ida)|corrida\s+(?:encerrada|finalizada))\b/.test(value);
  if (activeService && valueSummaryQuestion && !explicitClosure) return 'value_summary';

  const closureQuestion = /\b(finaliz|fechamento|fechamos|quanto finalizou|em quantos km|km final|valor final|finalizou em)\b/.test(value);
  if (activeService && (base === 'closure' || closureQuestion)) return 'closure';

  // “Qual a prévia?” é uma pergunta de tempo/ETA sobre a oportunidade já
  // recebida. Só permanece cotação quando a mesma mensagem também pede valor
  // ou quilometragem comercial.
  const etaQuestion = /\b(qual\s+(?:a\s+)?previa|previa|previsao(?:\s+de\s+chegada)?|quanto\s+tempo|quanto\s+demora|chega\s+em)\b/.test(value);
  const commercialQuestion = /\b(valor|preco|cotacao|quanto\s+fica|km|quilometragem)\b/.test(value);
  if (etaQuestion && !commercialQuestion) return 'eta';

  if (hasQuoteSignals(text)) return 'quote';
  if (base === 'authorization') return 'authorization';
  if (base === 'closure') return 'closure';
  if (base === 'eta') return 'eta';

  // Uma pergunta de disponibilidade continua sendo consulta mesmo que a ficha
  // completa/protocolo esteja na mesma mensagem. Nunca autoriza por acidente.
  if (base === 'availability') return 'availability';

  if (hasFormalProtocol(text)) {
    if (activeService) return 'protocol_update';
    if (profile.formalProtocolCanAuthorize && ['cotacao','aguardando_aprovacao','novo','disponibilidade'].includes(recentCall?.status)) return 'formal_dispatch';
    return 'protocol_received';
  }

  if (base === 'dispatch') return hasIncompleteDispatch(value) ? 'incomplete_dispatch' : 'dispatch_details';
  if (hasIncompleteDispatch(value)) return 'incomplete_dispatch';

  // Recupera linguagem observada nos 10 históricos somente quando o classificador
  // determinístico normal ficou sem resposta. O índice não contém preço/ETA e
  // exige correspondência forte para autorização, cancelamento e fechamento.
  if (!base || base === 'other') {
    const trained = matchHistoricalTrainingIntent(text, groupName);
    if (trained?.intent) {
      const requiresActiveCall = new Set(['closure']);
      if (!requiresActiveCall.has(trained.intent) || activeService) return trained.intent;
    }
  }
  return base;
}

function firstNumber(text, patterns = []) {
  for (const pattern of patterns) {
    const match = String(text || '').match(pattern);
    if (!match) continue;
    const parsed = Number(String(match[1]).replace(/\./g, '').replace(',', '.'));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function labeled(text, labels = []) {
  // O WhatsApp envia rotulos em negrito como *MODELO:* e *ENDEREÇO ORIGEM:*.
  // A formatacao nao deve fazer parte do valor nem quebrar o parser.
  const raw = String(text || '').replace(/\r/g, '').replace(/[*_~`]/g, '');
  const boundaries = 'ORIGEM|DESTINO|VE[IÍ]CULO|MODELO|PLACA|SERVI[CÇ]O|TIPO\\s*DE\\s*SERVI[CÇ]O|PROTOCOLO|N[º°]?\\s*PROTOCOLO|ASSOCIA[CÇ][AÃ]O|ASSIST[EÊ]NCIA|SEGURADORA|CLIENTE|ASSOCIADO|SEGURADO|TELEFONE|CONTATO|MOTIVO|ACOMPANHANTES?';
  for (const label of labels) {
    const re = new RegExp(`(?:^|\\n)\\s*${label}\\s*[:=\\-]\\s*([^\\n]+)`, 'im');
    const match = raw.match(re);
    if (match?.[1]) {
      const value = match[1].split(new RegExp(`\\s+(?=(?:${boundaries})\\s*[:=\\-])`, 'i'))[0];
      return value.trim().replace(/[.;,]+$/, '').slice(0, 500);
    }
  }
  for (const label of labels) {
    const inline = new RegExp(`(?:^|\\s)${label}\\s*[:=\\-]\\s*(.+?)(?=\\s+(?:${boundaries})\\s*[:=\\-]|$)`, 'i');
    const match = raw.match(inline);
    if (match?.[1]) return match[1].trim().replace(/[.;,]+$/, '').slice(0, 500);
  }
  return '';
}

export function inferVehicleType(text = '') {
  const value = norm(text);
  if (/\b(utilitario|utilitária|utilitaria|van|fiorino|master|ducato|sprinter|saveiro|strada|montana|courier)\b/.test(value)) return 'utilitario';
  if (/\b(moto|motocicleta|scooter)\b/.test(value)) return 'moto';
  if (/\b(pesado|caminhao|caminhão|onibus|ônibus)\b/.test(value)) return 'pesado';
  if (/\b(leve|carro|veiculo|automovel|automóvel|hatch|sedan|suv|uno|gol|onix|ka|palio|classic|corsa|celta|hb20|kwid|sandero|logan|corolla|civic)\b/.test(value)) return 'leve';
  return null;
}

function cleanStructuredAddressValue(value = '') {
  return String(value || '')
    .replace(/[*_~`]/g, '')
    .replace(/\bref\.?\s*:.*$/i, '')
    .replace(/\b(?:BAIRRO|CIDADE|ESTADO|PA[IÍ]S|PAS)\s*:\s*/gi, '')
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .replace(/(?:,\s*)+$/g, '')
    .trim();
}

export function extractOperationalFacts(text = '') {
  const raw = String(text || '');
  const value = norm(raw);
  const totalKm = firstNumber(raw, [
    /(?:km\s*total|km\s*totais|quilometragem\s*total|total\s*de\s*km)\s*[:=\-]?\s*(\d+(?:[.,]\d+)?)/i,
    /(?:finaliz(?:ado|amos)|fech(?:ado|amento))[^\n]{0,30}?\b(\d+(?:[.,]\d+)?)\s*km\b/i,
  ]);
  const centralReportedValue = firstNumber(raw, [
    /(?:valor\s*total|valor\s*do\s*servi[cç]o|total\s*a\s*pagar)\s*[:=\-]?\s*(?:r\$\s*)?(\d{2,6}(?:[.,]\d{1,2})?)/i,
    /(?:fechamento|finalizado)[^\n]{0,60}?(?:r\$\s*)(\d{2,6}(?:[.,]\d{1,2})?)/i,
  ]);
  const toll = firstNumber(raw, [/(?:ped[aá]gio)\s*[:=\-]?\s*(?:r\$\s*)?(\d{1,5}(?:[.,]\d{1,2})?)/i]);
  const invoiceExtra = firstNumber(raw, [/(?:nota\s*fiscal|\bnf\b)\s*[:=\-]?\s*(?:r\$\s*)?(\d{1,5}(?:[.,]\d{1,2})?)/i]);
  const dirtRoadKm = firstNumber(raw, [/(?:km\s*(?:de|em)\s*terra|terra)\s*[:=\-]?\s*(\d+(?:[.,]\d+)?)/i]);
  const onSiteMinutes = firstNumber(raw, [/(?:tempo\s*(?:no|em)\s*local|ficou|demorou|aguardou|esperou)\D{0,20}(\d+(?:[.,]\d+)?)\s*(?:min|minutos?)/i]);
  const association = labeled(raw, ['ASSOCIA[CÇ][AÃ]O', 'ASSIST[EÊ]NCIA', 'SEGURADORA', 'CLIENTE']);
  const protocol = labeled(raw, ['PROTOCOLO', 'N[º°]?\\s*PROTOCOLO']);
  const origin = cleanStructuredAddressValue(labeled(raw, ['ORIGEM', 'ENDERE[CÇ]O\\s*ORIGEM']));
  const destination = cleanStructuredAddressValue(labeled(raw, ['DESTINO', 'ENDERE[CÇ]O\\s*DESTINO']));
  const looseVehicleMatch = raw.match(/(?:^|\n)\s*(?:VE[IÍ]CULO|CARRO|MODELO)\s+([^:\n][^\n]{0,119})/im);
  const looseVehicle = looseVehicleMatch?.[1]?.trim().replace(/[.;,]+$/, '') || '';
  const vehicle = labeled(raw, ['VE[IÍ]CULO', 'MODELO']) || looseVehicle;
  const plate = labeled(raw, ['PLACA']);
  const service = labeled(raw, ['SERVI[CÇ]O', 'TIPO\\s*DE\\s*SERVI[CÇ]O']);
  const associatedName = labeled(raw, ['ASSOCIADO', 'SEGURADO']);
  const contactPhone = labeled(raw, ['TELEFONE', 'CONTATO']);
  const serviceReason = labeled(raw, ['MOTIVO']);
  const companions = firstNumber(raw, [/(?:acompanhantes?)\s*[:=\-]?\s*(\d{1,2})/i]);

  const dateMatch = raw.match(/\b(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))\b/);
  const explicitTimeMatch = raw.match(/\b(?:[aà]s?\s*)?(\d{1,2})(?::(\d{2})|h(?:\s*(\d{2}))?)\b/i);
  const relativeTimeMatch = raw.match(/\b(?:amanh[ãa]|hoje)(?:\s+(?:[aà]s?))?\s*(\d{1,2})(?:(?::|h)\s*(\d{1,2}))?\b/i);
  const timeMatch = relativeTimeMatch || explicitTimeMatch;
  let scheduledAt = null;
  const saoPauloDateParts = (date = new Date()) => {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(date);
    const get = (type) => parts.find((part) => part.type === type)?.value || '';
    return { year: Number(get('year')), month: Number(get('month')), day: Number(get('day')) };
  };
  const toSaoPauloIso = ({ year, month, day, hour = 0, minute = 0 }) => {
    const pad = (n) => String(n).padStart(2, '0');
    const value = new Date(`${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00-03:00`);
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  };
  if (/\bagend/.test(value) && dateMatch) {
    const nowParts = saoPauloDateParts();
    const year = Number(dateMatch[3] || nowParts.year);
    const fullYear = year < 100 ? 2000 + year : year;
    const hh = Number(timeMatch?.[1] || 0), mm = Number(timeMatch?.[2] || timeMatch?.[3] || 0);
    scheduledAt = toSaoPauloIso({ year: fullYear, month: Number(dateMatch[2]), day: Number(dateMatch[1]), hour: hh, minute: mm });
  } else if (/\bamanha\b/.test(value) && timeMatch) {
    const current = saoPauloDateParts();
    const noonUtc = new Date(Date.UTC(current.year, current.month - 1, current.day, 12, 0, 0));
    noonUtc.setUTCDate(noonUtc.getUTCDate() + 1);
    const next = saoPauloDateParts(noonUtc);
    const hh = Number(timeMatch[1] || 0), mm = Number(timeMatch[2] || timeMatch[3] || 0);
    scheduledAt = toSaoPauloIso({ ...next, hour: hh, minute: mm });
  } else if (/\bhoje\b/.test(value) && timeMatch) {
    const current = saoPauloDateParts();
    const hh = Number(timeMatch[1] || 0), mm = Number(timeMatch[2] || timeMatch[3] || 0);
    scheduledAt = toSaoPauloIso({ ...current, hour: hh, minute: mm });
  }

  return {
    totalKm,
    centralReportedValue,
    extras: { toll, invoiceExtra, dirtRoadKm },
    association,
    protocol,
    origin,
    destination,
    vehicle,
    plate,
    service,
    associatedName,
    contactPhone,
    serviceReason,
    companions,
    vehicleType: inferVehicleType(`${vehicle} ${service} ${raw}`),
    scheduledAt,
    onSiteMinutes,
  };
}

export function buildEvidenceChecklist(groupName = '', text = '') {
  const profile = resolveGroupProfile(groupName);
  const value = norm(text);
  const items = [...profile.evidence];
  if (/\bvideo\b|\bvídeo\b/.test(value) && !items.some((x) => norm(x).includes('video'))) items.push('Vídeo solicitado no protocolo');
  if (/\bchecklist\b/.test(value) && !items.some((x) => norm(x).includes('checklist'))) items.push('Checklist solicitado no protocolo');
  if (/\bfoto/.test(value) && !items.some((x) => norm(x).includes('foto'))) items.push('Fotos solicitadas no protocolo');
  return [...new Set(items)].map((label) => ({ label, done: false }));
}

export function markEvidenceChecklist(checklist = [], text = '', hasMedia = false) {
  const value = norm(text);
  const marksPhotos = hasMedia || /\bfotos?\b/.test(value);
  const marksVideo = /\bvideo\b/.test(value);
  const marksChecklist = /\bchecklist\b/.test(value);
  return (Array.isArray(checklist) ? checklist : []).map((item) => {
    const label = norm(item?.label);
    const done = item?.done === true
      || (marksPhotos && /foto|angulo|frente|traseira|latera|prancha|embarque/.test(label))
      || (marksVideo && /video/.test(label))
      || (marksChecklist && /checklist|assinatura/.test(label));
    return { ...item, done, completedAt: done && !item?.completedAt ? new Date().toISOString() : (item?.completedAt || null) };
  });
}

export function appendOperationalTimeline(timeline = [], event = {}) {
  const at = event.at || new Date().toISOString();
  const row = {
    id: event.id || `evt-${Date.parse(at) || Date.now()}-${(Array.isArray(timeline) ? timeline.length : 0) + 1}`,
    at,
    type: String(event.type || 'atualizacao'),
    fromStatus: event.fromStatus || null,
    toStatus: event.toStatus || null,
    text: String(event.text || '').slice(0, 1200),
    meta: event.meta && typeof event.meta === 'object' ? event.meta : {},
  };
  return [...(Array.isArray(timeline) ? timeline : []), row].slice(-200);
}

function chooseServiceRule(approvedRules, vehicleType) {
  const services = approvedRules?.services || {};
  if (vehicleType && services[vehicleType]) return { type: vehicleType, rule: services[vehicleType] };
  const usable = Object.entries(services).filter(([, rule]) => Number(rule?.basePrice) > 0);
  if (usable.length === 1) return { type: usable[0][0], rule: usable[0][1] };
  return null;
}

export function calculateApprovedCommercial({ approvedRules = null, vehicleType = null, totalKm = null, reportedExtras = {} } = {}) {
  if (!approvedRules || !(Number(totalKm) >= 0)) return { status: 'insufficient_data', amount: null };
  const selected = chooseServiceRule(approvedRules, vehicleType);
  if (!selected) return { status: 'vehicle_type_required', amount: null };
  const base = Number(selected.rule.basePrice || 0);
  const includedKm = Number(selected.rule.includedKm || 0);
  const perKm = Number(selected.rule.pricePerKm || 0);
  if (!(base > 0) || !(includedKm >= 0) || !(perKm >= 0)) return { status: 'rule_incomplete', amount: null };

  const dirtRoadKm = Math.max(0, Number(reportedExtras.dirtRoadKm || 0));
  const asphaltKm = Math.max(0, Number(totalKm) - dirtRoadKm);
  const excessKm = Math.max(0, asphaltKm - includedKm);
  let amount = base + excessKm * perKm + dirtRoadKm * 3.8;
  const extras = [];
  if (dirtRoadKm > 0) extras.push({ type: 'estrada_terra', km: dirtRoadKm, ratePerKm: 3.8, amount: Math.round(dirtRoadKm * 3.8 * 100) / 100 });

  if (Number(reportedExtras.toll) > 0 && approvedRules.tollAllowed === true) {
    amount += Number(reportedExtras.toll); extras.push({ type: 'pedagio', amount: Number(reportedExtras.toll) });
  }
  if (Number(reportedExtras.invoiceExtra) > 0 && Number(approvedRules.invoiceFee || 0) > 0) {
    const fee = Number(approvedRules.invoiceFee); amount += fee; extras.push({ type: 'nota_fiscal', amount: fee });
  }

  return {
    status: 'calculated',
    amount: Math.round(amount * 100) / 100,
    vehicleType: selected.type,
    base,
    includedKm,
    totalKm: Number(totalKm),
    excessKm: Math.round(excessKm * 10) / 10,
    pricePerKm: perKm,
    dirtRoadKm,
    dirtRoadRatePerKm: 3.8,
    extras,
  };
}

export function reconcileCommercial({ approvedRules = null, facts = {}, estimatedTotalKm = null } = {}) {
  const totalKm = facts.totalKm ?? estimatedTotalKm;
  const calculation = calculateApprovedCommercial({
    approvedRules,
    vehicleType: facts.vehicleType,
    totalKm,
    reportedExtras: facts.extras,
  });
  const reported = Number(facts.centralReportedValue || 0) || null;
  if (calculation.status !== 'calculated') {
    return {
      status: approvedRules ? calculation.status : 'commercial_rule_not_approved',
      calculatedAmount: null,
      reportedAmount: reported,
      reviewRequired: Boolean(reported),
      calculation,
    };
  }
  const delta = reported === null ? null : Math.round((reported - calculation.amount) * 100) / 100;
  const reviewRequired = delta !== null && Math.abs(delta) > 1;
  return {
    status: reviewRequired ? 'divergence' : 'ok',
    calculatedAmount: calculation.amount,
    reportedAmount: reported,
    delta,
    reviewRequired,
    calculation,
  };
}

export function learningContextForGroup(groupName = '', knowledgeEntry = null) {
  const profile = resolveGroupProfile(groupName);
  const lines = [
    `PERFIL OPERACIONAL DO GRUPO: ${profile.key}.`,
    ...profile.safeguards.map((x) => `- Regra: ${x}`),
  ];
  const examples = Array.isArray(knowledgeEntry?.examples) ? knowledgeEntry.examples.slice(-8) : [];
  if (examples.length) {
    lines.push('EXEMPLOS HUMANOS APRENDIDOS NESTE GRUPO:');
    for (const example of examples) lines.push(`- Quando: ${String(example.trigger || '').slice(0, 350)} | Humano respondeu: ${String(example.reply || '').slice(0, 220)}`);
  }
  if (knowledgeEntry?.commercialStatus) lines.push(`STATUS DA REGRA COMERCIAL: ${knowledgeEntry.commercialStatus}. Nunca invente preço.`);
  return lines.join('\n');
}

export function callStatusForIntent(intent = '') {
  return ({
    availability: 'cotacao',
    quote: 'cotacao',
    pending_approval: 'aguardando_aprovacao',
    authorization: 'autorizado',
    formal_dispatch: 'autorizado',
    protocol_received: 'aguardando_aprovacao',
    dispatch_details: 'aguardando_aprovacao',
    incomplete_dispatch: 'aguardando_dados',
    protocol_update: null,
    departure: 'a_caminho',
    arrival: 'em_atendimento',
    waiting_customer: 'em_atendimento',
    loaded: 'em_atendimento',
    destination_arrival: 'em_atendimento',
    scheduled_dispatch: 'agendado',
    cancellation: 'cancelado',
    closure: 'aguardando_fechamento',
  })[intent] || null;
}

export function shouldStaySilent(intent, groupName = '') {
  const profile = resolveGroupProfile(groupName);
  if (intent === 'administrative_notice') return true;
  if (profile.key === 'assistencia-segura' && intent === 'administrative_notice') return true;
  return false;
}
