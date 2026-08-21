import assert from 'node:assert/strict';
import { activeCallsForCapacity, capacitySnapshot, isCapacityActiveCall } from './dispatch-capacity.mjs';

assert.equal(isCapacityActiveCall({ status: 'autorizado' }), true);
assert.equal(isCapacityActiveCall({ status: 'autorizado', testMode: true }), false);

const state = {
  calls: [
    { id: 'real-1', status: 'autorizado', createdAt: '2026-08-20T10:00:00Z' },
    { id: 'test-1', status: 'autorizado', testMode: true, createdAt: '2026-08-20T09:00:00Z' },
    { id: 'test-2', status: 'em_atendimento', testMode: true, createdAt: '2026-08-20T08:00:00Z' },
  ],
};

assert.deepEqual(activeCallsForCapacity(state).map((call) => call.id), ['real-1']);
assert.deepEqual(capacitySnapshot(state), {
  maxConcurrentCalls: 2,
  activeCount: 1,
  slotsAvailable: 1,
  canAccept: true,
  activeCalls: [state.calls[0]],
});

console.log('DISPATCH_CAPACITY_OK');
