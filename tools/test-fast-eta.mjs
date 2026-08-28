import assert from 'node:assert/strict';
import fs from 'node:fs';
import { publicEtaMinutes } from './simple-operation.mjs';

assert.equal(publicEtaMinutes(null), null);
assert.equal(publicEtaMinutes(undefined), null);
assert.equal(publicEtaMinutes(''), null);
assert.equal(publicEtaMinutes(-1), null);
assert.equal(publicEtaMinutes(0), 1);
assert.equal(publicEtaMinutes(0.1), 1);
assert.equal(publicEtaMinutes(1), 1);
assert.equal(publicEtaMinutes(60), 60);
assert.equal(publicEtaMinutes(90), 60);

const worker = fs.readFileSync(new URL('./vercel-whatsapp-worker.mjs', import.meta.url), 'utf8');
assert.match(worker, /retryDelayMs \?\? 250/);
assert.match(worker, /\{ fast: true \}/);
assert.match(worker, /likelySameOperationalAddress/);
assert.match(worker, /Promise\.all\(\[\s*routeBetween\(start, origin\)/);

const availabilityStart = worker.indexOf('async function handleAvailabilityRuntime');
const availabilityEnd = worker.indexOf('async function handleQuoteRuntime', availabilityStart);
assert.ok(availabilityStart >= 0 && availabilityEnd > availabilityStart, 'Fluxo de disponibilidade não encontrado');
const availabilityFlow = worker.slice(availabilityStart, availabilityEnd);
assert.doesNotMatch(availabilityFlow, /Estou atualizando a localização para calcular a previsão\./);
assert.match(availabilityFlow, /Previsão temporariamente indisponível/);
assert.match(availabilityFlow, /const etaReply = route\?\.eta \? formatEtaReply/);

console.log('FAST_ETA_OK');
