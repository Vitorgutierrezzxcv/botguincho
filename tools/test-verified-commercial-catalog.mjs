import assert from 'node:assert/strict';
import { verifiedCommercialResolution } from './verified-commercial-catalog.mjs';

const top = verifiedCommercialResolution('AMERICA GUINCHO - BETIM MG F15 X TOP BRASIL');
assert.equal(top.rules.services.leve.basePrice, 135);
assert.equal(top.rules.services.leve.includedKm, 40);
assert.equal(top.rules.services.leve.pricePerKm, 3);
assert.equal(top.rules.services.utilitario.basePrice, 160);

const plus = verifiedCommercialResolution('América Guincho X Plus Assistência', {
  detected: true,
  services: {
    leve: { basePrice: 130, includedKm: 40, pricePerKm: 3, dirtRoadPricePerKm: 3.5 },
    utilitario: { basePrice: 170, includedKm: 40, pricePerKm: 3.2, dirtRoadPricePerKm: 3.8 },
  },
  workedHour: 80,
  stoppedHour: 80,
});
assert.equal(plus.rules.services.utilitario.basePrice, 170);
assert.equal(plus.rules.services.leve.dirtRoadPricePerKm, 3.5);

const ats = verifiedCommercialResolution('AMERICA GUINCHO/ SOCORRE ASSISTÊNCIA', null, 'ATS CLUBE DE BENEFÍCIOS - SOCORRE ASSISTÊNCIA 24H');
assert.equal(ats.rules.services.leve.basePrice, 120);
assert.equal(ats.associationOverride.key, 'ats');

const company = verifiedCommercialResolution('America Guincho/ Contagem/Betim MG X Company Truck');
assert.equal(company.rules.invoiceFee, 20);

const power = verifiedCommercialResolution('PREST. AMERICA GUINCHOS X POWER - BETIM');
assert.equal(power.rules.services.leve.basePrice, 135);
assert.equal(power.rules.services.utilitario, undefined);
assert.equal(power.displayOnly[0].basePrice, 170);

console.log('verified commercial catalog: ok');
