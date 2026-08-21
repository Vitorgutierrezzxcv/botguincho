import assert from 'node:assert/strict';
import { TEST_SCENARIOS, createTestRun, isTestCall, isTestGroupName, responseMatches, summarizeTestRun } from './test-center.mjs';

assert(TEST_SCENARIOS.length >= 15);
assert(responseMatches('Confirmado. Cancelamento sem cobrança em até 15 minutos.', ['15']));
assert(responseMatches('LOCALIZAÇÃO necessária', ['localizacao']));
assert(!responseMatches('Mensagem sem relação', ['confirmado', 'disponível']));
assert(isTestGroupName('Tests guincho'));
assert(isTestGroupName('  TESTS GUINCHO '));
assert(isTestCall({ insurer: 'Tests guincho', status: 'autorizado' }));

const run = createTestRun(['availability', 'cancel_after_15']);
assert.equal(run.results.length, 2);
run.results[0].status = 'passed';
run.results[1].status = 'failed';
assert.deepEqual(summarizeTestRun(run), { scenarios: 2, passed: 1, failed: 1, skipped: 0, running: 0 });

console.log('TEST_CENTER_OK');
