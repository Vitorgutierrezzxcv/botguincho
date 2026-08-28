const CONFIRMED_STATUSES = new Set(['autorizado', 'a_caminho', 'em_atendimento', 'aguardando_fechamento', 'concluido']);

function clean(value = '', max = 500) {
  return String(value || '').trim().slice(0, max);
}

function brazilDateTime(value) {
  const date = new Date(value || '');
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function isConfirmedCall(call = {}) {
  return CONFIRMED_STATUSES.has(String(call.status || '').toLowerCase());
}

export function publicEtaMinutes(value) {
  const minutes = Math.ceil(Number(value || 0));
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  return Math.min(60, minutes);
}

export function primaryTruck(management = {}) {
  const fleet = Array.isArray(management.fleet) ? management.fleet : [];
  return fleet.find((item) => item.primary === true) || fleet[0] || null;
}

export function truckAvailability(management = {}, now = new Date()) {
  const truck = primaryTruck(management);
  if (!truck) {
    return { available: false, truck: null, reason: 'Guincho não configurado.', reply: 'Indisponível no momento.' };
  }

  const status = clean(truck.status || 'disponivel', 40).toLowerCase();
  const until = truck.unavailableUntil ? new Date(truck.unavailableUntil) : null;
  const hasFutureEnd = Boolean(until && Number.isFinite(until.getTime()) && until.getTime() > new Date(now).getTime());
  const expiredAutomaticBlock = Boolean(until && Number.isFinite(until.getTime()) && until.getTime() <= new Date(now).getTime());
  const unavailableByStatus = ['indisponivel', 'manutencao', 'quebrado'].includes(status);
  const unavailable = hasFutureEnd || (unavailableByStatus && !expiredAutomaticBlock);

  if (!unavailable) return { available: true, truck, reason: '', reply: 'Disponível ✅' };

  const reason = clean(truck.unavailabilityReason || truck.notes || 'Guincho indisponível no momento.', 240);
  const returnText = hasFutureEnd ? ` Previsão de retorno: ${brazilDateTime(until)}.` : '';
  return {
    available: false,
    truck,
    reason,
    until: hasFutureEnd ? until.toISOString() : null,
    reply: `Indisponível no momento. ${reason}${returnText}`.replace(/\s+/g, ' ').trim(),
  };
}

export function whatsappChatId(phone = '') {
  let digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  if ((digits.length === 10 || digits.length === 11) && !digits.startsWith('55')) digits = `55${digits}`;
  if (digits.length < 12 || digits.length > 13) return '';
  return `${digits}@c.us`;
}

export function driverDispatchMessage(call = {}, truck = {}) {
  const eta = publicEtaMinutes(call.etaMinutes);
  const lines = [
    '🚨 NOVA CORRIDA CONFIRMADA',
    '',
    `Transportadora/grupo: ${clean(call.insurer || call.client || 'Não informado', 160)}`,
    `Protocolo: ${clean(call.protocol || 'Aguardando envio', 120)}`,
    `Veículo: ${clean(call.vehicle || 'Não informado', 160)}`,
    `Placa: ${clean(call.plate || 'Não informada', 40)}`,
    `Associado: ${clean(call.associatedName || call.association || 'Não informado', 160)}`,
    `Telefone: ${clean(call.contactPhone || 'Não informado', 60)}`,
    `Origem: ${clean(call.origin || 'Não informada', 500)}`,
    `Destino: ${clean(call.destination || 'Não informado', 500)}`,
    eta ? `Previsão informada: ${eta} min` : null,
    truck?.plate ? `Guincho: ${clean(truck.plate, 40)}` : null,
    '',
    call?.queued ? 'Corrida em fila. Finalize o atendimento anterior antes de iniciar este deslocamento.' : 'Pode iniciar o deslocamento.',
  ].filter((line) => line !== null);
  return lines.join('\n');
}
