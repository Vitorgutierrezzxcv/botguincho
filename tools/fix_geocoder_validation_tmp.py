from pathlib import Path

p = Path('tools/vercel-whatsapp-worker.mjs')
s = p.read_text()

old_cache = """function geocodeCacheKey(address) {
  return normalizeForIntent(cleanAddressQuery(address));
}"""
new_cache = """function geocodeCacheKey(address) {
  // v3 invalida coordenadas antigas que possam ter sido salvas para uma cidade homonima.
  return `v3:${normalizeForIntent(cleanAddressQuery(address))}`;
}"""
if old_cache not in s:
    raise SystemExit('geocodeCacheKey anchor not found')
s = s.replace(old_cache, new_cache, 1)

old_norm = """    .replace(/\\bbrasil\\b(?:\\s*,?\\s*\\bbrasil\\b)+/gi, 'Brasil')
    .replace(/\\s*,\\s*/g, ', ')"""
new_norm = """    .replace(/\\bbrasil\\b(?:\\s*,?\\s*\\bbrasil\\b)+/gi, 'Brasil')
    .replace(/(?:,\\s*)?\\bBrasil\\b\\s*$/i, '')
    .replace(/\\s*,\\s*/g, ', ')"""
if old_norm not in s:
    raise SystemExit('normalizeAddressForLookup anchor not found')
s = s.replace(old_norm, new_norm, 1)

start = s.index('async function nominatimLookup(params) {')
end = s.index('async function lookupCep(cep) {', start)
new_nom = r'''function geocoderResultMatchesExpected(found, expected = null) {
  if (!expected) return true;
  const expectedState = normalizeBrazilState(expected.state || '');
  const expectedCities = uniqueQueries([
    ...(Array.isArray(expected.cities) ? expected.cities : []),
    expected.city || '',
  ]).map(normalizeForIntent).filter(Boolean);

  const actualState = normalizeBrazilState(found?.state || '');
  const actualCity = normalizeForIntent(found?.city || '');
  const display = normalizeForIntent(found?.displayName || '');

  if (expectedState) {
    if (actualState && actualState !== expectedState) return false;
    if (!actualState) return false;
  }

  if (expectedCities.length) {
    const cityMatches = expectedCities.some((expectedCity) => {
      if (actualCity && (actualCity === expectedCity || actualCity.includes(expectedCity) || expectedCity.includes(actualCity))) return true;
      return display.includes(expectedCity);
    });
    if (!cityMatches) return false;
  }

  return true;
}

async function nominatimLookup(params, expected = null) {
  return scheduleNominatim(async () => {
    const url = new URL('https://nominatim.openstreetmap.org/search');
    for (const [key, value] of Object.entries(params)) {
      if (value) url.searchParams.set(key, String(value));
    }
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('limit', expected ? '5' : '1');
    url.searchParams.set('countrycodes', 'br');
    url.searchParams.set('addressdetails', '1');

    const response = await fetch(url, {
      headers: {
        'user-agent': 'BotGuincho/1.4 (operacao-guincho; https://botguincho.vercel.app/)',
        referer: 'https://botguincho.vercel.app/',
        'accept-language': 'pt-BR,pt;q=0.9',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) throw new Error(`Geocodificação HTTP ${response.status}`);
    const results = await response.json();
    if (!Array.isArray(results)) return null;

    for (const item of results) {
      if (!item || !validCoordinates(item.lat, item.lon)) continue;
      const address = item.address || {};
      const found = {
        latitude: Number(item.lat),
        longitude: Number(item.lon),
        displayName: item.display_name || '',
        postcode: address.postcode || null,
        city: address.city || address.town || address.municipality || address.village || address.county || '',
        state: address.state || String(address['ISO3166-2-lvl4'] || '').split('-').pop() || '',
      };
      if (geocoderResultMatchesExpected(found, expected)) return found;
    }
    return null;
  });
}

'''
s = s[:start] + new_nom + s[end:]

