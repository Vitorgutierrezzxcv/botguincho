import assert from 'node:assert/strict';
import { isManualServiceRefusal, isCallManuallyDeclined, markCallManuallyDeclined } from './human-intervention.mjs';
import { classifyRuntimeIntent } from './operational-knowledge.mjs';
import { pendingAuthorizationCallForGroup } from './business-orchestration.mjs';

const groupId = '120363000000000000@g.us';
const groupName = 'AMERICA GUINCHO - BETIM / TOP BRASIL';
const baseCall = {
  id: 'call-human-refusal-test',
  sourceGroupId: groupId,
  status: 'cotacao',
  quoteTracked: true,
  quoteRequestedAt: '2026-09-08T18:59:00.000Z',
  origin: 'Betim - MG',
  destination: 'Belo Horizonte - MG',
  vehicle: 'Hyundai HR',
  authorizedAt: null,
};

assert.equal(isManualServiceRefusal('Não estamos fazendo'), true);
assert.equal(isManualServiceRefusal('Não estamos fazendo este trabalho'), true);
assert.equal(isManualServiceRefusal('Sem disponibilidade no momento'), true);
assert.equal(isManualServiceRefusal('Não conseguimos atender'), true);
assert.equal(isManualServiceRefusal('Não estamos fazendo hora trabalhada'), false);
assert.equal(isManualServiceRefusal('Ok'), false);

const openCall = { ...baseCall };
assert.equal(pendingAuthorizationCallForGroup([openCall], groupId)?.id, openCall.id);
assert.equal(classifyRuntimeIntent('ok', groupName, openCall), 'authorization');

markCallManuallyDeclined(openCall, 'Não estamos fazendo', '2026-09-08T19:00:00.000Z');
assert.equal(isCallManuallyDeclined(openCall), true);
assert.equal(openCall.quoteOutcome, 'lost');
assert.equal(openCall.providerDeclineText, 'Não estamos fazendo');
assert.equal(pendingAuthorizationCallForGroup([openCall], groupId), null);
assert.notEqual(classifyRuntimeIntent('ok', groupName, openCall), 'authorization');
assert.notEqual(classifyRuntimeIntent('pode seguir', groupName, openCall), 'authorization');

console.log('[test-human-refusal-guard] OK — recusa manual prevalece e ok posterior não autoriza corrida.');
