import assert from 'node:assert/strict';
import { inferTrainedIntent, trainedRuntimeStats } from './trained-intent-engine.mjs';

const stats = trainedRuntimeStats();
assert.equal(stats.loaded, true, 'base treinada não carregou');
assert.ok(stats.patterns >= 10, `poucos padrões carregados: ${stats.patterns}`);
assert.ok(stats.groups >= 10, `esperados 10 grupos, encontrados ${stats.groups}`);
assert.equal(stats.cataloguedMessages, 16308, 'corpus consolidado divergente');
assert.equal(stats.screenshots, 184, 'quantidade de screenshots divergente');

assert.equal(inferTrainedIntent('Pode retornar'), 'cancellation');
assert.equal(inferTrainedIntent('Associado dispensou'), 'cancellation');
assert.equal(inferTrainedIntent('Disponível? Valor e prévia? Quantos kms totais?'), 'quote');
assert.equal(inferTrainedIntent('Cotação Visão é apenas estimativa (não aprovada)'), 'quote');
assert.equal(inferTrainedIntent('Pode seguir'), 'authorization');
assert.equal(inferTrainedIntent('Finalizado'), 'closure');
assert.equal(inferTrainedIntent('Confere fechamento?'), 'closure');

// Segurança: frases administrativas ou aleatórias não podem ganhar intenção por aproximação fraca.
assert.equal(inferTrainedIntent('Reunião do financeiro amanhã às 9h'), null);
assert.equal(inferTrainedIntent('Obrigado pessoal, bom trabalho'), null);
assert.equal(inferTrainedIntent('O cliente enviou apenas um documento para cadastro'), null);

console.log('trained-intent-engine: ok', stats);
