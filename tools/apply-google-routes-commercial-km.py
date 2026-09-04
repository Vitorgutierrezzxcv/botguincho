from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORKER = ROOT / 'tools/vercel-whatsapp-worker.mjs'
s = WORKER.read_text(encoding='utf-8')

needle = """async function computeFullServiceRoute({ originAddress = null, destinationAddress = null, originCoordinates = null, baseAddressOverride = '' } = {}) {\n  const settings = await getSettings();\n  const baseAddress = String(baseAddressOverride || settings.operationalBaseAddress || '').trim();\n  if (!baseAddress || ((!originAddress && !originCoordinates) || !destinationAddress)) return null;\n\n  // REGRA COMERCIAL: Base -> Origem -> Destino -> Base.\n"""

replacement = r"""function googleRoutesDurationMinutes(value = '') {
  const seconds = Number(String(value || '').replace(/s$/, ''));
  return Number.isFinite(seconds) ? Math.max(1, Math.ceil(seconds / 60)) : null;
}

function googleWaypointFrom({ address = null, coordinates = null } = {}) {
  if (coordinates && validCoordinates(coordinates.latitude, coordinates.longitude)) {
    return {
      location: {
        latLng: {
          latitude: Number(coordinates.latitude),
          longitude: Number(coordinates.longitude),
        },
      },
    };
  }
  const clean = String(address || '').trim();
  return clean ? { address: clean } : null;
}

async function computeGoogleFullServiceRoute({ baseAddress, originAddress = null, destinationAddress = null, originCoordinates = null } = {}) {
  const apiKey = String(process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_ROUTES_API_KEY || '').trim();
  if (!apiKey) return null;

  const baseWaypoint = googleWaypointFrom({ address: baseAddress });
  const originWaypoint = googleWaypointFrom({ address: originAddress, coordinates: originCoordinates });
  const destinationWaypoint = googleWaypointFrom({ address: destinationAddress });
  if (!baseWaypoint || !originWaypoint || !destinationWaypoint) return null;

  try {
    const response = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration,routes.legs.distanceMeters,routes.legs.duration',
      },
      body: JSON.stringify({
        origin: baseWaypoint,
        destination: baseWaypoint,
        intermediates: [originWaypoint, destinationWaypoint],
        travelMode: 'DRIVE',
        routingPreference: 'TRAFFIC_UNAWARE',
        computeAlternativeRoutes: false,
        languageCode: 'pt-BR',
        units: 'METRIC',
      }),
      signal: AbortSignal.timeout(7000),
    });

    if (!response.ok) {
      const body = (await response.text().catch(() => '')).slice(0, 400);
      throw new Error(`Google Routes HTTP ${response.status}${body ? `: ${body}` : ''}`);
    }

    const data = await response.json();
    const route = Array.isArray(data?.routes) ? data.routes[0] : null;
    const legs = Array.isArray(route?.legs) ? route.legs : [];
    if (!route || legs.length < 3 || !Number.isFinite(Number(route.distanceMeters))) {
      throw new Error('Google Routes não retornou a rota completa com as três pernas.');
    }

    const km = (meters) => Math.round((Number(meters || 0) / 1000) * 10) / 10;
    const leg = (item) => ({
      km: km(item?.distanceMeters),
      minutes: googleRoutesDurationMinutes(item?.duration),
    });

    return {
      capturedAt: new Date().toISOString(),
      basis: 'base_origin_destination_base',
      start: null,
      origin: { address: originAddress || 'Localização compartilhada', approximate: false, approximateLevel: null },
      destination: { address: destinationAddress, approximate: false, approximateLevel: null },
      base: { address: baseAddress, approximate: false, approximateLevel: null },
      legToOrigin: leg(legs[0]),
      serviceLeg: leg(legs[1]),
      returnToBase: leg(legs[2]),
      trackerToOrigin: null,
      totalKm: km(route.distanceMeters),
      totalMinutes: googleRoutesDurationMinutes(route.duration),
      routing: 'google_routes',
    };
  } catch (error) {
    logEvent('warning', 'Google Routes falhou; usando OSRM como contingência.', { error: String(error) });
    return null;
  }
}

async function computeFullServiceRoute({ originAddress = null, destinationAddress = null, originCoordinates = null, baseAddressOverride = '' } = {}) {
  const settings = await getSettings();
  const baseAddress = String(baseAddressOverride || settings.operationalBaseAddress || '').trim();
  if (!baseAddress || ((!originAddress && !originCoordinates) || !destinationAddress)) return null;

  // O Google Maps é a referência comercial da operação. Quando houver chave,
  // calcula a rota inteira Base -> Origem -> Destino -> Base no mesmo motor do Google.
  const googleRoute = await computeGoogleFullServiceRoute({
    baseAddress,
    originAddress,
    originCoordinates,
    destinationAddress,
  });
  if (googleRoute) return googleRoute;

  // REGRA COMERCIAL: Base -> Origem -> Destino -> Base.
"""

if needle not in s:
    raise SystemExit('computeFullServiceRoute anchor not found')

s = s.replace(needle, replacement, 1)
WORKER.write_text(s, encoding='utf-8')
print('Google Routes commercial KM patch applied.')
