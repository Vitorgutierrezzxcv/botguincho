from pathlib import Path

worker = Path('tools/vercel-whatsapp-worker.mjs')
s = worker.read_text()

def replace_between(text, start_marker, end_marker, replacement, label):
    start = text.find(start_marker)
    if start < 0:
        raise SystemExit(f'{label}: início não encontrado')
    end = text.find(end_marker, start)
    if end < 0:
        raise SystemExit(f'{label}: fim não encontrado')
    return text[:start] + replacement + text[end:]

new_retry = r'''async function computeEtaWithRetry(input = {}, options = {}) {
  const attempts = Math.max(1, Math.min(3, Number(options.attempts ?? 2)));
  const retryDelayMs = Math.max(0, Math.min(1500, Number(options.retryDelayMs ?? 250)));
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const eta = await computeEtaToClient(input);
      if (eta) {
        if (attempt > 1) logEvent('recovery', `ETA recuperado na tentativa ${attempt}.`);
        return eta;
      }
      lastError = new Error('ETA indisponível sem erro explícito.');
    } catch (error) {
      lastError = error;
      logEvent('warning', `Tentativa ${attempt}/${attempts} de ETA falhou.`, { error: String(error) });
    }
    if (attempt < attempts && retryDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs * attempt));
    }
  }
  if (lastError) logEvent('safety', 'ETA suspenso após tentativas; nenhum dado antigo será reutilizado.', { error: String(lastError) });
  return null;
}


'''
s = replace_between(s, 'async function computeEtaWithRetry', 'async function computeFullServiceRoute', new_retry, 'computeEtaWithRetry')

old_geo = r'''  const origin = originCoordinates && validCoordinates(originCoordinates.latitude, originCoordinates.longitude)
    ? { latitude: Number(originCoordinates.latitude), longitude: Number(originCoordinates.longitude), displayName: originAddress || 'Localização compartilhada' }
    : await geocodeAddress(originAddress);
  const destination = await geocodeAddress(destinationAddress);
  // Sem uma base configurada, fecha o circuito no ponto real de saída do
  // caminhão. Assim o cálculo continua completo e auditável, sem inventar um
  // endereço de retorno.
  const base = baseAddress ? await geocodeAddress(baseAddress) : { ...start, displayName: reading.address || 'Ponto de saída do caminhão' };
  if (!origin || !destination || !base) return null;

  const legToOrigin = await routeBetween(start, origin);
  const serviceLeg = await routeBetween(origin, destination);
  const returnToBase = await routeBetween(destination, base);
  if (!legToOrigin || !serviceLeg || !returnToBase) return null;
'''
new_geo = r'''  const originPromise = originCoordinates && validCoordinates(originCoordinates.latitude, originCoordinates.longitude)
    ? Promise.resolve({ latitude: Number(originCoordinates.latitude), longitude: Number(originCoordinates.longitude), displayName: originAddress || 'Localização compartilhada' })
    : geocodeAddress(originAddress);
  const destinationPromise = geocodeAddress(destinationAddress);
  // Sem uma base configurada, fecha o circuito no ponto real de saída do
  // caminhão. Assim o cálculo continua completo e auditável, sem inventar um
  // endereço de retorno.
  const basePromise = baseAddress
    ? geocodeAddress(baseAddress)
    : Promise.resolve({ ...start, displayName: reading.address || 'Ponto de saída do caminhão' });
  const [origin, destination, base] = await Promise.all([originPromise, destinationPromise, basePromise]);
  if (!origin || !destination || !base) return null;

  const [legToOrigin, serviceLeg, returnToBase] = await Promise.all([
    routeBetween(start, origin),
    routeBetween(origin, destination),
    routeBetween(destination, base),
  ]);
  if (!legToOrigin || !serviceLeg || !returnToBase) return null;
'''
if s.count(old_geo) != 1:
    raise SystemExit(f'computeFullServiceRoute: bloco esperado {s.count(old_geo)} vez(es)')
s = s.replace(old_geo, new_geo, 1)

