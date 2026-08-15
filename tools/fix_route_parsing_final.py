from pathlib import Path

path = Path('tools/vercel-whatsapp-worker.mjs')
s = path.read_text()

helper_anchor = 'async function geocodeAddress(address) {'
if 'function normalizeAddressForLookup(' not in s:
    helpers = r'''
function stripRouteQuestionFragments(value = '') {
  let text = String(value || '')
    .replace(/\r/g, ' ')
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const patterns = [
    /\b(?:qual|quanto)\s+(?:e|é\s+)?(?:o\s+|a\s+)?(?:tempo(?:\s+de\s+dist[aâ]ncia)?|dist[aâ]ncia|previs[aã]o(?:\s+de\s+chegada)?)\s*\??/gi,
    /\b(?:qual\s+seria\s+)?(?:o\s+)?tempo\s+(?:at[eé]|para|pra)\s+chegar(?:\s+(?:no|ao)\s+cliente)?\s*\??/gi,
    /\bquanto\s+tempo\s+(?:at[eé]|para|pra)\s+chegar(?:\s+(?:no|ao)\s+cliente)?\s*\??/gi,
    /\bquanto\s+demora(?:\s+(?:at[eé]|para|pra)\s+chegar)?\s*\??/gi,
    /\b(?:eta|previs[aã]o\s+de\s+chegada)\s*[:?]\s*/gi,
  ];
  for (const pattern of patterns) text = text.replace(pattern, ' ');
  return text
    .replace(/\s*[,;|]+\s*$/g, '')
    .replace(/^\s*[,;|]+\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectBrazilState(value = '') {
  const normalized = normalizeForIntent(value);
  for (const [name, uf] of Object.entries(BRAZIL_STATE_BY_NAME)) {
    if (normalized === name || normalized.includes(` ${name} `) || normalized.endsWith(` ${name}`) || normalized.startsWith(`${name} `)) return uf;
  }
  const ufMatch = String(value || '').toUpperCase().match(/(?:^|[^A-Z])([A-Z]{2})(?:[^A-Z]|$)/);
  return ufMatch && BRAZIL_UFS.has(ufMatch[1]) ? ufMatch[1] : '';
}

function normalizeAddressForLookup(value = '') {
  let query = stripRouteQuestionFragments(value);
  query = cleanAddressQuery(query)
    .replace(/\b(?:n[uú]mero|numero|nro\.?|num\.?|n[º°])\s*[:#-]?\s*(\d{1,6}[A-Za-z]?)/gi, '$1')
    .replace(/\bbrasil\b(?:\s*,?\s*\bbrasil\b)+/gi, 'Brasil')
    .replace(/\s*,\s*/g, ', ')
    .replace(/,{2,}/g, ',')
    .replace(/\s+/g, ' ')
    .trim();
  return query;
}

function looseAddressCandidates(value = '') {
  const query = normalizeAddressForLookup(value);
  const state = detectBrazilState(query);
  const pieces = query
    .replace(/\bBrasil\b/gi, '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (!state || !pieces.length) return [];

  const street = pieces[0] || '';
  let number = '';
  if (pieces[1] && /^\d{1,6}[A-Za-z]?$/.test(pieces[1])) number = pieces[1];

  let beforeState = '';
  for (let i = pieces.length - 1; i >= 0; i -= 1) {
    if (detectBrazilState(pieces[i])) {
      beforeState = pieces[i - 1] || '';
      break;
    }
  }
  if (!beforeState && pieces.length >= 2) beforeState = pieces.at(-2) || '';

  const words = beforeState.split(/\s+/).filter(Boolean);
  const cities = [];
  for (let size = 1; size <= Math.min(4, words.length); size += 1) cities.push(words.slice(-size).join(' '));
  return uniqueQueries(cities).map((city) => ({ street, number, city, state }));
}

function buildLookupVariants(value = '') {
  const query = normalizeAddressForLookup(value);
  const state = detectBrazilState(query);
  const variants = [query, `${query}, Brasil`];
  const pieces = query.replace(/\bBrasil\b/gi, '').split(',').map((x) => x.trim()).filter(Boolean);
  if (state && pieces.length >= 2) {
    const street = pieces[0];
    const number = pieces[1] && /^\d{1,6}[A-Za-z]?$/.test(pieces[1]) ? pieces[1] : '';
    for (const candidate of looseAddressCandidates(query)) {
      variants.push([street, number, candidate.city, state, 'Brasil'].filter(Boolean).join(', '));
      variants.push([street, candidate.city, state, 'Brasil'].filter(Boolean).join(', '));
    }
  }
  return uniqueQueries(variants);
}

async function photonLookup(query) {
  try {
    const url = new URL('https://photon.komoot.io/api/');
    url.searchParams.set('q', query);
    url.searchParams.set('limit', '5');
    url.searchParams.set('lang', 'pt');
    const response = await fetch(url, {
      headers: { 'user-agent': 'BotGuincho/1.3 (+https://botguincho.vercel.app/)' },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return null;
    const data = await response.json();
    const features = Array.isArray(data?.features) ? data.features : [];
    for (const feature of features) {
      const coords = feature?.geometry?.coordinates;
      if (!Array.isArray(coords) || coords.length < 2) continue;
      const countryCode = String(feature?.properties?.countrycode || '').toUpperCase();
      if (countryCode && countryCode !== 'BR') continue;
      if (!validCoordinates(coords[1], coords[0])) continue;
      return {
        latitude: Number(coords[1]),
        longitude: Number(coords[0]),
        displayName: [feature?.properties?.name, feature?.properties?.street, feature?.properties?.city, feature?.properties?.state].filter(Boolean).join(', '),
      };
    }
  } catch (error) {
    logEvent('warning', 'Photon geocoder falhou.', { error: String(error), query });
  }
  return null;
}

'''
    s = s.replace(helper_anchor, helpers + helper_anchor)

