from pathlib import Path
p=Path('tools/vercel-whatsapp-worker.mjs')
s=p.read_text()

anchor="async function handleDistanceQuestion(msg, groupName, readableText, quotedText = '') {\n"
block=r'''function extractStandaloneAddressTarget(text = '') {
  const raw = String(text || '').replace(/\r/g, ' ').replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!raw || raw.length < 5) return null;
  if (looksLikeDispatch(raw) || asksEta(raw) || asksDistance(raw) || asksAvailability(raw) || asksTrackerLocation(raw) || greetingReply(raw)) return null;

  const mapUrl = extractMapsUrl(raw);
  if (mapUrl) return mapUrl;
  const coordinates = coordinatesFromText(raw);
  if (coordinates) return `${coordinates.latitude},${coordinates.longitude}`;
  if (extractCep(raw) && raw.replace(/\D/g, '').length >= 8) return normalizeAddressForLookup(raw);

  const normalized = normalizeForIntent(raw);
  const startsLikeStreet = /^(?:rua|r\.?|avenida|av\.?|alameda|travessa|estrada|rodovia|rod\.?|praca|largo|via|marginal|fazenda|sitio|condominio|loteamento)\b/i.test(normalized);
  const roadCode = /\b(?:br|mg|lmg|sp|rj|pr|sc|rs|go|ba|es|pe|ce)-?\s*\d{2,4}\b/i.test(normalized);
  const hasNumber = /\b(?:n[º°]?\s*)?\d{1,6}[a-z]?\b/i.test(normalized) || /\bs\/?n\b/i.test(normalized) || /\bkm\s*\d+(?:[.,]\d+)?\b/i.test(normalized);
  const hasLocationContext = extractCep(raw)
    || new RegExp(`\\b(?:${[...BRAZIL_UFS].join('|')})\\b`, 'i').test(raw)
    || Object.keys(BRAZIL_STATE_BY_NAME).some((state) => normalized.includes(state));
  const commaCount = (raw.match(/,/g) || []).length;

  if (startsLikeStreet && (raw.length >= 10 || hasNumber || hasLocationContext)) return normalizeAddressForLookup(raw);
  if (roadCode && (hasNumber || hasLocationContext || commaCount >= 1)) return normalizeAddressForLookup(raw);
  if (hasNumber && hasLocationContext && commaCount >= 1) return normalizeAddressForLookup(raw);
  return null;
}

async function handleStandaloneAddress(msg, groupName, readableText) {
  const targetAddress = extractStandaloneAddressTarget(readableText);
  if (!targetAddress) return false;

  const tracker = await getFreshTrackerReading();
  let eta = null;
  try {
    eta = await computeEtaWithRetry({ targetAddress });
  } catch (error) {
    logEvent('warning', 'Não foi possível calcular ETA automático do endereço recebido.', {
      error: String(error),
      targetAddress,
    });
  }

  if (!eta) {
    const reply = tracker
      ? 'Recebi o endereço, mas não consegui calcular a rota com segurança agora. Pode confirmar a cidade/UF?'
      : 'Recebi o endereço. Estou atualizando a localização do guincho para calcular a previsão.';
    await replyAndRemember(msg, groupName, readableText, reply, {
      intent: 'standalone-address-unavailable',
      targetAddress,
    });
    return true;
  }

  await setDispatchState(msg.from, {
    originAddress: targetAddress,
    originCoordinates: null,
    originUpdatedAt: new Date().toISOString(),
    lastEta: eta,
    lastEtaAt: new Date().toISOString(),
  });

  const reply = `Previsão de chegada: ${eta.minutes} min.`;
  await replyAndRemember(msg, groupName, readableText, reply, {
    intent: 'standalone-address-eta',
    etaMinutes: eta.minutes,
    distanceKm: eta.distanceKm,
    targetAddress,
  });
  logEvent('route', `${groupName}: endereço recebido diretamente → ETA ${eta.minutes} min${eta.distanceKm ? ` · ${eta.distanceKm} km` : ''}.`, {
    groupId: msg.from,
    targetAddress,
  });
  return true;
}

'''
if 'async function handleStandaloneAddress' not in s:
    if anchor not in s: raise SystemExit('handler anchor missing')
    s=s.replace(anchor,block+anchor,1)

proc_anchor="""    const greeting = greetingReply(readableText);
    if (greeting) {
      await replyAndRemember(msg, groupName, readableText, greeting, { intent: 'greeting' });
      return;
    }

    if (!isOperationalMessage(readableText)) {"""
proc_new="""    const greeting = greetingReply(readableText);
    if (greeting) {
      await replyAndRemember(msg, groupName, readableText, greeting, { intent: 'greeting' });
      return;
    }

    if (await handleStandaloneAddress(msg, groupName, readableText)) {
      return;
    }

    if (!isOperationalMessage(readableText)) {"""
if proc_anchor in s:
    s=s.replace(proc_anchor,proc_new,1)
elif 'await handleStandaloneAddress(msg, groupName, readableText)' not in s:
    raise SystemExit('process anchor missing')

p.write_text(s)
print('standalone address ETA patch applied')
