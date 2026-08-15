const API_BASE = 'https://api.getrak.com';
const TOKEN_URL = `${API_BASE}/newkoauth/oauth/token`;

const tokenCache = new Map();

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizePlate(value) {
  return clean(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function resolveClientCredentials(config = {}) {
  let clientId = clean(config.clientId);
  let clientSecret = clean(config.clientSecret);
  if (clientId && !clientSecret) {
    let decoded = clientId;
    if (!decoded.includes(':')) {
      try { decoded = Buffer.from(clientId, 'base64').toString('utf8').trim(); } catch {}
    }
    if (decoded.includes(':')) {
      const splitAt = decoded.indexOf(':');
      clientId = decoded.slice(0, splitAt).trim();
      clientSecret = decoded.slice(splitAt + 1).trim();
    }
  }
  return { clientId, clientSecret };
}

function configKey(config, grantType) {
  const { clientId } = resolveClientCredentials(config);
  return [grantType, clientId, config.username].map(clean).join('|');
}

export function sanitizeTrackerConfig(config = {}) {
  const { clientId, clientSecret } = resolveClientCredentials(config);
  return {
    provider: 'getrak-webservice',
    configured: Boolean(clientId && clientSecret && clean(config.username) && clean(config.password)),
    clientIdConfigured: Boolean(clean(config.clientId)),
    clientSecretConfigured: Boolean(clientSecret),
    usernameConfigured: Boolean(clean(config.username)),
    passwordConfigured: Boolean(clean(config.password)),
    defaultVehicle: normalizePlate(config.defaultVehicle),
    defaultVehicleId: config.defaultVehicleId ? String(config.defaultVehicleId) : '',
  };
}

export function trackerConfigured(config = {}) {
  return sanitizeTrackerConfig(config).configured;
}

async function readBody(response) {
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

function messageFromBody(body, fallback) {
  if (typeof body === 'string' && body.trim()) return body.trim().slice(0, 600);
  if (body && typeof body === 'object') {
    const value = body.message || body.error_description || body.error || body.detail;
    if (value) return String(value).slice(0, 600);
  }
  return fallback;
}

async function oauthToken(config, grantType = 'password') {
  const key = configKey(config, grantType);
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const { clientId, clientSecret } = resolveClientCredentials(config);
  const username = clean(config.username);
  const password = clean(config.password);

  if (!clientId || !clientSecret) throw new Error('Informe a chave da API Getrak ou o Client ID e Client Secret.');
  if (grantType === 'password' && (!username || !password)) {
    throw new Error('Informe o usuário integrador e a senha do WebService Getrak.');
  }

  const form = new FormData();
  form.set('grant_type', grantType);
  if (grantType === 'password') {
    form.set('username', username);
    form.set('password', password);
  }

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      accept: 'application/json',
    },
    body: form,
    signal: AbortSignal.timeout(20_000),
  });
  const body = await readBody(response);
  if (!response.ok) {
    throw new Error(`Autenticação Getrak falhou (HTTP ${response.status}): ${messageFromBody(body, 'credenciais ou permissão inválidas')}`);
  }

  const token = body?.access_token;
  if (!token) throw new Error('A Getrak autenticou a requisição, mas não retornou access_token.');
  const expiresIn = Number(body?.expires_in || 3600);
  tokenCache.set(key, { token, expiresAt: Date.now() + Math.max(120, expiresIn) * 1000 });
  return token;
}

async function getJson(url, token) {
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  });
  const body = await readBody(response);
  return { response, body };
}

function asArray(body) {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.data)) return body.data;
  if (Array.isArray(body?.items)) return body.items;
  return body && typeof body === 'object' ? [body] : [];
}

function vehicleIdOf(item) {
  return item?.id_veiculo ?? item?.id ?? item?.vehicle_id ?? item?.vehicleId;
}

function plateOf(item) {
  return item?.placa ?? item?.plate ?? item?.vehicle?.plate ?? '';
}

