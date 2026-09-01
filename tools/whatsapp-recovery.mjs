export function whatsappMessageTimestampMs(message = {}) {
  const raw = Number(message?.timestamp || 0);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return raw > 10_000_000_000 ? raw : raw * 1000;
}

export function selectRecentUnprocessedMessages(messages = [], {
  sinceMs = Date.now(),
  nowMs = Date.now(),
  processedIds = new Set(),
  maxWindowMs = 15 * 60 * 1000,
  startupSkewMs = 15 * 1000,
} = {}) {
  const safeNow = Number(nowMs) || Date.now();
  const safeSince = Number(sinceMs) || safeNow;
  const cutoff = Math.max(safeNow - maxWindowMs, safeSince - startupSkewMs);

  return (Array.isArray(messages) ? messages : [])
    .filter((message) => {
      if (!message || message.fromMe) return false;
      if (!String(message.body || '').trim()) return false;
      const at = whatsappMessageTimestampMs(message);
      if (!at || at < cutoff || at > safeNow + 60_000) return false;
      const id = message?.id?._serialized || '';
      if (id && processedIds?.has?.(id)) return false;
      return true;
    })
    .sort((a, b) => whatsappMessageTimestampMs(a) - whatsappMessageTimestampMs(b));
}
