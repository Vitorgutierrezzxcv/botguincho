from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORKER = ROOT / 'tools/vercel-whatsapp-worker.mjs'
BASE = 'Rua Andre Luiz Pereira, 263, Residencial Lagoa, Betim - MG, CEP 32606-235'

s = WORKER.read_text(encoding='utf-8')

# Garante a base padrão apenas para a operação legada atual, sem afetar novos tenants.
old_settings = """async function getSettings() {\n  const saved = await readJson(settingsFile, {});\n  return { ...DEFAULT_SETTINGS, ...saved };\n}\n"""
new_settings = f"""const LEGACY_AMERICA_BASE_ADDRESS = '{BASE}';\n\nasync function getSettings() {{\n  const saved = await readJson(settingsFile, {{}});\n  const next = {{ ...DEFAULT_SETTINGS, ...saved }};\n  if (clientId === 'cliente-teste' && !String(next.operationalBaseAddress || '').trim()) {{\n    next.operationalBaseAddress = LEGACY_AMERICA_BASE_ADDRESS;\n    await writeJson(settingsFile, next).catch(() => undefined);\n  }}\n  return next;\n}}\n"""
if old_settings in s:
    s = s.replace(old_settings, new_settings, 1)

start_marker = "async function computeFullServiceRoute({ originAddress = null, destinationAddress = null, originCoordinates = null, baseAddressOverride = '' } = {}) {"
end_marker = "\nconst TRACKER_ARRIVAL_RADIUS_KM = 0.25;"
start = s.find(start_marker)
end = s.find(end_marker, start)
if start < 0 or end < 0:
    raise SystemExit('computeFullServiceRoute não encontrado')

new_function = r'''async function computeFullServiceRoute({ originAddress = null, destinationAddress = null, originCoordinates = null, baseAddressOverride = '' } = {}) {
  const settings = await getSettings();
  const baseAddress = String(baseAddressOverride || settings.operationalBaseAddress || '').trim();
  if (!baseAddress || ((!originAddress && !originCoordinates) || !destinationAddress)) return null;

  // REGRA COMERCIAL: Base -> Origem -> Destino -> Base.
  // O rastreador NÃO participa da quilometragem cobrada; ele serve apenas para ETA.
  const reading = await getFreshTrackerReading().catch(() => null);
  const trackerStart = reading ? await trackerCoordinates(reading).catch(() => null) : null;

  const originPromise = originCoordinates && validCoordinates(originCoordinates.latitude, originCoordinates.longitude)
    ? Promise.resolve({ latitude: Number(originCoordinates.latitude), longitude: Number(originCoordinates.longitude), displayName: originAddress || 'Localização compartilhada', approximate: false })
    : geocodeAddress(originAddress);
  const destinationPromise = geocodeAddress(destinationAddress);
  const basePromise = geocodeAddress(baseAddress);
  const [origin, destination, base] = await Promise.all([originPromise, destinationPromise, basePromise]);
  if (!origin || !destination || !base) return null;

  // Para cobrança, não aceita fallback de bairro/cidade: isso pode distorcer dezenas de km.
  if (origin.approximate || destination.approximate || base.approximate) {
    logEvent('safety', 'KM comercial suspenso por geocodificação aproximada.', {
      origin: { address: originAddress, approximate: origin.approximate, level: origin.approximateLevel },
      destination: { address: destinationAddress, approximate: destination.approximate, level: destination.approximateLevel },
      base: { address: baseAddress, approximate: base.approximate, level: base.approximateLevel },
    });
    return null;
  }

  const [baseToOrigin, serviceLeg, returnToBase, trackerToOrigin] = await Promise.all([
    routeBetween(base, origin),
    routeBetween(origin, destination),
    routeBetween(destination, base),
    trackerStart ? routeBetween(trackerStart, origin).catch(() => null) : Promise.resolve(null),
  ]);
  if (!baseToOrigin || !serviceLeg || !returnToBase) return null;

  const totalKm = Math.round((
    Number(baseToOrigin.distanceKm || 0)
    + Number(serviceLeg.distanceKm || 0)
    + Number(returnToBase.distanceKm || 0)
  ) * 10) / 10;
  const totalMinutes = Number(baseToOrigin.minutes || 0) + Number(serviceLeg.minutes || 0) + Number(returnToBase.minutes || 0);

  return {
    capturedAt: new Date().toISOString(),
    basis: 'base_origin_destination_base',
    start: trackerStart ? { address: reading?.address || '', latitude: trackerStart.latitude, longitude: trackerStart.longitude } : null,
    origin: { address: originAddress || origin.displayName || '', latitude: origin.latitude, longitude: origin.longitude, approximate: false, approximateLevel: null },
    destination: { address: destinationAddress, latitude: destination.latitude, longitude: destination.longitude, approximate: false, approximateLevel: null },
    base: { address: baseAddress, latitude: base.latitude, longitude: base.longitude, approximate: false, approximateLevel: null },
    legToOrigin: { km: baseToOrigin.distanceKm, minutes: baseToOrigin.minutes },
    serviceLeg: { km: serviceLeg.distanceKm, minutes: serviceLeg.minutes },
    returnToBase: { km: returnToBase.distanceKm, minutes: returnToBase.minutes },
    trackerToOrigin: trackerToOrigin ? { km: trackerToOrigin.distanceKm, minutes: trackerToOrigin.minutes } : null,
    totalKm,
    totalMinutes,
    routing: 'osrm_with_fallback',
  };
}
'''

s = s[:start] + new_function + s[end:]

# Na resposta ao WhatsApp, ETA/distância até o cliente pode usar o rastreador;
# quilometragem total continua vindo exclusivamente do circuito comercial acima.
s = s.replace("minutes: fullRoute.legToOrigin?.minutes ?? null,", "minutes: fullRoute.trackerToOrigin?.minutes ?? fullRoute.legToOrigin?.minutes ?? null,")
s = s.replace("rawMinutes: fullRoute.legToOrigin?.minutes ?? null,", "rawMinutes: fullRoute.trackerToOrigin?.minutes ?? fullRoute.legToOrigin?.minutes ?? null,")
s = s.replace("distanceKm: fullRoute.legToOrigin?.km ?? null,", "distanceKm: fullRoute.trackerToOrigin?.km ?? fullRoute.legToOrigin?.km ?? null,")

WORKER.write_text(s, encoding='utf-8')
print('Rota comercial corrigida: Base -> Origem -> Destino -> Base; rastreador apenas para ETA.')
