import assert from 'node:assert/strict';
import {
  trackerAgeSeconds,
  trackerSourceAgeSeconds,
  trackerSourceTimestamp,
  trackerTransportTimestamp,
} from './tracker-freshness.mjs';

const now = Date.parse('2026-08-28T17:36:15Z');

// Cenário real observado em produção: o GConnect foi consultado agora, porém o
// caminhão parado ainda exibe o último evento em 17/08. Isso NÃO pode bloquear ETA.
const parkedTruckFreshBridge = {
  lastUpdateText: '08/17/2026 10:36 PM',
  capturedAt: '2026-08-28T17:36:00.031Z',
  receivedAt: '2026-08-28T17:36:00.050Z',
};
assert.equal(trackerAgeSeconds(parkedTruckFreshBridge, now), 15);
assert.ok(trackerSourceAgeSeconds(parkedTruckFreshBridge, now) > 86400);

// A recepção do agente é a referência de conectividade mesmo quando existe um
// timestamp de telemetria mais antigo.
const freshBridge = {
  sourceUpdatedAt: '2026-08-28T17:35:40Z',
  receivedAt: '2026-08-28T17:36:13Z',
};
assert.equal(trackerAgeSeconds(freshBridge, now), 2);
assert.equal(trackerSourceAgeSeconds(freshBridge, now), 35);

const capturedFallback = { capturedAt: '2026-08-28T17:36:10Z' };
assert.equal(trackerAgeSeconds(capturedFallback, now), 5);

const sourceOnlyFallback = { sourceUpdatedAt: '2026-08-28T17:35:55Z' };
assert.equal(trackerAgeSeconds(sourceOnlyFallback, now), 20);

assert.ok(Number.isFinite(trackerSourceTimestamp(parkedTruckFreshBridge)));
assert.ok(Number.isFinite(trackerTransportTimestamp(parkedTruckFreshBridge)));
console.log('TRACKER_FRESHNESS_OK');
