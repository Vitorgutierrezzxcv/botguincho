import assert from 'node:assert/strict';
import { normalizeAddressInput } from './address-normalization.mjs';

assert.equal(
  normalizeAddressInput('Alameda das Acácias, nº -, Jardim Recreio Alvorada, BETIM - MG'),
  'Alameda das Acácias, Jardim Recreio Alvorada, BETIM - MG'
);
assert.equal(
  normalizeAddressInput('Rua Exemplo, s/n, Bairro Centro, CONTAGEM - MG'),
  'Rua Exemplo, Bairro Centro, CONTAGEM - MG'
);
assert.equal(
  normalizeAddressInput('Rua Exemplo, sem número, Bairro Centro, CONTAGEM - MG'),
  'Rua Exemplo, Bairro Centro, CONTAGEM - MG'
);
assert.equal(
  normalizeAddressInput('Rua Palmeiras, nº 780, Colonial, CONTAGEM - MG'),
  'Rua Palmeiras, 780, Colonial, CONTAGEM - MG'
);

console.log('ADDRESS_NORMALIZATION_OK');
