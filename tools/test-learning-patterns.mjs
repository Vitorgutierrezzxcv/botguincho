import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { inferLearningIntent, parseCommercialDescription } from './learning-engine.mjs';

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
console.log(`OK: ${data.source.count} screenshots consolidados em regressão operacional v${data.version}`);
