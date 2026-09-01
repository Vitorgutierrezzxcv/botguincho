function norm(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normPlate(value = '') {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function tokens(value = '') {
  const ignored = new Set(['rua','r','avenida','av','numero','n','bairro','cidade','estado','mg','brasil','ref','referencia','de','da','do','das','dos']);
  return new Set(norm(value).split(' ').filter((token) => token.length >= 2 && !ignored.has(token)));
}

function similarity(a = '', b = '') {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return null;
  if (na === nb || na.includes(nb) || nb.includes(na)) return 1;
  const aa = tokens(a);
  const bb = tokens(b);
  if (!aa.size || !bb.size) return 0;
  let common = 0;
  for (const token of aa) if (bb.has(token)) common += 1;
  return common / Math.min(aa.size, bb.size);
}

function sameAddress(a = '', b = '') {
  const score = similarity(a, b);
  return score !== null && score >= 0.55;
}

function sameVehicle(a = '', b = '') {
  const score = similarity(a, b);
  return score !== null && score >= 0.45;
}

export function protocolHasStrongIdentity(identity = {}) {
  return Boolean(
    normPlate(identity.plate)
    || (norm(identity.origin) && norm(identity.destination))
    || (norm(identity.protocol) && (norm(identity.origin) || norm(identity.destination)))
  );
}

export function protocolIdentityMatchesCall(call = {}, identity = {}) {
  if (!call || call.deletedAt) return false;

  const incomingProtocol = norm(identity.protocol);
  const callProtocol = norm(call.protocol);
  if (incomingProtocol && callProtocol) {
    if (incomingProtocol === callProtocol) return true;
    return false;
  }

  const incomingPlate = normPlate(identity.plate);
  const callPlate = normPlate(call.plate);
  // Placa e o identificador mais forte: se ambas existem, decide sozinha.
  if (incomingPlate && callPlate) return incomingPlate === callPlate;

  const originComparable = Boolean(norm(identity.origin) && norm(call.origin));
  const destinationComparable = Boolean(norm(identity.destination) && norm(call.destination));
  const originMatch = originComparable ? sameAddress(identity.origin, call.origin) : false;
  const destinationMatch = destinationComparable ? sameAddress(identity.destination, call.destination) : false;

  // Se temos os dois enderecos dos dois lados, os dois precisam apontar para o mesmo atendimento.
  if (originComparable && destinationComparable) return originMatch && destinationMatch;

  // Um endereco coincidente + veiculo coincidente e evidencia suficiente quando a outra ponta ainda nao existia.
  const vehicleComparable = Boolean(norm(identity.vehicle) && norm(call.vehicle));
  const vehicleMatch = vehicleComparable ? sameVehicle(identity.vehicle, call.vehicle) : false;
  if ((originMatch || destinationMatch) && vehicleMatch) return true;

  return false;
}

export function selectProtocolTargetCall({ calls = [], groupId = '', identity = {}, fallbackCall = null } = {}) {
  if (!protocolHasStrongIdentity(identity)) return fallbackCall || null;

  const candidates = (Array.isArray(calls) ? calls : [])
    .filter((call) => call && !call.deletedAt && call.sourceGroupId === groupId)
    .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime());

  return candidates.find((call) => protocolIdentityMatchesCall(call, identity)) || null;
}
