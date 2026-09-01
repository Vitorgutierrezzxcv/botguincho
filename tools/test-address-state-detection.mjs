import assert from 'node:assert/strict';
import { detectBrazilStateFromAddress } from './address-state-detection.mjs';

assert.equal(
  detectBrazilStateFromAddress('Alameda das Acácias, Jardim Recreio Alvorada, BETIM - MG'),
  'MG',
  'Acácias nunca pode ser confundido com AC/Acre',
);
assert.equal(detectBrazilStateFromAddress('Rua das Acácias 10, Betim/MG'), 'MG');
assert.equal(detectBrazilStateFromAddress('Rua X, CIDADE: BETIM, ESTADO: MG, PAIS: BRASIL'), 'MG');
assert.equal(detectBrazilStateFromAddress('Rua X, Betim, Minas Gerais'), 'MG');
assert.equal(detectBrazilStateFromAddress('Rua Acre, 10, Betim - MG'), 'MG');
assert.equal(detectBrazilStateFromAddress('Rua das Acácias, 10, Rio Branco - AC'), 'AC');
assert.equal(detectBrazilStateFromAddress('Alameda das Acácias, Jardim Recreio Alvorada, BETIM'), null);

console.log('ADDRESS_STATE_DETECTION_OK');
