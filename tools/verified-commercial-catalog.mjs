function norm(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const STANDARD_135 = {
  leve: { basePrice: 135, includedKm: 40, pricePerKm: 3, dirtRoadPricePerKm: 3.8 },
  moto: { basePrice: 135, includedKm: 40, pricePerKm: 3, dirtRoadPricePerKm: 3.8 },
  utilitario: { basePrice: 160, includedKm: 40, pricePerKm: 3.2, dirtRoadPricePerKm: 3.8 },
};

const CATALOG = [
  {
    key: 'solucao',
    name: 'Solução Assistência',
    sourceFile: '_chat.txt',
    match: /solucao assistencia/,
    sourceLabel: 'Conversas reais + descrição atual do grupo',
    notes: ['Leve R$ 130 até 40 km + R$ 3/km.', 'Utilitário R$ 160 até 40 km + R$ 3,20/km.', 'Hora parada e hora trabalhada R$ 80.'],
    rules: {
      detected: true,
      source: 'verified_catalog',
      services: {
        leve: { basePrice: 130, includedKm: 40, pricePerKm: 3, dirtRoadPricePerKm: 3.8 },
        utilitario: { basePrice: 160, includedKm: 40, pricePerKm: 3.2, dirtRoadPricePerKm: 3.8 },
      },
      workedHour: 80,
      stoppedHour: 80,
      invoiceFee: null,
      tollAllowed: true,
      noSkates: true,
    },
  },
  {
    key: 'top-brasil',
    name: 'Top Brasil',
    sourceFile: '_chat(1).txt',
    match: /top brasil/,
    sourceLabel: 'Conversas reais — valores recorrentes mais recentes',
    notes: ['Leve R$ 135 até 40 km + R$ 3/km.', 'Utilitário R$ 160 até 40 km + R$ 3,20/km.', 'Pedágio é acrescentado quando houver.'],
    rules: {
      detected: true,
      source: 'verified_catalog',
      services: {
        leve: { basePrice: 135, includedKm: 40, pricePerKm: 3, dirtRoadPricePerKm: 3.8 },
        utilitario: { basePrice: 160, includedKm: 40, pricePerKm: 3.2, dirtRoadPricePerKm: 3.8 },
      },
      workedHour: 80,
      stoppedHour: 80,
      invoiceFee: null,
      tollAllowed: true,
    },
  },
  {
    key: 'saturno',
    name: 'Saturno',
    sourceFile: '_chat(2).txt',
    match: /saturno|\(sb\)/,
    sourceLabel: 'Conversas reais + descrição atual do grupo',
    notes: ['A descrição atual do WhatsApp prevalece sobre tabelas antigas do histórico.'],
    rules: {
      detected: true,
      source: 'verified_catalog',
      services: { ...STANDARD_135 },
      workedHour: 80,
      stoppedHour: 80,
      invoiceFee: null,
      tollAllowed: true,
    },
  },
  {
    key: 'plus',
    name: 'Plus Assistência',
    sourceFile: '_chat(3).txt',
    match: /plus assistencia/,
    sourceLabel: 'Conversas reais + descrição atual do grupo',
    notes: ['O histórico teve reajustes; para automação vale a descrição atual do grupo.', 'Utilitário atual R$ 170 até 40 km + R$ 3,20/km.'],
    rules: {
      detected: true,
      source: 'verified_catalog',
      services: {
        leve: { basePrice: 130, includedKm: 40, pricePerKm: 3, dirtRoadPricePerKm: 3.5 },
        moto: { basePrice: 130, includedKm: 40, pricePerKm: 3, dirtRoadPricePerKm: 3.5 },
        utilitario: { basePrice: 170, includedKm: 40, pricePerKm: 3.2, dirtRoadPricePerKm: 3.8 },
      },
      workedHour: 80,
      stoppedHour: 80,
      invoiceFee: null,
      tollAllowed: true,
    },
  },
  {
    key: 'company-truck',
    name: 'Company Truck',
    sourceFile: '_chat(4).txt',
    match: /company truck/,
    sourceLabel: 'Conversas reais + descrição atual do grupo',
    notes: ['NF de R$ 20 aparece repetidamente no histórico.', 'Utilitário R$ 160 até 40 km + R$ 3,20/km.'],
    rules: {
      detected: true,
      source: 'verified_catalog',
      services: { ...STANDARD_135 },
      workedHour: 80,
      stoppedHour: 80,
      invoiceFee: 20,
      tollAllowed: true,
    },
  },
  {
    key: 'horizonte',
    name: 'Horizonte',
    sourceFile: '_chat(5).txt',
    match: /horizonte/,
    sourceLabel: 'Conversas reais + descrição atual do grupo',
    notes: ['A descrição atual do WhatsApp prevalece sobre a tabela antiga de fevereiro.'],
    rules: {
      detected: true,
      source: 'verified_catalog',
      services: { ...STANDARD_135 },
      workedHour: 80,
      stoppedHour: 80,
      invoiceFee: null,
      tollAllowed: true,
    },
  },
  {
    key: 'socorre',
    name: 'Socorre Assistência',
    sourceFile: '_chat(6).txt',
    match: /socorre assistencia|\bsocorre\b/,
    sourceLabel: 'Conversas reais + descrição atual do grupo',
    notes: ['Tabela padrão: leve R$ 135/40 km + R$ 3/km; utilitário R$ 160/40 km + R$ 3,20/km.', 'ATS possui exceção própria para leve: R$ 120 até 40 km + R$ 3/km.'],
    rules: {
      detected: true,
      source: 'verified_catalog',
      services: { ...STANDARD_135 },
      workedHour: 80,
      stoppedHour: 80,
      invoiceFee: null,
      tollAllowed: true,
    },
    associationOverrides: [
      {
        key: 'ats',
        match: /\bats\b/,
        label: 'ATS Clube de Benefícios',
        services: {
          leve: { basePrice: 120, includedKm: 40, pricePerKm: 3, dirtRoadPricePerKm: 3.8 },
        },
      },
    ],
  },
  {
    key: 'premium',
    name: 'Premium Assistência',
    sourceFile: '_chat(7).txt',
    match: /premium assistencia/,
    sourceLabel: 'Conversas reais + descrição atual do grupo',
    notes: ['Leve R$ 135 até 40 km + R$ 3/km.', 'Utilitário R$ 160 até 40 km + R$ 3,20/km.'],
    rules: {
      detected: true,
      source: 'verified_catalog',
      services: { ...STANDARD_135 },
      workedHour: 80,
      stoppedHour: 80,
      invoiceFee: null,
      tollAllowed: true,
    },
  },
  {
    key: 'assistencia-segura',
    name: 'Assistência Segura',
    sourceFile: '_chat(8).txt',
    match: /assistencia segura/,
    sourceLabel: 'Conversas reais + descrição atual do grupo',
    notes: ['Leve R$ 135 até 40 km + R$ 3/km; descrição atual também registra moto e utilitário.'],
    rules: {
      detected: true,
      source: 'verified_catalog',
      services: { ...STANDARD_135 },
      workedHour: 80,
      stoppedHour: 80,
      invoiceFee: null,
      tollAllowed: true,
    },
  },
  {
    key: 'power',
    name: 'Power',
    sourceFile: '_chat(9).txt',
    match: /\bpower\b/,
    sourceLabel: 'Conversas reais — valores recorrentes mais recentes',
    notes: ['Leve R$ 135 até 40 km + R$ 3/km.', 'Utilitário teve base recente de R$ 170, mas o km excedente não ficou suficientemente confirmado; por segurança ele não é automatizado.', 'NF varia conforme a assistência e não deve ser somada como valor fixo.'],
    rules: {
      detected: true,
      source: 'verified_catalog',
      services: {
        leve: { basePrice: 135, includedKm: 40, pricePerKm: 3, dirtRoadPricePerKm: 3.8 },
      },
      workedHour: 80,
      stoppedHour: 80,
      invoiceFee: null,
      tollAllowed: true,
    },
    displayOnly: [
      { service: 'utilitario', basePrice: 170, includedKm: 40, pricePerKm: null, note: 'Km excedente a confirmar; não usado no cálculo automático.' },
    ],
  },
];

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function positiveOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function mergeService(base = {}, observed = {}) {
  const result = { ...base };
  for (const key of ['basePrice', 'includedKm', 'pricePerKm', 'dirtRoadPricePerKm']) {
    const value = positiveOrNull(observed?.[key]);
    if (value !== null) result[key] = value;
  }
  return result;
}

function mergeRules(base = {}, observed = null) {
  const result = clone(base) || {};
  if (!observed?.detected) return result;
  const baseServices = result.services || {};
  const observedServices = observed.services || {};
  const services = {};
  for (const key of new Set([...Object.keys(baseServices), ...Object.keys(observedServices)])) {
    services[key] = mergeService(baseServices[key] || {}, observedServices[key] || {});
  }
  result.services = services;
  for (const key of ['workedHour', 'stoppedHour', 'invoiceFee']) {
    const value = positiveOrNull(observed?.[key]);
    if (value !== null) result[key] = value;
  }
  if (observed?.noSkates === true) result.noSkates = true;
  result.detected = true;
  result.source = 'verified_catalog_with_group_description';
  return result;
}

export function verifiedCommercialEntryForGroup(groupName = '') {
  const value = norm(groupName);
  const entry = CATALOG.find((item) => item.match.test(value));
  if (!entry) return null;
  const { match, associationOverrides = [], ...publicEntry } = entry;
  return {
    ...clone(publicEntry),
    associationOverrides: associationOverrides.map(({ match: _match, ...override }) => clone(override)),
  };
}

export function verifiedCommercialResolution(groupName = '', draftRules = null, association = '') {
  const value = norm(groupName);
  const entry = CATALOG.find((item) => item.match.test(value));
  if (!entry) return null;
  const rules = mergeRules(entry.rules, draftRules);
  const associationValue = norm(association);
  const override = (entry.associationOverrides || []).find((item) => item.match.test(associationValue));
  if (override) {
    rules.services = { ...(rules.services || {}) };
    for (const [service, serviceRule] of Object.entries(override.services || {})) {
      rules.services[service] = mergeService(rules.services[service] || {}, serviceRule);
    }
  }
  return {
    key: entry.key,
    name: entry.name,
    sourceFile: entry.sourceFile,
    sourceLabel: entry.sourceLabel,
    notes: clone(entry.notes || []),
    displayOnly: clone(entry.displayOnly || []),
    associationOverride: override ? { key: override.key, label: override.label } : null,
    rules,
  };
}
