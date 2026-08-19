function norm(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function clean(value = '', max = 120) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
}

export function sanitizeExcludedAreas(input = []) {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  const out = [];

  for (const raw of input.slice(0, 150)) {
    if (!raw || typeof raw !== 'object') continue;
    const type = raw.type === 'neighborhood' ? 'neighborhood' : 'city';
    const name = clean(raw.name);
    if (!name) continue;
    const city = type === 'neighborhood' ? clean(raw.city) : '';
    const scope = ['origin', 'destination', 'both'].includes(raw.scope) ? raw.scope : 'origin';
    const key = [type, norm(name), norm(city), scope].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ type, name, city, scope });
  }

  return out;
}

function exactSegmentMatches(address, expected) {
  const key = norm(expected);
  if (!key) return false;
  const segments = String(address || '')
    .replace(/\r/g, ' ')
    .split(/[,;|\n]/)
    .map(norm)
    .filter(Boolean);
  return segments.some((segment) => segment === key || segment === `bairro ${key}` || segment === `cidade ${key}`);
}

function labeledValue(address, label) {
  const raw = String(address || '').replace(/\r/g, ' ');
  const re = new RegExp(`(?:^|[,;|\\n])\\s*${label}\\s*[:=\\-]?\\s*([^,;|\\n]+)`, 'i');
  return clean(raw.match(re)?.[1] || '');
}

function deriveRegion(address = '', parsedAddress = null, region = null) {
  const city = clean(
    region?.city ||
    parsedAddress?.city ||
    labeledValue(address, 'cidade') ||
    ''
  );
  const district = clean(
    region?.district ||
    parsedAddress?.district ||
    labeledValue(address, 'bairro') ||
    ''
  );
  return { city, district };
}

export function matchExcludedArea({ address = '', parsedAddress = null, region = null, areas = [], scope = 'origin' } = {}) {
  const safeAreas = sanitizeExcludedAreas(areas);
  if (!safeAreas.length) return null;
  const resolved = deriveRegion(address, parsedAddress, region);
  const cityKey = norm(resolved.city);
  const districtKey = norm(resolved.district);

  for (const area of safeAreas) {
    if (area.scope !== 'both' && area.scope !== scope) continue;

    if (area.type === 'city') {
      const matched = cityKey
        ? cityKey === norm(area.name)
        : exactSegmentMatches(address, area.name);
      if (matched) return { ...area, matchedBy: cityKey ? 'city' : 'address-segment', scope };
      continue;
    }

    const neighborhoodMatched = districtKey
      ? districtKey === norm(area.name)
      : exactSegmentMatches(address, area.name);
    if (!neighborhoodMatched) continue;

    if (area.city) {
      const requiredCity = norm(area.city);
      const cityMatched = cityKey
        ? cityKey === requiredCity
        : exactSegmentMatches(address, area.city);
      if (!cityMatched) continue;
    }

    return { ...area, matchedBy: districtKey ? 'neighborhood' : 'address-segment', scope };
  }

  return null;
}
