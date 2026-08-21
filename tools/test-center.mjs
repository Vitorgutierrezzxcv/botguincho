import crypto from 'node:crypto';

export const TEST_GROUP_NAME = 'Tests guincho';
export const TEST_MESSAGE_INTERVAL_MS = 3500;
export const TEST_RESPONSE_TIMEOUT_MS = 45000;
export const TEST_SUITE_VERSION = 'operational-v5';

export const TEST_SCENARIOS = [
  {
    id: 'availability', category: 'Atendimento', name: 'Disponibilidade imediata', mode: 'whatsapp',
    steps: [{ send: 'Boa tarde, possui disponibilidade para um atendimento agora em Betim?', expect: ['disponível', 'sim', 'atender'], forbid: ['indisponível', 'fora de rota'] }],
  },
  {
    id: 'complete_dispatch', category: 'Atendimento', name: 'Acionamento completo com origem e destino', mode: 'whatsapp',
    steps: [
      { send: 'Tem disponibilidade para um veículo de passeio agora?', expect: ['disponível', 'sim', 'atender'], forbid: ['indisponível', 'fora de rota'] },
      { send: 'Origem: Rua das Rosas, 310, São Salvador, Betim - MG. Destino: Avenida Amazonas, 1200, Centro, Betim - MG. Veículo: Fiat Uno.', expect: ['dados', 'aguardando autorização', 'previs'], forbid: ['confirmado', 'pode seguir'] },
      { send: 'Confirmado, pode seguir com o atendimento.', expect: ['confirmado', 'cancelamento', '15'] },
    ],
  },
  {
    id: 'maps_link', category: 'Localização', name: 'Origem por link do Google Maps', mode: 'whatsapp',
    steps: [{ send: 'Origem https://maps.google.com/?q=-19.9679517,-44.3627716 destino Rua Rio de Janeiro, 500, Centro, Betim - MG. Carro de passeio.', expect: ['previs', 'localiza', 'confirm', 'endereço'] }],
  },
  {
    id: 'incomplete_address', category: 'Localização', name: 'Endereço incompleto', mode: 'whatsapp',
    steps: [{ send: 'O carro está parado no centro, consegue buscar?', expect: ['endereço', 'localiza', 'origem', 'destino'] }],
  },
  {
    id: 'arrival', category: 'Atendimento', name: 'Registro de chegada', mode: 'whatsapp',
    steps: [
      { send: 'Origem: Rua das Rosas, 310, Betim - MG. Destino: Avenida Amazonas, 1200, Betim - MG. Veículo: Fiat Uno.', expect: ['previs', 'confirm', 'dispon'] },
      { send: 'Confirmado, pode seguir.', expect: ['confirmado', '15'] },
      { send: 'O guincho chegou no local do cliente.', expect: ['chegada', '15', '80'] },
    ],
  },
  {
    id: 'arrival_without_tow', category: 'Cobrança', name: 'Chegou, carro funcionou e não houve reboque', mode: 'whatsapp',
    steps: [
      { send: 'Origem: Rua das Rosas, 310, Betim - MG. Destino: Avenida Amazonas, 1200, Betim - MG. Veículo: Fiat Uno.', expect: ['previs', 'confirm', 'dispon'] },
      { send: 'Confirmado, pode seguir.', expect: ['confirmado', '15'] },
      { send: 'O guincho chegou no local do cliente.', expect: ['chegada', '15', '80'] },
      { send: 'O carro voltou a funcionar e o cliente não quer mais levar. Finalize sem reboque.', expect: ['deslocamento', 'integral', 'sem reboque', 'pagamento parcial'] },
    ],
  },
  {
    id: 'dirt_road_start', category: 'Cobrança', name: 'Início de estrada de terra sem localização', mode: 'whatsapp',
    steps: [
      { send: 'Origem: Rua das Rosas, 310, Betim - MG. Destino: Avenida Amazonas, 1200, Betim - MG. Veículo: Fiat Uno.', expect: ['previs', 'confirm', 'dispon'] },
      { send: 'Confirmado, pode seguir.', expect: ['confirmado', '15'] },
      { send: 'Começou agora a estrada de terra.', expect: ['localização', 'terra', '3,80', 'quilômetros'] },
    ],
  },
  {
    id: 'non_operational', category: 'Segurança', name: 'Mensagem administrativa sem resposta', mode: 'whatsapp',
    steps: [{ send: 'Pessoal, segue comunicado interno: reunião amanhã às 9h.', expectSilence: true }],
  },
  {
    id: 'protocol_requires_authorization', category: 'Autorização', name: 'Protocolo não autoriza sozinho', mode: 'whatsapp',
    steps: [
      { send: 'PROTOCOLO: TESTE-101\nORIGEM: Rua das Rosas, 310, Betim - MG\nDESTINO: Avenida Amazonas, 1200, Betim - MG\nVEÍCULO: Fiat Uno\nDisponível?', expect: ['disponível'], forbid: ['confirmado'] },
      { send: 'PROTOCOLO: TESTE-101\nORIGEM: Rua das Rosas, 310, Betim - MG\nDESTINO: Avenida Amazonas, 1200, Betim - MG\nVEÍCULO: Fiat Uno', expect: ['protocolo', 'aguardando autorização'], forbid: ['confirmado'] },
    ],
  },
  {
    id: 'repeated_authorization', category: 'Autorização', name: 'Autorização repetida sem duplicar corrida', mode: 'whatsapp',
    steps: [
      { send: 'Origem: Rua das Rosas, 310, Betim - MG. Destino: Avenida Amazonas, 1200, Betim - MG. Veículo: Fiat Uno.', expect: ['dados', 'aguardando autorização'] },
      { send: 'Pode seguir.', expect: ['confirmado', '15'] },
      { send: 'Confirmado, pode seguir.', expect: ['já registrada', 'ja registrada'], forbid: ['cancelamento sem cobrança'] },
    ],
  },
  {
    id: 'customer_absent', category: 'Ocorrência', name: 'Cliente ausente no local', mode: 'whatsapp',
    steps: [
      { send: 'Origem: Rua das Rosas, 310, Betim - MG. Destino: Avenida Amazonas, 1200, Betim - MG. Veículo: Fiat Uno.', expect: ['dados', 'aguardando autorização'] },
      { send: 'Pode seguir.', expect: ['confirmado', '15'] },
      { send: 'O guincho chegou no local do cliente.', expect: ['chegada', '15', '80'] },
      { send: 'O cliente não apareceu; estou aguardando o cliente.', expect: ['cliente ausente', 'tolerância', '15'] },
    ],
  },
  {
    id: 'route_update', category: 'Execução', name: 'Alteração de destino durante a corrida', mode: 'whatsapp',
    steps: [
      { send: 'Origem: Rua das Rosas, 310, Betim - MG. Destino: Avenida Amazonas, 1200, Betim - MG. Veículo: Fiat Uno.', expect: ['dados', 'aguardando autorização'] },
      { send: 'Pode seguir.', expect: ['confirmado', '15'] },
      { send: 'Alteração de destino. Novo destino: Rua Rio de Janeiro, 500, Betim - MG.', expect: ['novo destino', 'registrado'] },
    ],
  },
  {
    id: 'full_lifecycle', category: 'Atendimento', name: 'Fluxo completo até o fechamento', mode: 'whatsapp',
    steps: [
      { send: 'Origem: Rua das Rosas, 310, Betim - MG. Destino: Avenida Amazonas, 1200, Betim - MG. Veículo: Fiat Uno.', expect: ['dados', 'aguardando autorização'] },
      { send: 'Pode seguir.', expect: ['confirmado', '15'] },
      { send: 'Saindo agora para o atendimento.', expect: ['saída registrada', 'saida registrada'] },
      { send: 'O guincho chegou no local do cliente.', expect: ['chegada', '15', '80'] },
      { send: 'O veículo está na prancha.', expect: ['embarque', 'registrado'] },
      { send: 'Chegamos ao destino e entregamos na oficina.', expect: ['chegada ao destino', 'evidências'] },
      { send: 'Fotos enviadas e checklist concluído.', expect: ['evidência', 'evidências'] },
      { send: 'Finalizado com 20 km.', expect: ['finalizado', 'revisão', 'fechamento'] },
    ],
  },
  { id: 'cancel_15_boundary', category: 'Cancelamento', name: 'Limite exato de 15 minutos', mode: 'engine' },
  { id: 'cancel_after_15', category: 'Cancelamento', name: 'Cancelamento após 15 minutos', mode: 'engine' },
  { id: 'reject_half_payment', category: 'Cancelamento', name: 'Recusa de pagamento parcial', mode: 'engine' },
  { id: 'worked_15_boundary', category: 'Hora trabalhada', name: 'Tolerância exata de 15 minutos', mode: 'engine' },
  { id: 'worked_first_hour', category: 'Hora trabalhada', name: 'Primeira hora integral no 16º minuto', mode: 'engine' },
  { id: 'worked_second_hour', category: 'Hora trabalhada', name: 'Segunda hora iniciada', mode: 'engine' },
  { id: 'dirt_round_trip', category: 'Estrada de terra', name: 'Terra ida e volta substituindo asfalto', mode: 'engine' },
  { id: 'driver_50', category: 'Motorista', name: 'Pagamento até 50 km', mode: 'engine' },
  { id: 'driver_excess', category: 'Motorista', name: 'Pagamento por km excedente', mode: 'engine' },
  { id: 'driver_worked_hour', category: 'Motorista', name: 'Hora trabalhada integral do motorista', mode: 'engine' },
  { id: 'driver_period', category: 'Motorista', name: 'Fechamento do dia 20 ao dia 20', mode: 'engine' },
];

