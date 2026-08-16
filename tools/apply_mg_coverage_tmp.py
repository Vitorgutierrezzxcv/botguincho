from pathlib import Path
p=Path('tools/vercel-whatsapp-worker.mjs')
s=p.read_text()

anchor="const BRAZIL_UFS = new Set(Object.values(BRAZIL_STATE_BY_NAME));\n"
block=r'''
const SERVICE_STATE = 'MG';
const RMBH_PRIORITY_CITIES = [
  'Belo Horizonte','Betim','Contagem','Nova Lima','Ribeirão das Neves','Sabará','Santa Luzia',
  'Ibirité','Confins','Lagoa Santa','Vespasiano','Pedro Leopoldo','São José da Lapa','Matozinhos',
  'Sarzedo','Mário Campos','Brumadinho','Igarapé','Juatuba','Mateus Leme','Esmeraldas','Caeté',
  'Nova União','Rio Acima','Raposos','Itaguara','Itatiaiuçu','Florestal','Baldim','Capim Branco',
];
const RMBH_PRIORITY_KEYS = RMBH_PRIORITY_CITIES.map((city) => normalizeForIntent(city));

function explicitBrazilState(value = '') {
  const state = detectBrazilState(value);
  return state || '';
}

function isExplicitlyOutOfCoverage(value = '') {
  const state = explicitBrazilState(value);
  return Boolean(state && state !== SERVICE_STATE);
}

function preferredRmbhCity(value = '') {
  const normalized = normalizeForIntent(value);
  const index = RMBH_PRIORITY_KEYS.findIndex((key) => normalized.includes(key));
  return index >= 0 ? RMBH_PRIORITY_CITIES[index] : '';
}

async function reverseGeocodeState(coordinates) {
  if (!coordinates || !validCoordinates(coordinates.latitude, coordinates.longitude)) return '';
  try {
    const url = new URL('https://nominatim.openstreetmap.org/reverse');
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('lat', String(coordinates.latitude));
    url.searchParams.set('lon', String(coordinates.longitude));
    url.searchParams.set('zoom', '10');
    url.searchParams.set('addressdetails', '1');
    const response = await fetch(url, {
      headers: {
        'user-agent': 'BotGuincho/1.5 (cobertura-MG; https://botguincho.vercel.app/)',
        'accept-language': 'pt-BR,pt;q=0.9',
      },
      signal: AbortSignal.timeout(9000),
    });
    if (!response.ok) return '';
    const data = await response.json();
    const address = data?.address || {};
    return normalizeBrazilState(address.state || String(address['ISO3166-2-lvl4'] || '').split('-').pop() || '');
  } catch (error) {
    logEvent('warning', 'Não foi possível validar UF das coordenadas.', { error: String(error) });
    return '';
  }
}

async function targetWithinServiceArea({ address = null, coordinates = null } = {}) {
  if (address && isExplicitlyOutOfCoverage(address)) return false;
  if (coordinates && validCoordinates(coordinates.latitude, coordinates.longitude)) {
    const state = await reverseGeocodeState(coordinates);
    if (state) return state === SERVICE_STATE;
  }
  return true;
}
'''
if 'const SERVICE_STATE' not in s:
    s=s.replace(anchor,anchor+block,1)

old="""  const parts = parseBrazilAddress(query);
  const expectedLocation = {
    state: parts.state || detectBrazilState(query),
    cities: uniqueQueries([
      parts.city,
      ...looseAddressCandidates(query).map((candidate) => candidate.city),
    ]),
  };"""
new="""  const parts = parseBrazilAddress(query);
  const explicitState = detectBrazilState(query);
  if (explicitState && explicitState !== SERVICE_STATE) {
    logEvent('coverage', `Endereço fora da cobertura: ${query}`, { explicitState });
    return null;
  }
  const priorityCity = preferredRmbhCity(query);
  const expectedLocation = {
    state: explicitState || SERVICE_STATE,
    cities: uniqueQueries([
      priorityCity,
      ...(explicitState ? [parts.city, ...looseAddressCandidates(query).map((candidate) => candidate.city)] : []),
      ...(!explicitState && !priorityCity ? RMBH_PRIORITY_CITIES : []),
    ]),
  };"""
if old not in s: raise SystemExit('expectedLocation anchor missing')
s=s.replace(old,new,1)

