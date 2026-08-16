from pathlib import Path
p=Path('tools/vercel-whatsapp-worker.mjs'); s=p.read_text()
# Reduce dispatch context TTL from 12h to 2h.
s=s.replace("age > 12 * 60 * 60 * 1000", "age > 2 * 60 * 60 * 1000")
# Prevent duplicate event processing inside same worker lifetime.
anchor="const routeProviderState = new Map();\n"
if "const processedMessageIds" not in s:
    s=s.replace(anchor,anchor+"const processedMessageIds = new Map();\n",1)
anchor2="async function processIncomingMessage(msg) {\n  try {\n"
block="""async function processIncomingMessage(msg) {
  try {
    const messageId = msg?.id?._serialized || '';
    if (messageId) {
      const seenAt = processedMessageIds.get(messageId);
      if (seenAt && Date.now() - seenAt < 6 * 60 * 60 * 1000) {
        logEvent('dedupe', 'Mensagem repetida do WhatsApp ignorada.', { messageId });
        return;
      }
      processedMessageIds.set(messageId, Date.now());
      if (processedMessageIds.size > 1000) {
        const cutoff = Date.now() - 6 * 60 * 60 * 1000;
        for (const [id, at] of processedMessageIds) if (at < cutoff) processedMessageIds.delete(id);
      }
    }
"""
if anchor2 in s and "Mensagem repetida do WhatsApp ignorada" not in s:
    s=s.replace(anchor2,block,1)
p.write_text(s)
print('context safety patch applied')