export function normalizeTestText(value = '') {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

export function isTestGroupName(value = '') {
  return normalizeTestText(value).trim() === normalizeTestText(TEST_GROUP_NAME);
}

export function isTestCall(call = {}) {
  return call?.testMode === true || isTestGroupName(call?.insurer || call?.client || call?.groupName || '');
}

export function responseMatches(response = '', expected = [], forbidden = []) {
  const text = normalizeTestText(response);
  if (forbidden.some((term) => text.includes(normalizeTestText(term)))) return false;
  return expected.some((term) => text.includes(normalizeTestText(term)));
}

export function createTestRun(scenarioIds = [], now = new Date()) {
  const selected = scenarioIds.length ? new Set(scenarioIds) : null;
  const scenarios = TEST_SCENARIOS.filter((item) => !selected || selected.has(item.id));
  return {
    id: crypto.randomUUID(), status: 'queued', startedAt: null, finishedAt: null,
    createdAt: now.toISOString(), stopRequested: false, suiteVersion: TEST_SUITE_VERSION,
    totals: { scenarios: scenarios.length, passed: 0, failed: 0, skipped: 0, running: 0 },
    results: scenarios.map((scenario) => ({
      scenarioId: scenario.id, name: scenario.name, category: scenario.category, mode: scenario.mode,
      status: 'queued', startedAt: null, finishedAt: null, steps: [], error: null,
    })),
  };
}

export function currentTestHistory(history = []) {
  return (Array.isArray(history) ? history : []).filter((run) => run?.suiteVersion === TEST_SUITE_VERSION);
}

export function summarizeTestRun(run) {
  const results = Array.isArray(run?.results) ? run.results : [];
  return {
    scenarios: results.length,
    passed: results.filter((item) => item.status === 'passed').length,
    failed: results.filter((item) => item.status === 'failed').length,
    skipped: results.filter((item) => item.status === 'skipped').length,
    running: results.filter((item) => item.status === 'running').length,
  };
}
