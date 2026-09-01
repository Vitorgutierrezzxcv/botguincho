import assert from 'node:assert/strict';
import { selectRecentUnprocessedMessages } from './whatsapp-recovery.mjs';

const nowMs = Date.parse('2026-09-01T02:29:50.000Z');
const sinceMs = Date.parse('2026-09-01T02:29:25.000Z');
const msg = (id, iso, body, fromMe = false) => ({
  id: { _serialized: id },
  timestamp: Math.floor(Date.parse(iso) / 1000),
  body,
  fromMe,
});

const messages = [
  msg('old', '2026-09-01T02:28:00.000Z', 'Disponível?'),
  msg('missed', '2026-09-01T02:29:29.000Z', 'Disponível?'),
  msg('already', '2026-09-01T02:29:31.000Z', 'Outra cotação'),
  msg('ours', '2026-09-01T02:29:32.000Z', 'Disponível ✅', true),
];

const selected = selectRecentUnprocessedMessages(messages, {
  sinceMs,
  nowMs,
  processedIds: new Set(['already']),
});

assert.deepEqual(selected.map((item) => item.id._serialized), ['missed']);
console.log('WHATSAPP_RECOVERY_OK');