start = s.index('async function geocodeAddress(address) {')
old_query = "  const query = cleanAddressQuery(address);"
if old_query in s[start:]:
    pos = s.index(old_query, start)
    s = s[:pos] + "  const query = normalizeAddressForLookup(address);" + s[pos + len(old_query):]

old_variants = """  const variants = uniqueQueries([\n    query,\n    `${query}, Brasil`,\n    [parts.street, parts.number, parts.district, cityState, parts.cep, 'Brasil'].filter(Boolean).join(', '),\n    [parts.street, parts.number, cityState, 'Brasil'].filter(Boolean).join(', '),\n    [parts.street, parts.district, cityState, 'Brasil'].filter(Boolean).join(', '),\n    [parts.street, cityState, 'Brasil'].filter(Boolean).join(', '),\n  ]);"""
new_variants = """  const variants = uniqueQueries([\n    ...buildLookupVariants(query),\n    [parts.street, parts.number, parts.district, cityState, parts.cep, 'Brasil'].filter(Boolean).join(', '),\n    [parts.street, parts.number, cityState, 'Brasil'].filter(Boolean).join(', '),\n    [parts.street, parts.district, cityState, 'Brasil'].filter(Boolean).join(', '),\n    [parts.street, cityState, 'Brasil'].filter(Boolean).join(', '),\n  ]);"""
if old_variants in s:
    s = s.replace(old_variants, new_variants, 1)

warning = "  logEvent('warning', 'Endereco nao geocodificado apos todos os fallbacks.', { query, parts });"
if 'viacep-loose+nominatim' not in s:
    fallback = r'''  for (const loose of looseAddressCandidates(query)) {
    const cepItem = await findCepByAddress({ street: loose.street, number: loose.number, district: '', city: loose.city, state: loose.state }).catch(() => null);
    if (!cepItem?.cep) continue;
    const variant = [cepItem.logradouro || loose.street, loose.number, cepItem.bairro, `${cepItem.localidade} - ${cepItem.uf}`, cepItem.cep, 'Brasil'].filter(Boolean).join(', ');
    const found = await nominatimLookup({ q: variant }).catch(() => null);
    if (found) return save(found, 'viacep-loose+nominatim');
  }

  for (const variant of buildLookupVariants(query)) {
    const found = await photonLookup(variant);
    if (found) return save(found, 'photon-fallback');
  }

'''
    if warning not in s:
        raise SystemExit('warning anchor not found')
    s = s.replace(warning, fallback + warning, 1)

