export const FREE_CANCELLATION_WINDOW_MINUTES = 15;

function validDate(value) {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function finiteNonNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export function cancellationDeadlineFor(authorizedAt, windowMinutes = FREE_CANCELLATION_WINDOW_MINUTES) {
  const authorized = validDate(authorizedAt);
  if (!authorized) return null;
  return new Date(authorized.getTime() + Number(windowMinutes) * 60_000).toISOString();
}

export function evaluateCancellationPolicy({
  authorizedAt = null,
  cancelledAt = new Date(),
  billableKm = null,
  windowMinutes = FREE_CANCELLATION_WINDOW_MINUTES,
} = {}) {
  const authorized = validDate(authorizedAt);
  const cancelled = validDate(cancelledAt) || new Date();
  const deadlineAt = cancellationDeadlineFor(authorized, windowMinutes);
  const elapsedMs = authorized ? Math.max(0, cancelled.getTime() - authorized.getTime()) : null;
  const elapsedMinutes = elapsedMs === null ? null : Math.round((elapsedMs / 60_000) * 100) / 100;
  const chargeRequired = Boolean(authorized && elapsedMs > Number(windowMinutes) * 60_000);
  const fullBillableKm = finiteNonNegative(billableKm);

  return {
    confirmationFound: Boolean(authorized),
    authorizedAt: authorized?.toISOString() || null,
    cancelledAt: cancelled.toISOString(),
    deadlineAt,
    windowMinutes: Number(windowMinutes),
    elapsedMinutes,
    withinFreeWindow: Boolean(authorized && !chargeRequired),
    chargeRequired,
    chargeType: chargeRequired ? 'saida_deslocamento_integral' : (authorized ? 'sem_cobranca_no_prazo' : 'sem_cobranca_sem_confirmacao'),
    chargeBasis: chargeRequired ? 'quilometragem_total' : 'none',
    billableKm: chargeRequired ? fullBillableKm : 0,
    partialPaymentAllowed: false,
  };
}

export function enforceFullCancellationCommercial(commercial = {}) {
  const calculatedAmount = finiteNonNegative(commercial?.calculatedAmount);
  const reportedAmount = finiteNonNegative(commercial?.reportedAmount);

  if (!(calculatedAmount > 0)) {
    return {
      ...commercial,
      status: 'full_cancellation_charge_pending_rate',
      calculatedAmount: null,
      reviewRequired: true,
      reviewReason: 'A saída e o deslocamento devem ser cobrados pela quilometragem total; falta uma tabela comercial aprovada para calcular o valor.',
      partialPaymentAllowed: false,
      reportedAmountRejected: reportedAmount !== null,
    };
  }

  const reportedAmountRejected = reportedAmount !== null && Math.abs(reportedAmount - calculatedAmount) > 1;
  return {
    ...commercial,
    status: 'ok',
    calculatedAmount,
    reviewRequired: false,
    partialPaymentAllowed: false,
    reportedAmountRejected,
    rejectedReportedAmount: reportedAmountRejected ? reportedAmount : null,
  };
}

function formatKm(value) {
  return Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
}

function formatMoney(value) {
  return Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function cancellationReply(policy = {}, amount = null) {
  if (!policy.chargeRequired) {
    return policy.confirmationFound
      ? 'Cancelamento registrado dentro do prazo de 15 minutos, sem cobrança.'
      : 'Cancelamento registrado sem cobrança.';
  }

  const km = finiteNonNegative(policy.billableKm);
  const total = finiteNonNegative(amount);
  const parts = ['Cancelamento registrado após o prazo de 15 minutos. A saída e o deslocamento serão cobrados integralmente'];
  if (km !== null) parts.push(`pela quilometragem total de ${formatKm(km)} km`);
  if (total !== null && total > 0) parts.push(`no valor de ${formatMoney(total)}`);
  return `${parts.join(', ')}. Não é aplicável cobrança parcial.`;
}