marker = 'async function computeEtaToClient({ targetAddress = null, targetCoordinates = null } = {}) {'
helper = r'''function addressMatchParts(value = '') {
  const normalized = normalizeForIntent(String(value || ''))
    .replace(/\b(?:rua|r|avenida|av|travessa|tv|rodovia|rod|estrada|bairro|brasil|mg|minas|gerais|de|da|do|das|dos)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const number = normalizeForIntent(String(value || '')).match(/\b\d{1,6}[a-z]?\b/)?.[0] || '';
  const words = normalized.split(' ').filter((word) => word && word.length >= 3 && !/^\d+$/.test(word));
  return { number, words: [...new Set(words)] };
}

function likelySameOperationalAddress(targetAddress = '', trackerAddress = '') {
  if (!targetAddress || !trackerAddress) return false;
  const target = addressMatchParts(targetAddress);
  const tracker = addressMatchParts(trackerAddress);
  if (target.number && tracker.number && target.number !== tracker.number) return false;
  if (!target.number || !tracker.number) return false;
  const trackerWords = new Set(tracker.words);
  const overlap = target.words.filter((word) => trackerWords.has(word)).length;
  const required = Math.min(2, target.words.length);
  return required > 0 && overlap >= required;
}

'''
if marker not in s:
    raise SystemExit('computeEtaToClient marker não encontrado')
s = s.replace(marker, helper + marker, 1)

eta_target_old = r'''  let destination = targetCoordinates && validCoordinates(targetCoordinates.latitude, targetCoordinates.longitude)
    ? { latitude: Number(targetCoordinates.latitude), longitude: Number(targetCoordinates.longitude) }
    : null;

  if (!destination && targetAddress) {
    destination = await geocodeAddress(targetAddress);
  }
'''
eta_target_new = r'''  let destination = targetCoordinates && validCoordinates(targetCoordinates.latitude, targetCoordinates.longitude)
    ? { latitude: Number(targetCoordinates.latitude), longitude: Number(targetCoordinates.longitude) }
    : null;

  if (!destination && targetAddress && likelySameOperationalAddress(targetAddress, reading.address || '')) {
    const current = await trackerCoordinates(reading);
    if (current) {
      return {
        minutes: 1,
        distanceKm: 0,
        trackerAddress: reading.address || null,
        trackerPlate: reading.plate || null,
        targetAddress,
        sameLocation: true,
      };
    }
  }

  if (!destination && targetAddress) {
    destination = await geocodeAddress(targetAddress);
  }
'''
if s.count(eta_target_old) != 1:
    raise SystemExit(f'computeEta target: encontrado {s.count(eta_target_old)}')
s = s.replace(eta_target_old, eta_target_new, 1)

