import assert from 'node:assert/strict';
import { matchHistoricalTrainingIntent, historicalTrainingStats } from './training-runtime-index.mjs';

const stats = historicalTrainingStats();
assert.equal(stats.groups, 10);
assert.equal(stats.cataloguedMessages, 16308);
assert.equal(stats.screenshots, 184);
assert.ok(stats.lexicalPatterns >= 100);

assert.equal(matchHistoricalTrainingIntent('Conseguem esse?', 'América Guincho X Plus Assistência')?.intent, 'availability');
assert.equal(matchHistoricalTrainingIntent('PREVIA?', 'América Guincho X Plus Assistência')?.intent, 'eta');
assert.equal(matchHistoricalTrainingIntent('Seguir?', 'América Guincho X Plus Assistência')?.intent, 'authorization');
assert.equal(matchHistoricalTrainingIntent('pessoal pode deixar, conseguiu resolver lá', 'América Guincho X Plus Assistência')?.intent, 'cancellation');
assert.equal(matchHistoricalTrainingIntent('confere fechamento?', 'América Guincho X Plus Assistência')?.intent, 'closure');
assert.equal(matchHistoricalTrainingIntent('bora', 'AMERICA GUINCHO - BETIM MG F15 X TOP BRASIL')?.intent, 'authorization');
assert.notEqual(matchHistoricalTrainingIntent('bora', 'Tests guincho')?.intent, 'authorization');
assert.notEqual(matchHistoricalTrainingIntent('Seguir?', 'Grupo da família')?.intent, 'authorization');
assert.equal(matchHistoricalTrainingIntent('reunião de marketing amanhã', 'América Guincho X Plus Assistência'), null);
console.log('TRAINING_RUNTIME_INDEX_OK', stats);
