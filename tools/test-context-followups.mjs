import assert from 'node:assert/strict';
import { inferLearningIntent } from './learning-engine.mjs';
import { classifyRuntimeIntent, extractOperationalFacts } from './operational-knowledge.mjs';
import { pendingAuthorizationCallForGroup } from './business-orchestration.mjs';
import { historicalExamplesForAi } from './training-runtime-index.mjs';

assert.equal(inferLearningIntent('AMANHA AS 7'), 'scheduled_dispatch');
assert.equal(inferLearningIntent('amanhã às 07:30'), 'scheduled_dispatch');
assert.equal(inferLearningIntent('Reunião amanhã às 7'), 'administrative_notice');
assert.equal(inferLearningIntent('pode prosseguir'), 'authorization');
assert.equal(inferLearningIntent('Pode continuar'), 'authorization');

const pendingQuote = {
  id: 'quote-new', sourceGroupId: 'grupo@g.us', status: 'cotacao',
  quoteRequestedAt: '2026-08-31T23:31:00-03:00', createdAt: '2026-08-31T23:31:00-03:00',
};
const olderQuote = {
  id: 'quote-old', sourceGroupId: 'grupo@g.us', status: 'aguardando_aprovacao',
  quoteRequestedAt: '2026-08-31T22:00:00-03:00', createdAt: '2026-08-31T22:00:00-03:00',
};
const oldActive = {
  id: 'active-old', sourceGroupId: 'grupo@g.us', status: 'em_atendimento',
  quoteRequestedAt: '2026-08-31T20:00:00-03:00', updatedAt: '2026-08-31T23:32:00-03:00',
};
assert.equal(pendingAuthorizationCallForGroup([oldActive, olderQuote, pendingQuote], 'grupo@g.us')?.id, 'quote-new');

const recent = { ...pendingQuote };
assert.equal(classifyRuntimeIntent('AMANHA AS 7', 'Tests guincho', recent), 'scheduled_dispatch');
assert.equal(classifyRuntimeIntent('pode prosseguir', 'Tests guincho', recent), 'authorization');

const scheduleFacts = extractOperationalFacts('AMANHA AS 7');
assert.ok(scheduleFacts.scheduledAt, 'agendamento curto deve produzir scheduledAt');
const scheduled = new Date(scheduleFacts.scheduledAt);
assert.ok(Number.isFinite(scheduled.getTime()));
assert.ok(scheduled.getTime() > Date.now(), 'agendamento de amanha deve ficar no futuro');
assert.ok(scheduled.getTime() - Date.now() < 36 * 60 * 60 * 1000, 'agendamento de amanha nao pode saltar mais de 36h');
const localHour = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false }).format(scheduled);
assert.equal(localHour, '07');

const scheduledPending = { ...pendingQuote, status: 'agendado', scheduledAt: scheduleFacts.scheduledAt };
assert.equal(pendingAuthorizationCallForGroup([oldActive, olderQuote, scheduledPending], 'grupo@g.us')?.id, 'quote-new', 'agendamento continua elegivel para autorizacao');

const examples = historicalExamplesForAi('pode prosseguir', 'América Guincho X Plus Assistência', 4);
assert.ok(examples.length > 0, 'historico deve fornecer exemplos para IA quando necessario');
assert.ok(examples.some((item) => item.intent === 'authorization'), 'historico semelhante deve incluir autorizacao');

console.log('CONTEXT_FOLLOWUPS_OK');
