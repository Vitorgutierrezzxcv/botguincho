import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pendingAuthorizationCallForGroup } from './business-orchestration.mjs';

const groupId = 'tests@g.us';
const oldActive = {
  id: 'old-active', sourceGroupId: groupId, status: 'autorizado',
  createdAt: '2026-08-27T18:00:00.000Z', updatedAt: '2026-08-28T21:12:13.000Z',
};
const pending = {
  id: 'pending-new', sourceGroupId: groupId, status: 'aguardando_aprovacao',
  quoteRequestedAt: '2026-08-28T21:10:41.000Z', createdAt: '2026-08-28T21:10:41.000Z', updatedAt: '2026-08-28T21:10:43.000Z',
};
assert.equal(pendingAuthorizationCallForGroup([oldActive, pending], groupId)?.id, 'pending-new');

const newerPending = {
  id: 'pending-newer', sourceGroupId: groupId, status: 'cotacao',
  quoteRequestedAt: '2026-08-28T21:11:00.000Z', createdAt: '2026-08-28T21:11:00.000Z', updatedAt: '2026-08-28T21:11:00.000Z',
};
assert.equal(pendingAuthorizationCallForGroup([pending, newerPending], groupId)?.id, 'pending-newer');
assert.equal(pendingAuthorizationCallForGroup([oldActive], groupId), null);
assert.equal(pendingAuthorizationCallForGroup([pending], 'other@g.us'), null);

const worker = fs.readFileSync(new URL('./vercel-whatsapp-worker.mjs', import.meta.url), 'utf8');
assert.match(worker, /pendingAuthorizationCallForGroup\(context\.management\?\.calls \|\| \[\], msg\.from\)/);
assert.match(worker, /const call = pendingCall \|\| context\.recentCall/);
console.log('AUTHORIZATION_PENDING_SELECTION_OK');
