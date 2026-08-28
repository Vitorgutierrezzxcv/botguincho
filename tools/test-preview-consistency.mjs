import assert from 'node:assert/strict';
import fs from 'node:fs';
import { extractOperationalFacts } from './operational-knowledge.mjs';

const compactVehicle = extractOperationalFacts('Veículo Gol');
assert.equal(compactVehicle.vehicle, 'Gol');
assert.equal(compactVehicle.vehicleType, 'leve');

const compactCar = extractOperationalFacts('Carro Uno');
assert.equal(compactCar.vehicle, 'Uno');
assert.equal(compactCar.vehicleType, 'leve');

const worker = fs.readFileSync(new URL('./vercel-whatsapp-worker.mjs', import.meta.url), 'utf8');
assert.match(worker, /pendingForIncomingFacts/);
assert.match(worker, /mergedOpportunityFacts/);
assert.match(worker, /vehicleType:\s*facts\?\.vehicleType\s*\|\|\s*call\?\.vehicleType/);
assert.match(worker, /fast:\s*!completeOpportunity/);
assert.match(worker, /Distância até a origem:/);
assert.match(worker, /Percurso estimado do atendimento:/);
assert.match(worker, /Valor estimado:/);
assert.match(worker, /commercialStatus:\s*commercial\.status/);
console.log('PREVIEW_CONSISTENCY_OK');
