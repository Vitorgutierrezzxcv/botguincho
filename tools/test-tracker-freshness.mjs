import assert from 'node:assert/strict';
import { trackerAgeSeconds, trackerSourceTimestamp } from './tracker-freshness.mjs';

const now = Date.parse('2026-08-28T00:10:00Z');
const stale = { lastUpdateText: '08/17/2026 10:36 PM', receivedAt: '2026-08-28T00:09:58Z' };
assert.ok(trackerAgeSeconds(stale, now) > 86400);
const fresh = { sourceUpdatedAt: '2026-08-28T00:09:40Z', receivedAt: '2026-08-28T00:09:58Z' };
assert.equal(trackerAgeSeconds(fresh, now), 20);
const fallback = { receivedAt: '2026-08-28T00:09:30Z' };
assert.equal(trackerAgeSeconds(fallback, now), 30);
assert.ok(Number.isFinite(trackerSourceTimestamp(stale)));
console.log('TRACKER_FRESHNESS_OK');