pstart = s.index('async function photonLookup(query) {')
pend = s.index('async function geocodeAddress(address) {', pstart)
new_photon = r'''async function photonLookup(query, expected = null) {
  try {
    const url = new URL('https://photon.komoot.io/api/');
    url.searchParams.set('q', query);
    url.searchParams.set('limit', '5');
    const response = await fetch(url, {
      headers: { 'user-agent': 'BotGuincho/1.4 (+https://botguincho.vercel.app/)' },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return null;
    const data = await response.json();
    const features = Array.isArray(data?.features) ? data.features : [];
    for (const feature of features) {
      const coords = feature?.geometry?.coordinates;
      if (!Array.isArray(coords) || coords.length < 2) continue;
      const properties = feature?.properties || {};
      const countryCode = String(properties.countrycode || '').toUpperCase();
      if (countryCode && countryCode !== 'BR') continue;
      if (!validCoordinates(coords[1], coords[0])) continue;
      const found = {
        latitude: Number(coords[1]),
        longitude: Number(coords[0]),
        displayName: [properties.name, properties.street, properties.district, properties.city, properties.county, properties.state].filter(Boolean).join(', '),
        city: properties.city || properties.town || properties.county || properties.district || '',
        state: properties.state || '',
      };
      if (geocoderResultMatchesExpected(found, expected)) return found;
    }
  } catch (error) {
    logEvent('warning', 'Photon geocoder falhou.', { error: String(error), query });
  }
  return null;
}

'''
s = s[:pstart] + new_photon + s[pend:]

anchor = "  const parts = parseBrazilAddress(query);\n"
replacement = """  const parts = parseBrazilAddress(query);
  const expectedLocation = {
    state: parts.state || detectBrazilState(query),
    cities: uniqueQueries([
      parts.city,
      ...looseAddressCandidates(query).map((candidate) => candidate.city),
    ]),
  };
"""
if anchor not in s:
    raise SystemExit('parts anchor not found')
s = s.replace(anchor, replacement, 1)

s = s.replace(
    "const found = await nominatimLookup({ q: variant }).catch(() => null);",
    "const found = await nominatimLookup({ q: variant }, { city: byCep.localidade, state: byCep.uf }).catch(() => null);",
    1,
)

old_structured = """      country: 'Brasil',
    }).catch((error) => {"""
new_structured = """      country: 'Brasil',
    }, expectedLocation).catch((error) => {"""
if old_structured not in s:
    raise SystemExit('structured anchor not found')
s = s.replace(old_structured, new_structured, 1)

old_free = """    const found = await nominatimLookup({ q: variant }).catch((error) => {
      logEvent('warning', 'Nominatim livre falhou.', { error: String(error), variant });"""
new_free = """    const found = await nominatimLookup({ q: variant }, expectedLocation).catch((error) => {
      logEvent('warning', 'Nominatim livre falhou.', { error: String(error), variant });"""
if old_free not in s:
    raise SystemExit('free nominatim anchor not found')
s = s.replace(old_free, new_free, 1)

old_cep = """    const found = await nominatimLookup({
      q: [cep.logradouro || parts.street, parts.number, cep.bairro, `${cep.localidade} - ${cep.uf}`, cep.cep, 'Brasil'].filter(Boolean).join(', '),
    }).catch(() => null);"""
new_cep = """    const found = await nominatimLookup({
      q: [cep.logradouro || parts.street, parts.number, cep.bairro, `${cep.localidade} - ${cep.uf}`, cep.cep, 'Brasil'].filter(Boolean).join(', '),
    }, { city: cep.localidade, state: cep.uf }).catch(() => null);"""
if old_cep not in s:
    raise SystemExit('via cep anchor not found')
s = s.replace(old_cep, new_cep, 1)

old_loose = "const found = await nominatimLookup({ q: variant }).catch(() => null);"
new_loose = "const found = await nominatimLookup({ q: variant }, { city: cepItem.localidade || loose.city, state: cepItem.uf || loose.state }).catch(() => null);"
if old_loose not in s:
    raise SystemExit('loose nominatim anchor not found')
s = s.replace(old_loose, new_loose, 1)

old_ph = "const found = await photonLookup(variant);"
new_ph = "const found = await photonLookup(variant, expectedLocation);"
if old_ph not in s:
    raise SystemExit('photon call anchor not found')
s = s.replace(old_ph, new_ph, 1)

p.write_text(s)
print('geocoder validation patch applied')
