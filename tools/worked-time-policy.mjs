export const ON_SITE_GRACE_MINUTES = 15;
export const WORKED_HOUR_RATE = 80;

function validDate(value) {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date : null;
}

export function evaluateWorkedTime({ arrivedAt = null, finishedAt = new Date(), reportedMinutes = null } = {}) {
  const arrival = validDate(arrivedAt);
  const finish = validDate(finishedAt) || new Date();
  const explicit = Number(reportedMinutes);
  const elapsedMinutes = Number.isFinite(explicit) && explicit >= 0
    ? explicit
    : arrival ? Math.max(0, Math.ceil((finish.getTime() - arrival.getTime()) / 60_000)) : 0;
  const chargeRequired = elapsedMinutes > ON_SITE_GRACE_MINUTES;
  const chargedHours = chargeRequired ? Math.ceil((elapsedMinutes - ON_SITE_GRACE_MINUTES) / 60) : 0;
  return {
    arrivedAt: arrival?.toISOString() || null,
    finishedAt: finish.toISOString(),
    elapsedMinutes,
    graceMinutes: ON_SITE_GRACE_MINUTES,
    chargeRequired,
    chargedHours,
    hourlyRate: WORKED_HOUR_RATE,
    amount: chargedHours * WORKED_HOUR_RATE,
    roundingRule: 'hora_iniciada_apos_tolerancia',
  };
}

export function addWorkedTimeToCommercial(commercial = {}, workedTime = {}) {
  if (!workedTime.chargeRequired) return { ...commercial, workedTimeAmount: 0 };
  if (commercial.calculatedAmount === null || commercial.calculatedAmount === undefined || commercial.calculatedAmount === '') return {
    ...commercial,
    reviewRequired: true,
    reviewReason: 'A hora trabalhada foi calculada, mas falta calcular o valor-base do atendimento.',
    workedTimeAmount: workedTime.amount,
  };
  const baseAmount = Number(commercial.calculatedAmount);
  if (!(baseAmount >= 0)) return {
    ...commercial,
    reviewRequired: true,
    reviewReason: 'A hora trabalhada foi calculada, mas falta calcular o valor-base do atendimento.',
    workedTimeAmount: workedTime.amount,
  };
  return {
    ...commercial,
    status: 'ok',
    calculatedAmount: Math.round((baseAmount + workedTime.amount) * 100) / 100,
    workedTimeAmount: workedTime.amount,
    workedTimeHours: workedTime.chargedHours,
    workedTimeHourlyRate: workedTime.hourlyRate,
    reviewRequired: false,
  };
}