new_estimate = r'''async function estimateQuoteRoute(groupId, text, facts, incomingLocation = null, pending = null, options = {}) {
  const originAddress = extractLabeledField(text, 'Origem') || facts.origin || enderecoEmTextoLivre(text) || pending?.origin || null;
  const destinationAddress = extractLabeledField(text, 'Destino') || facts.destination || pending?.destination || null;
  const shared = await getRecentSharedLocation(groupId);
  const originCoordinates = incomingLocation
    || (!originAddress ? (pending?.originCoordinates || shared?.coordinates || null) : null);

  const fast = options?.fast === true;
  let eta = null;
  let secondLeg = null;
  let fullRoute = null;

  if (fast) {
    if (originAddress || originCoordinates) {
      eta = await computeEtaWithRetry(
        { targetAddress: originAddress, targetCoordinates: originCoordinates },
        { attempts: 2, retryDelayMs: 150 },
      ).catch(() => null);
    }
    return { originAddress, destinationAddress, originCoordinates, eta, secondLeg, fullRoute, estimatedTotalKm: null };
  }

  if ((originAddress || originCoordinates) && destinationAddress) {
    fullRoute = await computeFullServiceRoute({ originAddress, destinationAddress, originCoordinates }).catch(() => null);
    if (fullRoute) {
      eta = {
        minutes: fullRoute.legToOrigin?.minutes ?? null,
        rawMinutes: fullRoute.legToOrigin?.minutes ?? null,
        distanceKm: fullRoute.legToOrigin?.km ?? null,
      };
      secondLeg = {
        minutes: fullRoute.serviceLeg?.minutes ?? null,
        distanceKm: fullRoute.serviceLeg?.km ?? null,
      };
    }
  }

  if (!eta && (originAddress || originCoordinates)) {
    eta = await computeEtaWithRetry(
      { targetAddress: originAddress, targetCoordinates: originCoordinates },
      { attempts: 2, retryDelayMs: 200 },
    ).catch(() => null);
  }
  if (!secondLeg && originAddress && destinationAddress) {
    const [from, to] = await Promise.all([geocodeAddress(originAddress), geocodeAddress(destinationAddress)]);
    if (from && to) secondLeg = await routeBetween(from, to).catch(() => null);
  }
  const estimatedTotalKm = fullRoute?.totalKm ?? (eta?.distanceKm != null && secondLeg?.distanceKm != null
    ? Math.round((Number(eta.distanceKm) + Number(secondLeg.distanceKm)) * 10) / 10
    : null);
  return { originAddress, destinationAddress, originCoordinates, eta, secondLeg, fullRoute, estimatedTotalKm };
}

'''
s = replace_between(s, 'async function estimateQuoteRoute', 'async function handleAvailabilityRuntime', new_estimate, 'estimateQuoteRoute')

old_call = "route = await estimateQuoteRoute(msg.from, readableText, facts, incomingLocation, pendingRouteContext(context.recentCall)).catch(() => ({ eta: null }));"
new_call = "route = await estimateQuoteRoute(msg.from, readableText, facts, incomingLocation, pendingRouteContext(context.recentCall), { fast: true }).catch(() => ({ eta: null }));"
if s.count(old_call) != 1:
    raise SystemExit(f'availability fast call: encontrado {s.count(old_call)}')
s = s.replace(old_call, new_call, 1)

old_lines = r'''  const lines = ['Disponível ✅'];
  if (route?.eta?.minutes) lines.push(formatEtaReply(route.eta, false));
  else if (hasOpportunityData) lines.push('Estou atualizando a localização para calcular a previsão.');
'''
new_lines = r'''  const lines = ['Disponível ✅'];
  const etaReply = route?.eta ? formatEtaReply(route.eta, false) : null;
  if (etaReply) lines.push(etaReply);
  else if (hasOpportunityData) lines.push('Previsão temporariamente indisponível. A cotação foi registrada e o sistema continuará tentando atualizar a rota.');
'''
if s.count(old_lines) != 1:
    raise SystemExit(f'availability eta lines: encontrado {s.count(old_lines)}')
s = s.replace(old_lines, new_lines, 1)

s = s.replace("if (route.eta?.minutes) lines.push(formatEtaReply(route.eta, false));", "if (route.eta && formatEtaReply(route.eta, false)) lines.push(formatEtaReply(route.eta, false));")
s = s.replace("if (route.eta?.minutes) lines.push(`Previsão até a origem: ${publicEtaMinutes(route.eta.rawMinutes ?? route.eta.minutes)} min.`);", "if (route.eta && publicEtaMinutes(route.eta.rawMinutes ?? route.eta.minutes)) lines.push(`Previsão até a origem: ${publicEtaMinutes(route.eta.rawMinutes ?? route.eta.minutes)} min.`);")
worker.write_text(s)

simple = Path('tools/simple-operation.mjs')
t = simple.read_text()
old_public = r'''export function publicEtaMinutes(value) {
  const minutes = Math.ceil(Number(value || 0));
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  return Math.min(60, minutes);
}
'''
new_public = r'''export function publicEtaMinutes(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return Math.min(60, Math.max(1, Math.ceil(numeric)));
}
'''
if t.count(old_public) != 1:
    raise SystemExit(f'publicEtaMinutes: encontrado {t.count(old_public)}')
simple.write_text(t.replace(old_public, new_public, 1))
