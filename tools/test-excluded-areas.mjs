import assert from 'node:assert/strict';
import { extractLabeledAddressBlock, matchExcludedArea, sanitizeExcludedAreas } from './excluded-areas.mjs';

const areas = sanitizeExcludedAreas([
  { type: 'city', name: 'Juatuba', scope: 'origin' },
  { type: 'neighborhood', name: 'Citrolândia', city: 'Betim', scope: 'origin' },
  { type: 'city', name: 'Ibirité', scope: 'destination' },
  { type: 'neighborhood', name: 'Petrolina', city: 'Contagem', scope: 'both' },
  { type: 'neighborhood', name: 'Icaivera', city: 'Betim', scope: 'both' },
]);

assert.equal(areas.length, 5);

assert.equal(matchExcludedArea({
  address: 'Rua A, 10, Centro, Juatuba - MG',
  parsedAddress: { city: 'Juatuba', district: 'Centro' },
  areas,
  scope: 'origin',
})?.name, 'Juatuba');

assert.equal(matchExcludedArea({
  address: 'Rua B, 20, Citrolândia, Betim - MG',
  parsedAddress: { city: 'Betim', district: 'Citrolândia' },
  areas,
  scope: 'origin',
})?.name, 'Citrolândia');

assert.equal(matchExcludedArea({
  address: 'Rua B, 20, Citrolândia, Contagem - MG',
  parsedAddress: { city: 'Contagem', district: 'Citrolândia' },
  areas,
  scope: 'origin',
}), null);

assert.equal(matchExcludedArea({
  address: 'Rua C, 30, Centro, Ibirité - MG',
  parsedAddress: { city: 'Ibirité', district: 'Centro' },
  areas,
  scope: 'origin',
}), null);

assert.equal(matchExcludedArea({
  address: 'Rua C, 30, Centro, Ibirité - MG',
  parsedAddress: { city: 'Ibirité', district: 'Centro' },
  areas,
  scope: 'destination',
})?.name, 'Ibirité');

assert.equal(matchExcludedArea({
  address: 'BAIRRO: Petrolina, CIDADE: Contagem, ESTADO: MG',
  region: { city: 'Contagem', district: 'Petrolina' },
  areas,
  scope: 'destination',
})?.name, 'Petrolina');

assert.equal(matchExcludedArea({
  address: 'Rua Juatuba, 99, Centro, Betim - MG',
  parsedAddress: { city: 'Betim', district: 'Centro' },
  areas,
  scope: 'origin',
}), null, 'nome da cidade em nome de rua não pode bloquear');

const multilineDispatch = `SOLICITAÇÃO DE GUINCHO

VEÍCULO: FIAT UNO 2015
PLACA: PXX1A23

ORIGEM:
RUA PIRÁ, 80
ICAIVERA
BETIM - MG

DESTINO:
RUA IGNES MARIA, 326
BETIM INDUSTRIAL
BETIM - MG`;

const multilineOrigin = extractLabeledAddressBlock(multilineDispatch, 'Origem');
const multilineDestination = extractLabeledAddressBlock(multilineDispatch, 'Destino');
assert.equal(multilineOrigin, 'RUA PIRÁ, 80, ICAIVERA, BETIM - MG');
assert.equal(multilineDestination, 'RUA IGNES MARIA, 326, BETIM INDUSTRIAL, BETIM - MG');
assert.equal(matchExcludedArea({ address: multilineOrigin, areas, scope: 'origin' })?.name, 'Icaivera');
assert.equal(matchExcludedArea({ address: multilineDestination, areas, scope: 'destination' }), null);

console.log('excluded-areas regression: ok');
