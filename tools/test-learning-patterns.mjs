import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { inferLearningIntent, parseCommercialDescription } from './learning-engine.mjs';
import { inferTrainedIntent, trainedRuntimeStats } from './trained-intent-engine.mjs';

const data = JSON.parse(await fs.readFile(new URL('../training/operational-patterns-v1.json', import.meta.url), 'utf8'));
for (const fixture of data.intentFixtures) assert.equal(inferLearningIntent(fixture.text), fixture.intent, fixture.text);
for (const example of data.commercialExamples) {
  const got = parseCommercialDescription(example.description);
  assert.equal(got.workedHour, example.expected.workedHour);
  assert.equal(got.stoppedHour, example.expected.stoppedHour);
  for (const key of ['leve','moto','utilitario']) {
    for (const field of ['basePrice','includedKm','pricePerKm','dirtRoadPricePerKm']) assert.equal(got.services[key]?.[field], example.expected[key][field], `${example.name} ${key}.${field}`);
  }
}
for (const item of data.closureExamples) {
  const value = item.base + Math.max(0, item.totalKm - item.includedKm) * item.pricePerKm;
  assert.equal(Math.round(value * 100) / 100, item.expected);
}

const trained = trainedRuntimeStats();
assert.equal(trained.loaded, true, 'base histórica não carregou');
assert.ok(trained.patterns >= 10, `poucos padrões históricos: ${trained.patterns}`);
assert.ok(trained.groups >= 10, `esperados 10 grupos históricos, encontrados ${trained.groups}`);
assert.equal(trained.cataloguedMessages, 16308);
assert.equal(trained.screenshots, 184);

// Frases que não eram cobertas por todas as regex fixas devem ser reconhecidas pelo corpus.
assert.equal(inferTrainedIntent('Pode retornar'), 'cancellation');
assert.equal(inferTrainedIntent('Associado dispensou'), 'cancellation');
assert.equal(inferTrainedIntent('Disponível? Valor e prévia? Quantos kms totais?'), 'quote');
assert.equal(inferTrainedIntent('Cotação Visão é apenas estimativa (não aprovada)'), 'quote');
assert.equal(inferTrainedIntent('Confere fechamento?'), 'closure');

// O classificador principal continua priorizando suas regras existentes e só cai no treinamento no fallback.
assert.equal(inferLearningIntent('Pode retornar'), 'cancellation');
assert.equal(inferLearningIntent('Associado dispensou'), 'cancellation');
assert.equal(inferLearningIntent('Reunião do financeiro amanhã às 9h'), 'administrative_notice');
assert.equal(inferTrainedIntent('Obrigado pessoal, bom trabalho'), null);

console.log(`OK: ${data.source.count} screenshots base + ${trained.screenshots} screenshots/${trained.cataloguedMessages} mensagens no corpus determinístico`);
