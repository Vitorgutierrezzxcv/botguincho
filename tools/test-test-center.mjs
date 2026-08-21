import assert from 'node:assert/strict';
import { TEST_SCENARIOS, TEST_SUITE_VERSION, createTestRun, currentTestHistory, isTestCall, isTestGroupName, responseMatches, summarizeTestRun } from './test-center.mjs';

assert(TEST_SCENARIOS.length >= 15);
assert(responseMatches('Confirmado. Cancelamento sem cobrança em até 15 minutos.', ['15']));
assert(responseMatches('LOCALIZAÇÃO necessária', ['localizacao']));
assert(!responseMatches('Mensagem sem relação', ['confirmado', 'disponível']));
assert(!responseMatches('Indisponível no momento.', ['disponível'], ['indisponível']));
assert(TEST_SCENARIOS.find((item) => item.id === 'arrival').steps.length >= 3);
assert(isTestGroupName('Tests guincho'));
assert(isTestGroupName('  TESTS GUINCHO '));
assert(isTestCall({ insurer: 'Tests guincho', status: 'autorizado' }));

const run = createTestRun(['availability', 'cancel_after_15']);
assert.equal(run.results.length, 2);
assert.equal(run.suiteVersion, TEST_SUITE_VERSION);
assert.deepEqual(currentTestHistory([{ id: 'old' }, run]), [run]);
run.results[0].status = 'passed';
run.results[1].status = 'failed';
assert.deepEqual(summarizeTestRun(run), { scenarios: 2, passed: 1, failed: 1, skipped: 0, running: 0 });

console.log('TEST_CENTER_OK');
