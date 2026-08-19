import { inferLearningIntent } from './learning-engine.mjs';

function norm(value = '') {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
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
    safeguards: ['stopped_hour_needs_explicit_approval', 'scheduled_is_not_immediate'],
  },
  {
    key: 'plus', match: /plus assistencia/,
    evidence: ['Checklist/fotos exigidos pelo protocolo/WebPrestador'],
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
    safeguards: ['formal_protocol_after_acceptance_can_authorize'],
  },
  {
    key: 'socorre', match: /socorre assistencia|\bsocorre\b/,
    evidence: ['Fotos/checklist conforme protocolo da associação'],
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
  if (!/\b(protocolo|acionamento|webprestador|prestador)\b/.test(value)) return false;
  const operationalFields = ['origem', 'destino', 'veiculo', 'placa', 'servico', 'cliente', 'associado', 'solicitante']
    .filter((field) => value.includes(field)).length;
  return operationalFields >= 2 || /https?:\/\//.test(text);
}

function hasQuoteSignals(text = '') {
  const value = norm(text);
  return /\b(cotacao|valor e previa|valor,?\s*km|valor total\?|qual valor|quanto fica|preco|km totais|quilometragem total)\b/.test(value)
    || (/\bdisponivel/.test(value) && /\b(valor|previa|km)\b/.test(value));
}

export function classifyRuntimeIntent(text = '', groupName = '', recentCall = null) {
  const value = norm(text);
  const profile = resolveGroupProfile(groupName);
  const base = inferLearningIntent(text);

  const activeService = ['autorizado','a_caminho','em_atendimento'].includes(recentCall?.status);
  const arrivalSignal = /\b(guincho|prestador|motorista)\s+(ja\s+)?(chegou|esta no local)|\bchegamos?\s+(ao|no)\s+local\b/.test(value);
  const noTowSignal = /\b(carro|veiculo)\s+(voltou a\s+)?(funcionou|ligou|pegou)\b|\b(nao quer|n quer|nao deseja|recusou)\s+(levar|remover|rebocar)|\b(dispensou|dispensa)\s+(o\s+)?guincho\b|\bsem\s+reboque\b/.test(value);
  if (activeService && arrivalSignal && noTowSignal) return 'arrival_without_tow';
  if (activeService && arrivalSignal) return 'arrival';

  if (base === 'administrative_notice') return 'administrative_notice';
  if (base === 'cancellation') return 'cancellation';
  if (base === 'pending_approval') return 'pending_approval';
  if (base === 'scheduled_dispatch') return 'scheduled_dispatch';

  if (profile.key === 'company-truck' && /cotacao\s+visao|tipo\s*:\s*visao/.test(value)) return 'quote';

  // A mesma pergunta de valor muda de significado conforme o estado do chamado.
  // Depois da autorização/execução, frases de finalização são fechamento, não nova cotação.
  const closureQuestion = /\b(finaliz|fechamento|fechamos|quanto finalizou|em quantos km|quantos km|km final|km e valor|valor final|finalizou em)\b/.test(value);
  if (activeService && (base === 'closure' || closureQuestion)) return 'closure';

  if (hasQuoteSignals(text)) return 'quote';
  if (base === 'authorization') return 'authorization';
  if (base === 'closure') return 'closure';
  if (base === 'eta') return 'eta';

  if (hasFormalProtocol(text)) {
    if (profile.formalProtocolCanAuthorize && ['cotacao','aguardando_aprovacao','novo','disponibilidade'].includes(recentCall?.status)) return 'formal_dispatch';
    return 'formal_dispatch';
  }

  if (base === 'availability') return 'availability';
  if (base === 'dispatch') return 'dispatch';
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
  const raw = String(text || '').replace(/\r/g, '');
  for (const label of labels) {
    const re = new RegExp(`(?:^|\\n)\\s*${label}\\s*[:=\\-]\\s*([^\\n]+)`, 'im');
    const match = raw.match(re);
    if (match?.[1]) return match[1].trim().slice(0, 500);
  }
  return '';
}

export function inferVehicleType(text = '') {
  const value = norm(text);
  if (/\b(utilitario|utilitária|utilitaria|van|fiorino|master|ducato|sprinter)\b/.test(value)) return 'utilitario';
  if (/\b(moto|motocicleta|scooter)\b/.test(value)) return 'moto';
  if (/\b(pesado|caminhao|caminhão|onibus|ônibus)\b/.test(value)) return 'pesado';
  if (/\b(leve|carro|automovel|automóvel|hatch|sedan|suv)\b/.test(value)) return 'leve';
  return null;
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
  const onSiteMinutes = firstNumber(raw, [/(?:tempo\s*(?:no|em)\s*local|ficou|demorou|aguardou|esperou)\D{0,20}(\d+(?:[.,]\d+)?)\s*(?:min|minutos?)/i]);
  const association = labeled(raw, ['ASSOCIA[CÇ][AÃ]O', 'ASSIST[EÊ]NCIA', 'SEGURADORA', 'CLIENTE']);
  const protocol = labeled(raw, ['PROTOCOLO', 'N[º°]?\\s*PROTOCOLO']);
  const origin = labeled(raw, ['ORIGEM', 'ENDERE[CÇ]O\\s*ORIGEM']);
  const destination = labeled(raw, ['DESTINO', 'ENDERE[CÇ]O\\s*DESTINO']);
  const vehicle = labeled(raw, ['VE[IÍ]CULO', 'MODELO']);
  const plate = labeled(raw, ['PLACA']);
  const service = labeled(raw, ['SERVI[CÇ]O', 'TIPO\\s*DE\\s*SERVI[CÇ]O']);

  const dateMatch = raw.match(/\b(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))\b/);
  const timeMatch = raw.match(/\b(?:[aà]s?\s*)?(\d{1,2})[:h](\d{2})\b/i);
  let scheduledAt = null;
  if (/\bagend/.test(value) && dateMatch) {
    const year = Number(dateMatch[3] || new Date().getFullYear());
    const fullYear = year < 100 ? 2000 + year : year;
    const hh = Number(timeMatch?.[1] || 0), mm = Number(timeMatch?.[2] || 0);
    const dt = new Date(fullYear, Number(dateMatch[2]) - 1, Number(dateMatch[1]), hh, mm);
    if (!Number.isNaN(dt.getTime())) scheduledAt = dt.toISOString();
  }

  return {
    totalKm,
    centralReportedValue,
    extras: { toll, invoiceExtra },
    association,
    protocol,
    origin,
    destination,
    vehicle,
    plate,
    service,
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

  const excessKm = Math.max(0, Number(totalKm) - includedKm);
  let amount = base + excessKm * perKm;
  const extras = [];

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
    dispatch: 'autorizado',
    scheduled_dispatch: 'agendado',
    cancellation: 'cancelado',
    closure: 'concluido',
  })[intent] || null;
}

export function shouldStaySilent(intent, groupName = '') {
  const profile = resolveGroupProfile(groupName);
  if (intent === 'administrative_notice') return true;
  if (profile.key === 'assistencia-segura' && intent === 'administrative_notice') return true;
  return false;
}
