import fs from 'node:fs';

const file = 'tools/vercel-whatsapp-worker.mjs';
let src = fs.readFileSync(file, 'utf8');
const before = `  const allowed = await getAllowedGroupIds();\n  if (!allowed.has(groupId)) throw new Error('group_not_authorized');\n  const chat = await waClient.getChatById(groupId);`;
const after = `  // Treinamento e resposta são permissões separadas: importar histórico não ativa o bot no grupo.\n  // Só permitimos leitura de grupos que realmente existem na sessão atual do WhatsApp.\n  const visibleChats = await waClient.getChats();\n  const chat = visibleChats.find((item) => item?.isGroup && item?.id?._serialized === groupId);\n  if (!chat) throw new Error('group_not_found');`;

if (!src.includes(before)) {
  throw new Error('training_import_guard_anchor_not_found');
}
src = src.replace(before, after);
fs.writeFileSync(file, src);
console.log('TRAINING_READONLY_IMPORT_PATCH_OK');