pstart = s.index("function extractInlineRouteTarget(text = '') {")
pend = s.index('async function resolveRouteQuestionTarget', pstart)
parser = r'''function extractInlineRouteTarget(text = '') {
  const raw = String(text || '').replace(/\r/g, ' ').replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!raw) return null;

  const mapsUrl = extractMapsUrl(raw);
  if (mapsUrl) return mapsUrl;
  const directCoordinates = coordinatesFromText(raw);
  if (directCoordinates) return `${directCoordinates.latitude},${directCoordinates.longitude}`;

  const labeled = raw.match(/(?:^|\b)(?:origem|endereco|endereço|local|localizacao|localização|local do cliente|endereco do cliente|endereço do cliente|cliente)\s*[:=\-–—]\s*(.+)$/i);
  if (labeled?.[1]) {
    const labeledCandidate = normalizeAddressForLookup(labeled[1]);
    if (looksLikeAddressCandidate(labeledCandidate)) return labeledCandidate;
  }

  const withoutQuestion = normalizeAddressForLookup(raw);
  if (looksLikeAddressCandidate(withoutQuestion)) return withoutQuestion;

  const embedded = withoutQuestion.match(/\b(?:rua|r\.?|avenida|av\.?|alameda|travessa|estrada|rodovia|rod\.?|br-?\d+|mg-?\d+|praca|praça|largo|via|marginal|fazenda|sitio|sítio|condominio|condomínio|loteamento|bairro)\b.+$/i);
  if (embedded?.[0]) {
    const candidate = normalizeAddressForLookup(embedded[0]);
    if (looksLikeAddressCandidate(candidate)) return candidate;
  }
  return null;
}

'''
s = s[:pstart] + parser + s[pend:]

old_state = """  if (explicitAddress) {\n    state = await setDispatchState(groupId, {\n      originAddress: explicitAddress,\n      originCoordinates: null,\n      originUpdatedAt: new Date().toISOString(),\n    });\n  } else if (sharedIsNewer) {"""
new_state = """  if (explicitAddress) {\n    // Nao persiste ainda: evita contaminar o grupo com endereco invalido.\n  } else if (sharedIsNewer) {"""
if old_state in s:
    s = s.replace(old_state, new_state, 1)

marker = "  await setDispatchState(msg.from, { lastEta: eta, lastEtaAt: new Date().toISOString() });"
replacement = """  await setDispatchState(msg.from, {\n    lastEta: eta,\n    lastEtaAt: new Date().toISOString(),\n    ...(target.source === 'inline-address' || target.source === 'quoted-address'\n      ? { originAddress: target.targetAddress, originCoordinates: null, originUpdatedAt: new Date().toISOString() }\n      : {}),\n  });"""
s = s.replace(marker, replacement, 2)

old_from = """    if (fromTracker) {\n      if (!toAddress && !toCoordinates) return res.status(400).json({ ok: false, error: 'to_required' });\n      const route = await computeEtaToClient({ targetAddress: toAddress || null, targetCoordinates: toCoordinates });\n      if (!route) return res.status(422).json({ ok: false, error: 'tracker_eta_failed' });\n      return res.json({ ok: true, fromTracker: true, route });\n    }"""
new_from = """    if (fromTracker) {\n      const testMessage = typeof req.body?.message === 'string' ? req.body.message.trim() : '';\n      const testQuotedText = typeof req.body?.quotedText === 'string' ? req.body.quotedText.trim() : '';\n      const inlineTarget = testMessage ? extractInlineRouteTarget(testMessage) : null;\n      const quotedTarget = !inlineTarget && testQuotedText ? extractInlineRouteTarget(testQuotedText) : null;\n      const parsedTarget = inlineTarget || quotedTarget || toAddress || null;\n      const parsedSource = inlineTarget ? 'inline-address' : quotedTarget ? 'quoted-address' : toCoordinates ? 'coordinates' : 'to';\n      if (!parsedTarget && !toCoordinates) return res.status(400).json({ ok: false, error: 'to_required' });\n      const route = await computeEtaToClient({ targetAddress: parsedTarget, targetCoordinates: toCoordinates });\n      if (!route) return res.status(422).json({ ok: false, error: 'tracker_eta_failed', parsedTarget, parsedSource });\n      return res.json({ ok: true, fromTracker: true, parsedTarget, parsedSource, route });\n    }"""
if old_from not in s:
    raise SystemExit('route-test block not found')
s = s.replace(old_from, new_from, 1)

path.write_text(s)
print('patch applied')