# Ensure structured search defaults MG when no state.
s=s.replace("state: parts.state || undefined,","state: parts.state || SERVICE_STATE,",1)

# Add coverage checks in standalone handler.
old2="""  const targetAddress = extractStandaloneAddressTarget(readableText);
  if (!targetAddress) return false;

  const tracker = await getFreshTrackerReading();"""
new2="""  const targetAddress = extractStandaloneAddressTarget(readableText);
  if (!targetAddress) return false;

  if (isExplicitlyOutOfCoverage(targetAddress)) {
    await replyAndRemember(msg, groupName, readableText, 'Fora da área de atendimento. Atendemos somente Minas Gerais.', {
      intent: 'out-of-coverage',
      targetAddress,
    });
    return true;
  }

  const directCoordinates = coordinatesFromText(targetAddress) || (extractMapsUrl(targetAddress) ? await coordinatesFromMapsUrl(targetAddress) : null);
  if (directCoordinates && !(await targetWithinServiceArea({ coordinates: directCoordinates }))) {
    await replyAndRemember(msg, groupName, readableText, 'Fora da área de atendimento. Atendemos somente Minas Gerais.', {
      intent: 'out-of-coverage-coordinates',
      targetAddress,
    });
    return true;
  }

  const tracker = await getFreshTrackerReading();"""
if old2 not in s: raise SystemExit('standalone anchor missing')
s=s.replace(old2,new2,1)

# Coverage checks for ETA and distance explicit targets.
eta_anchor="""  if (!target.targetAddress && !target.targetCoordinates) {
    logEvent('ignored', `${groupName}: pergunta de ETA sem destino identificável ignorada.`, { groupId: msg.from });
    return;
  }

  let eta = null;"""
eta_new="""  if (!target.targetAddress && !target.targetCoordinates) {
    logEvent('ignored', `${groupName}: pergunta de ETA sem destino identificável ignorada.`, { groupId: msg.from });
    return;
  }
  if (!(await targetWithinServiceArea({ address: target.targetAddress, coordinates: target.targetCoordinates }))) {
    await replyAndRemember(msg, groupName, readableText, 'Fora da área de atendimento. Atendemos somente Minas Gerais.', { intent: 'out-of-coverage', targetSource: target.source });
    return;
  }

  let eta = null;"""
if eta_anchor not in s: raise SystemExit('eta anchor missing')
s=s.replace(eta_anchor,eta_new,1)

dist_anchor="""  if (!target.targetAddress && !target.targetCoordinates) {
    logEvent('ignored', `${groupName}: pergunta de distância sem destino identificável ignorada.`, { groupId: msg.from });
    return;
  }

  let eta = null;"""
dist_new="""  if (!target.targetAddress && !target.targetCoordinates) {
    logEvent('ignored', `${groupName}: pergunta de distância sem destino identificável ignorada.`, { groupId: msg.from });
    return;
  }
  if (!(await targetWithinServiceArea({ address: target.targetAddress, coordinates: target.targetCoordinates }))) {
    await replyAndRemember(msg, groupName, readableText, 'Fora da área de atendimento. Atendemos somente Minas Gerais.', { intent: 'out-of-coverage', targetSource: target.source });
    return;
  }

  let eta = null;"""
if dist_anchor not in s: raise SystemExit('distance anchor missing')
s=s.replace(dist_anchor,dist_new,1)

# Dispatch origin outside coverage: do not confirm falsely.
disp_anchor="""  const originAddress = extractLabeledField(readableText, 'Origem');
  const destinationAddress = extractLabeledField(readableText, 'Destino');
  const shared = await getRecentSharedLocation(msg.from);"""
disp_new="""  const originAddress = extractLabeledField(readableText, 'Origem');
  const destinationAddress = extractLabeledField(readableText, 'Destino');
  if (originAddress && isExplicitlyOutOfCoverage(originAddress)) {
    await replyAndRemember(msg, groupName, readableText, 'Fora da área de atendimento. Atendemos somente Minas Gerais.', { intent: 'dispatch-out-of-coverage', originAddress });
    return;
  }
  const shared = await getRecentSharedLocation(msg.from);"""
if disp_anchor not in s: raise SystemExit('dispatch anchor missing')
s=s.replace(disp_anchor,disp_new,1)

p.write_text(s)
print('MG coverage patch applied')
