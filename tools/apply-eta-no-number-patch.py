from pathlib import Path

p = Path('tools/vercel-whatsapp-worker.mjs')
s = p.read_text()

def once(old, new, label):
    global s
    count = s.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 match, got {count}')
    s = s.replace(old, new, 1)

once(
    "import { historicalTrainingStats } from './training-runtime-index.mjs';\n",
    "import { historicalTrainingStats } from './training-runtime-index.mjs';\nimport { normalizeAddressInput } from './address-normalization.mjs';\n",
    'address import',
)

once(
"""function cleanAddressQuery(value = '') {
  return String(value)
    // Remove apenas formatacao/rótulos administrativos da ficha; preserva o endereco.
    .replace(/[*_~`]/g, '')
    .replace(/\\b(?:BAIRRO|CIDADE|ESTADO|PA[IÍ]S|PAS)\\s*:\\s*/gi, '')
    .replace(/\\bref\\.?\\s*:.*$/i, '')
    .replace(/\\bn[º°]\\s*/gi, '')
    .replace(/[?]+$/g, '')
    .replace(/\\s+/g, ' ')
    .replace(/\\s+[–—-]\\s+/g, ' - ')
    .trim();
}""",
"""function cleanAddressQuery(value = '') {
  return normalizeAddressInput(value);
}""",
    'cleanAddressQuery',
)

once(
"""  for (const variant of buildLookupVariants(query)) {
    const found = await photonLookup(variant, expectedLocation);
    if (found) return save(found, 'photon-fallback');
  }

  logEvent('warning', 'Endereco nao geocodificado apos todos os fallbacks.', { query, parts });""",
"""  for (const variant of buildLookupVariants(query)) {
    const found = await photonLookup(variant, expectedLocation);
    if (found) return save(found, 'photon-fallback');
  }

  // Fichas de assistência frequentemente chegam sem número (\"nº -\", \"s/n\").
  // Se o logradouro exato não existir no geocoder, usa o bairro informado para
  // entregar uma PREVIA APROXIMADA em vez de omitir o ETA por completo.
  if (parts.district && parts.city) {
    const areaQuery = [parts.district, `${parts.city} - ${parts.state || configuredServiceState}`, 'Brasil'].filter(Boolean).join(', ');
    const expectedArea = { city: parts.city, state: parts.state || configuredServiceState };
    let area = await nominatimLookup({ q: areaQuery }, expectedArea).catch(() => null);
    if (!area) area = await photonLookup(areaQuery, expectedArea);
    if (area) return save({ ...area, approximate: true, approximateLevel: 'district' }, 'district-fallback');
  }

  logEvent('warning', 'Endereco nao geocodificado apos todos os fallbacks.', { query, parts });""",
    'district fallback',
)

once(
"""  return {
    ...route,
    trackerAddress: reading.address || null,
    trackerPlate: reading.plate || null,
    targetAddress: targetAddress || null,
  };""",
"""  return {
    ...route,
    trackerAddress: reading.address || null,
    trackerPlate: reading.plate || null,
    targetAddress: targetAddress || null,
    approximate: Boolean(destination?.approximate),
    approximateLevel: destination?.approximateLevel || null,
  };""",
    'eta approximate propagation',
)

once(
"""    origin: { address: originAddress || origin.displayName || '', latitude: origin.latitude, longitude: origin.longitude },
    destination: { address: destinationAddress, latitude: destination.latitude, longitude: destination.longitude },""",
"""    origin: { address: originAddress || origin.displayName || '', latitude: origin.latitude, longitude: origin.longitude, approximate: Boolean(origin.approximate), approximateLevel: origin.approximateLevel || null },
    destination: { address: destinationAddress, latitude: destination.latitude, longitude: destination.longitude, approximate: Boolean(destination.approximate), approximateLevel: destination.approximateLevel || null },""",
    'full route approximate propagation',
)

once(
"""      eta = {
        minutes: fullRoute.legToOrigin?.minutes ?? null,
        rawMinutes: fullRoute.legToOrigin?.minutes ?? null,
        distanceKm: fullRoute.legToOrigin?.km ?? null,""",
"""      eta = {
        minutes: fullRoute.legToOrigin?.minutes ?? null,
        rawMinutes: fullRoute.legToOrigin?.minutes ?? null,
        distanceKm: fullRoute.legToOrigin?.km ?? null,
        approximate: Boolean(fullRoute.origin?.approximate),
        approximateLevel: fullRoute.origin?.approximateLevel || null,""",
    'quote eta approximate propagation',
)

once(
    "  const etaLine = `Previsão de chegada: ${minutes} min.`;",
    "  const etaLine = `${eta?.approximate ? 'Previsão aproximada de chegada' : 'Previsão de chegada'}: ${minutes} min.`;",
    'eta wording',
)

p.write_text(s)
