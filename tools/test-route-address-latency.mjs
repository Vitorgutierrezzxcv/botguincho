import assert from 'node:assert/strict';
import fs from 'node:fs';
import { extractLabeledAddressBlock } from './excluded-areas.mjs';
import { normalizeAddressInput } from './address-normalization.mjs';

const proterlink = `ATENDIMENTO PROTERLINK
Protocolo: 2026018344
Placa: HMJ7J14
Modelo/Montadora: FIAT / STRADA 1.4 MPI FIRE FLEX 8V CS
Origem: Rua Wilson Gramiscelli, nº 117, Arvoredo, CONTAGEM - MGref. Mateus - (31)99864-2517
Destino: Avenida das Americas, nº 402, Centro, BETIM - MGref. OFICINA 1 ACOMPANHA
Link do WebPrestador:
https://app.webprestador.com.br/a/abc`;

assert.equal(
  extractLabeledAddressBlock(proterlink, 'Origem'),
  'Rua Wilson Gramiscelli, nº 117, Arvoredo, CONTAGEM - MG',
);
assert.equal(
  extractLabeledAddressBlock(proterlink, 'Destino'),
  'Avenida das Americas, nº 402, Centro, BETIM - MG',
);
assert.equal(
  normalizeAddressInput('Rua Wilson Gramiscelli, nº 117, Arvoredo, CONTAGEM - MGref. Mateus - (31)99864-2517'),
  'Rua Wilson Gramiscelli, 117, Arvoredo, CONTAGEM - MG',
);

const worker = fs.readFileSync(new URL('./vercel-whatsapp-worker.mjs', import.meta.url), 'utf8');
assert.match(worker, /budgetMs[^\n]+fast \? 5000 : 8000/);
assert.match(worker, /timedOut: true/);
assert.match(worker, /O endereço foi recebido corretamente, mas o cálculo da rota excedeu o tempo de resposta/);
assert.match(worker, /normalizeAddressForLookup\(extractLabeledAddressBlock\(readableText, 'Origem'\)/);
console.log('ROUTE_ADDRESS_LATENCY_REGRESSION_OK');
