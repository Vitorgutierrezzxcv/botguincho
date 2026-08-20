import assert from 'node:assert/strict';
import { buildInsurerSummaries, selectedGroupBillingView } from './financial-engine.mjs';

const selectedId = 'selected@g.us';
const hiddenId = 'hidden@g.us';
const view = selectedGroupBillingView({
  profiles: [
    { groupId: selectedId, groupName: 'Transportadora selecionada' },
    { groupId: hiddenId, groupName: 'Grupo não selecionado' },
  ],
  batches: [
    { groupId: selectedId, groupName: 'Transportadora selecionada', totalAmount: 100 },
    { groupId: hiddenId, groupName: 'Grupo não selecionado', totalAmount: 200 },
  ],
  finance: [
    { type: 'receita', groupId: selectedId, insurer: 'Transportadora selecionada', amount: 100 },
    { type: 'receita', groupId: hiddenId, insurer: 'Grupo não selecionado', amount: 200 },
    { type: 'despesa', amount: 50 },
  ],
  calls: [
    { sourceGroupId: selectedId, insurer: 'Transportadora selecionada', status: 'concluido', value: 100 },
    { sourceGroupId: hiddenId, insurer: 'Grupo não selecionado', status: 'concluido', value: 200 },
  ],
  historicalImports: [
    { groupId: selectedId, groupName: 'Transportadora selecionada' },
    { groupId: hiddenId, groupName: 'Grupo não selecionado' },
  ],
}, new Set([selectedId]));

assert.deepEqual(view.profiles.map((item) => item.groupId), [selectedId]);
assert.deepEqual(view.batches.map((item) => item.groupId), [selectedId]);
assert.equal(view.finance.filter((item) => item.type === 'receita').length, 1);
assert.equal(view.finance.filter((item) => item.type === 'despesa').length, 1);
assert.deepEqual(view.calls.map((item) => item.sourceGroupId), [selectedId]);
assert.deepEqual(view.historicalImports.map((item) => item.groupId), [selectedId]);

const summaries = buildInsurerSummaries(view);
assert.equal(summaries.length, 1);
assert.equal(summaries[0].groupId, selectedId);
assert.equal(summaries[0].groupName, 'Transportadora selecionada');

console.log('SELECTED_GROUP_BILLING_OK');
