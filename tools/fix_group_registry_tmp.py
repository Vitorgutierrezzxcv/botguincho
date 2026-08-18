from pathlib import Path
import re

path = Path('tools/vercel-whatsapp-worker.mjs')
s = path.read_text()

pattern = re.compile(r"async function discoverGroups\(\) \{.*?\n\}\n\nfunction remember", re.S)
replacement = r'''async function discoverGroups() {
  const previousRegistry = await getRegistry();
  const allowed = await getAllowedGroupIds();

  if (waClient && waStatus === 'pronto') {
    const discovered = new Map();
    const addGroup = (id, name) => {
      if (typeof id !== 'string' || !id.endsWith('@g.us')) return;
      discovered.set(id, {
        id,
        name: String(name || previousRegistry[id]?.name || 'Grupo do WhatsApp'),
        lastSeenAt: new Date().toISOString(),
      });
    };

    try {
      const chats = await waClient.getChats();
      for (const chat of chats ?? []) {
        const id = chat?.id?._serialized || '';
        if (chat?.isGroup || id.endsWith('@g.us')) addGroup(id, chat?.name || chat?.formattedTitle);
      }
    } catch (error) {
      logEvent('warning', 'getChats não conseguiu listar os grupos.', { error: String(error) });
    }

    if (!discovered.size) {
      try {
        const contacts = await waClient.getContacts();
        for (const contact of contacts ?? []) {
          const id = contact?.id?._serialized || '';
          if (contact?.isGroup || id.endsWith('@g.us')) {
            addGroup(id, contact?.name || contact?.pushname || contact?.shortName);
          }
        }
      } catch (error) {
        logEvent('warning', 'getContacts não conseguiu listar os grupos.', { error: String(error) });
      }
    }

    if (!discovered.size) {
      try {
        const fallback = await waClient.pupPage.evaluate(async () => {
          let chats = [];
          try { chats = await window.WWebJS?.getChats?.(); } catch {}
          if (!Array.isArray(chats) || !chats.length) {
            try { chats = window.require?.('WAWebCollections')?.Chat?.getModelsArray?.() ?? []; } catch {}
          }
          return (chats ?? [])
            .map((chat) => ({
              id: chat?.id?._serialized || '',
              name: chat?.formattedTitle || chat?.name || 'Grupo do WhatsApp',
              isGroup: Boolean(chat?.isGroup),
            }))
            .filter((chat) => chat.isGroup || chat.id.endsWith('@g.us'));
        });
        for (const group of fallback) addGroup(group.id, group.name);
      } catch (error) {
        logEvent('warning', 'Fallback do WhatsApp Web não conseguiu listar os grupos.', { error: String(error) });
      }
    }

    if (discovered.size) {
      // Fonte da verdade = conta do WhatsApp atualmente conectada.
      // Remove grupos antigos do registry e também permissões que não existem na conta atual.
      const nextRegistry = Object.fromEntries([...discovered.entries()]);
      await writeJson(registryFile, nextRegistry);

      const validAllowed = [...allowed].filter((id) => discovered.has(id));
      if (validAllowed.length !== allowed.size) {
        await setAllowedGroupIds(validAllowed);
        logEvent('security', `${allowed.size - validAllowed.length} autorização(ões) de grupo antigo removida(s) após troca/reconexão do WhatsApp.`);
      }

      logEvent('system', `${discovered.size} grupo(s) sincronizado(s) da conta atual do WhatsApp.`);
      return [...discovered.values()]
        .map((group) => ({ ...group, selected: validAllowed.includes(group.id) }))
        .sort((a, b) => String(a.name).localeCompare(String(b.name), 'pt-BR'));
    }
  }

  // Se o WhatsApp ainda não terminou de carregar, não destrói o registry salvo.
  // Porém esta lista só é fallback temporário até uma sincronização bem-sucedida.
  return Object.values(previousRegistry)
    .map((group) => ({ ...group, selected: allowed.has(group.id) }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'pt-BR'));
}

function remember'''

new_s, count = pattern.subn(replacement, s, count=1)
if count != 1:
    raise SystemExit(f'discoverGroups block not found: {count}')
path.write_text(new_s)
print('group registry fix prepared')
