import fs from 'node:fs/promises';

const file = new URL('./vercel-whatsapp-worker.mjs', import.meta.url);
let source = await fs.readFile(file, 'utf8');

function replaceOnce(before, after, label) {
  if (source.includes(after)) return;
  if (!source.includes(before)) throw new Error(`Marcador não encontrado: ${label}`);
  source = source.replace(before, after);
}

replaceOnce(
  "import { maybeInterpretOperationalMessage } from './ai-operational-fallback.mjs';",
  "import { maybeInterpretOperationalMessage } from './ai-operational-fallback.mjs';\nimport { selectRecentUnprocessedMessages } from './whatsapp-recovery.mjs';",
  'import recovery',
);

replaceOnce(
  "let lastWhatsappRecoveryAt = 0;",
  "let lastWhatsappRecoveryAt = 0;\nlet whatsappUnavailableSince = Date.now();",
  'recovery timestamp',
);

const startMarker = "async function startWhatsApp() {";
const recoveryFunction = `async function recoverMissedWhatsAppMessages(sinceMs) {
  if (!waClient || waStatus !== 'pronto') return 0;
  const allowed = await getAllowedGroupIds();
  if (!allowed.size) return 0;

  let recovered = 0;
  const processedIds = new Set(processedMessageIds.keys());
  for (const groupId of allowed) {
    try {
      const chat = await waClient.getChatById(groupId);
      if (!chat?.isGroup) continue;
      const recent = await chat.fetchMessages({ limit: 25 });
      const pending = selectRecentUnprocessedMessages(recent, {
        sinceMs,
        processedIds,
      });
      for (const message of pending) {
        const messageId = message?.id?._serialized || '';
        logEvent('recovery', \`Recuperando mensagem recebida durante indisponibilidade em \${chat.name || groupId}.\`, {
          groupId,
          messageId,
          timestamp: message?.timestamp || null,
        });
        await processIncomingMessage(message);
        if (messageId) processedIds.add(messageId);
        recovered += 1;
      }
    } catch (error) {
      logEvent('warning', 'Falha ao recuperar mensagens recentes após reconexão.', {
        groupId,
        error: String(error?.message || error).slice(0, 180),
      });
    }
  }
  if (recovered) logEvent('recovery', \`\${recovered} mensagem(ns) recuperada(s) após reconexão do WhatsApp.\`);
  return recovered;
}

${startMarker}`;
replaceOnce(startMarker, recoveryFunction, 'recovery function');

replaceOnce(
`  waClient.on('ready', async () => {
    waStatus = 'pronto';
    qrDataUrl = null;
    logEvent('whatsapp', 'WhatsApp conectado e pronto.');
    try {
      await discoverGroups();
    } catch {}
    const settings = await getSettings();`,
`  waClient.on('ready', async () => {
    const recoverySince = whatsappUnavailableSince || Date.now();
    waStatus = 'pronto';
    qrDataUrl = null;
    logEvent('whatsapp', 'WhatsApp conectado e pronto.');
    try {
      await discoverGroups();
    } catch {}
    await recoverMissedWhatsAppMessages(recoverySince).catch((error) => {
      logEvent('warning', 'Recuperação de mensagens após ready falhou.', { error: String(error?.message || error).slice(0, 180) });
    });
    whatsappUnavailableSince = null;
    const settings = await getSettings();`,
  'ready recovery',
);

replaceOnce(
`  waClient.on('auth_failure', (message) => {
    waStatus = 'erro';`,
`  waClient.on('auth_failure', (message) => {
    whatsappUnavailableSince = whatsappUnavailableSince || Date.now();
    waStatus = 'erro';`,
  'auth failure timestamp',
);

replaceOnce(
`  waClient.on('disconnected', (reason) => {
    waStatus = 'desconectado';`,
`  waClient.on('disconnected', (reason) => {
    whatsappUnavailableSince = whatsappUnavailableSince || Date.now();
    waStatus = 'desconectado';`,
  'disconnect timestamp',
);

await fs.writeFile(file, source);
console.log('WHATSAPP_RECOVERY_PATCHED');
