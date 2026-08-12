import type { RestrictionCode, ServiceRequest } from './types.js';

const valueAfter = (text: string, label: string): string | undefined => {
  const pattern = new RegExp(`${label}\\s*[:\\-]?\\s*(.+)`, 'i');
  return text.match(pattern)?.[1]?.trim();
};

const multilineBetween = (text: string, start: string, end: string): string | undefined => {
  const pattern = new RegExp(`${start}\\s*[:\\-]?\\s*([\\s\\S]*?)(?=${end}\\s*[:\\-]?)`, 'i');
  return text.match(pattern)?.[1]?.replace(/\n+/g, ' ')?.trim();
};

export function detectRestrictions(text: string): RestrictionCode[] {
  const normalized = text.toLowerCase();
  const restrictions = new Set<RestrictionCode>();

  if (/rua estreita|acesso estreito|caminh[aã]o menor/.test(normalized)) restrictions.add('NARROW_ACCESS');
  if (/altura m[aá]xima|limite de altura|teto baixo/.test(normalized)) restrictions.add('LOW_HEIGHT');
  if (/subsolo|garagem subterr[aâ]nea/.test(normalized)) restrictions.add('UNDERGROUND');
  if (/ve[ií]culo pesado|caminh[aã]o|[ôo]nibus/.test(normalized)) restrictions.add('HEAVY_VEHICLE');
  if (/roda travada|rodas travadas/.test(normalized)) restrictions.add('LOCKED_WHEEL');
  if (/batido|colis[aã]o|sinistrado/.test(normalized)) restrictions.add('DAMAGED_VEHICLE');

  return [...restrictions];
}

export function parseServiceRequest(rawText: string, insurer?: string): ServiceRequest {
  const vehicle = valueAfter(rawText, 'Ve[ií]culo') ?? rawText.match(/(?:dispon[ií]vel\?|bom dia,?\s*dispon[ií]vel\?)\s*\n?([^\n]+)/i)?.[1]?.trim();
  const reason = valueAfter(rawText, 'Motivo');
  const service = valueAfter(rawText, 'Servi[cç]o(?: selecionado)?');

  const origin =
    multilineBetween(rawText, 'Endere[cç]o de Origem', 'Endere[cç]o de Destino') ??
    multilineBetween(rawText, 'Origem', 'Destino') ??
    valueAfter(rawText, 'Origem');

  const destination =
    multilineBetween(rawText, 'Endere[cç]o de Destino', 'ref\.|refer[eê]ncia|$') ??
    multilineBetween(rawText, 'Destino', 'ref\.|refer[eê]ncia|$') ??
    valueAfter(rawText, 'Destino');

  const reference = valueAfter(rawText, 'ref\.|refer[eê]ncia');
  const passengersMatch = rawText.match(/(\d+)\s*(?:acompanha|acompanhante|passageiro)/i);

  return {
    insurer,
    vehicle,
    reason,
    service,
    origin,
    destination,
    reference,
    passengers: passengersMatch ? Number(passengersMatch[1]) : undefined,
    restrictions: detectRestrictions(rawText),
    rawText,
  };
}
