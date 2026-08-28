function finiteTimestamp(value) {
  const parsed = Date.parse(String(value || '').trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function parseBrazilianDate(value = '') {
  const raw = String(value || '').trim();
  const match = raw.match(/(?:^|\D)(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})(?:\D+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!match) return null;
  const [, day, month, year, hour = '00', minute = '00', second = '00'] = match;
  const d = Number(day), m = Number(month), y = Number(year);
  if (d < 1 || d > 31 || m < 1 || m > 12 || y < 2000 || y > 2200) return null;
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}-03:00`;
  return finiteTimestamp(iso);
}

export function trackerSourceTimestamp(reading) {
  const structured = finiteTimestamp(reading?.sourceUpdatedAt);
  if (structured !== null) return structured;
  const raw = String(reading?.lastUpdateText || '').trim();
  if (raw) {
    const direct = finiteTimestamp(raw);
    if (direct !== null) return direct;
    const brazilian = parseBrazilianDate(raw);
    if (brazilian !== null) return brazilian;
  }
  return null;
}

export function trackerTransportTimestamp(reading) {
  // receivedAt/capturedAt dizem quando NOSSO agente acabou de consultar o GConnect.
  // lastUpdateText/sourceUpdatedAt dizem quando o veículo gerou o último evento.
  // Um caminhão parado pode ficar horas/dias sem novo evento, mesmo com o agente
  // consultando o GConnect normalmente. Para liberar ETA, o que precisa estar
  // fresco é a comunicação do agente, não o último movimento do veículo.
  const received = finiteTimestamp(reading?.receivedAt);
  if (received !== null) return received;
  const captured = finiteTimestamp(reading?.capturedAt);
  if (captured !== null) return captured;
  return trackerSourceTimestamp(reading);
}

function ageFromTimestamp(timestamp, nowMs) {
  if (timestamp === null) return null;
  const ms = Number(nowMs) - timestamp;
  return Number.isFinite(ms) ? Math.max(0, Math.round(ms / 1000)) : null;
}

export function trackerSourceAgeSeconds(reading, nowMs = Date.now()) {
  return ageFromTimestamp(trackerSourceTimestamp(reading), nowMs);
}

export function trackerAgeSeconds(reading, nowMs = Date.now()) {
  return ageFromTimestamp(trackerTransportTimestamp(reading), nowMs);
}
