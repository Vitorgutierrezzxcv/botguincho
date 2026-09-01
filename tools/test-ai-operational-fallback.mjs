import assert from 'node:assert/strict';
import { shouldUseAiOperationalFallback, mergeAiOperationalInterpretation } from './ai-operational-fallback.mjs';

const messy = `VW - Volkswagen / Gol\nMotivo: PANE ELÉTRICA / MECÂNICA\nServiço selecionado: REBOQUE LEVE\nOrigem: Alameda das Acácias, nº -, Jardim Recreio Alvorada, BETIM - MG\nDestino: Rua Palmeiras, nº 780, Colonial, CONTAGEM - MG`;

const deterministicFacts = {
  origin: 'Alameda das Acácias, nº -, Jardim Recreio Alvorada, BETIM - MG',
  destination: 'Rua Palmeiras, nº 780, Colonial, CONTAGEM - MG',
  vehicle: 'VW - Volkswagen / Gol',
  vehicleType: 'leve',
  service: 'REBOQUE LEVE',
  protocol: '',
};

assert.equal(shouldUseAiOperationalFallback({ text: messy, facts: deterministicFacts, intent: 'quote' }), true);
assert.equal(shouldUseAiOperationalFallback({ text: 'pode seguir', facts: {}, intent: 'authorization' }), false);
assert.equal(shouldUseAiOperationalFallback({ text: 'cancelado', facts: {}, intent: 'cancellation' }), false);

const merged = mergeAiOperationalInterpretation({
  text: messy,
  facts: deterministicFacts,
  intent: 'quote',
  ai: {
    intent: 'quote',
    origin: 'Alameda das Acácias, Jardim Recreio Alvorada, Betim - MG',
    destination: 'Rua Palmeiras, 780, Colonial, Contagem - MG',
    vehicle: 'Volkswagen Gol',
    vehicleType: 'leve',
    service: 'Reboque leve',
    protocol: '',
    confidence: 0.97,
  },
});

assert.equal(merged.used, true);
assert.match(merged.facts.origin, /Alameda das Acácias/i);
assert.doesNotMatch(merged.facts.origin, /nº\s*-/i);
assert.match(merged.facts.destination, /780/);
assert.equal(merged.facts.vehicle, 'Volkswagen Gol');
assert.equal(merged.facts.vehicleType, 'leve');
assert.equal(merged.intent, 'quote');

const lowConfidence = mergeAiOperationalInterpretation({
  text: messy,
  facts: deterministicFacts,
  intent: 'quote',
  ai: { confidence: 0.5, origin: 'errado' },
});
assert.equal(lowConfidence.used, false);
assert.equal(lowConfidence.facts.origin, deterministicFacts.origin);

const otherIntent = mergeAiOperationalInterpretation({
  text: 'origem rua A destino rua B modelo Gol',
  facts: { origin: '', destination: '', vehicle: '', vehicleType: null },
  intent: 'other',
  ai: {
    intent: 'quote',
    origin: 'Rua A', destination: 'Rua B', vehicle: 'Gol', vehicleType: 'leve', service: '', protocol: '', confidence: 0.95,
  },
});
assert.equal(otherIntent.intent, 'quote');
assert.equal(otherIntent.facts.vehicleType, 'leve');

console.log('AI_OPERATIONAL_FALLBACK_OK');