export async function resolveVehicle(config = {}, vehicleRef = {}) {
  const explicitId = clean(vehicleRef.vehicleId || config.defaultVehicleId);
  const plate = normalizePlate(vehicleRef.plate || config.defaultVehicle);
  if (explicitId) return { id: explicitId, plate: plate || undefined, source: 'configured-id' };
  if (!plate) throw new Error('Informe a placa padrão ou o ID do veículo na Getrak.');

  const url = new URL('/v0.1/veiculos/integracao', API_BASE);
  url.searchParams.set('placa', plate);
  url.searchParams.set('limite', '100');

  let token = await oauthToken(config, 'password');
  let result = await getJson(url, token);
  if (result.response.status === 401 || result.response.status === 403) {
    try {
      token = await oauthToken(config, 'client_credentials');
      result = await getJson(url, token);
    } catch {}
  }

  if (!result.response.ok) {
    throw new Error(`Não foi possível localizar a placa ${plate} na Getrak (HTTP ${result.response.status}): ${messageFromBody(result.body, 'sem permissão para listar veículos')}. Se necessário, informe o ID do veículo no painel.`);
  }

  const vehicles = asArray(result.body);
  const found = vehicles.find((item) => normalizePlate(plateOf(item)) === plate) || vehicles[0];
  const id = vehicleIdOf(found);
  if (id === undefined || id === null || id === '') {
    throw new Error(`A Getrak respondeu, mas não retornou o ID do veículo da placa ${plate}. Informe o ID do veículo no painel.`);
  }

  return { id: String(id), plate: normalizePlate(plateOf(found)) || plate, source: 'vehicle-list', raw: found };
}

function normalizeLocation(item, vehicle) {
  const lat = Number(item?.lat ?? item?.latitude);
  const longitude = Number(item?.lon ?? item?.lng ?? item?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(longitude)) return null;
  const speed = Number(item?.velocidade ?? item?.speed ?? item?.speedKph);
  const odometer = Number(item?.odometro ?? item?.hodometro ?? item?.odometer);
  const battery = Number(item?.bateria ?? item?.voltagem_bateria ?? item?.battery ?? item?.batteryVoltage);
  const onlineRaw = item?.status_online ?? item?.online ?? item?.statusOnline;
  return {
    vehicleId: String(vehicle.id),
    plate: normalizePlate(plateOf(item)) || vehicle.plate || '',
    latitude: lat,
    longitude,
    speedKph: Number.isFinite(speed) ? speed : null,
    odometerKm: Number.isFinite(odometer) ? odometer : null,
    batteryVoltage: Number.isFinite(battery) ? battery : null,
    online: onlineRaw === undefined || onlineRaw === null ? null : ['1', 'true', 'online', 'on'].includes(String(onlineRaw).toLowerCase()),
    capturedAt: String(item?.data ?? item?.capturedAt ?? item?.updated_at ?? item?.timestamp ?? '') || null,
    address: String(item?.endereco ?? item?.address ?? item?.localizacao ?? '') || null,
    raw: item,
  };
}

export async function getVehicleLocation(config = {}, vehicleRef = {}) {
  if (!trackerConfigured(config)) throw new Error('Rastreador Getrak ainda não configurado.');
  const vehicle = await resolveVehicle(config, vehicleRef);
  const token = await oauthToken(config, 'password');
  const url = new URL('/v0.1/localizacoes', API_BASE);
  url.searchParams.set('id', vehicle.id);
  const { response, body } = await getJson(url, token);
  if (!response.ok) {
    throw new Error(`Consulta de localização Getrak falhou (HTTP ${response.status}): ${messageFromBody(body, 'não foi possível obter a posição')}`);
  }
  const items = asArray(body);
  const location = items.map((item) => normalizeLocation(item, vehicle)).find(Boolean);
  if (!location) throw new Error(`A Getrak não retornou coordenadas válidas para o veículo ${vehicle.plate || vehicle.id}.`);
  return location;
}

export async function testTracker(config = {}, vehicleRef = {}) {
  const location = await getVehicleLocation(config, vehicleRef);
  return { ok: true, provider: 'Getrak WebService', location };
}
