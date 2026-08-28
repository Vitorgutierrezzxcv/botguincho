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
assert.doesNotMatch(worker, /Estou atualizando a localização para calcular a previsão\./);
console.log('FAST_ETA_OK');
