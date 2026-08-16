from pathlib import Path
p=Path('tools/vercel-whatsapp-worker.mjs'); s=p.read_text()
anchor="let lastNominatimRequestAt = 0;\n"
if "let whatsappRecoveryTimer" not in s:
    s=s.replace(anchor,anchor+"let whatsappRecoveryTimer = null;\nlet lastWhatsappRecoveryAt = 0;\n",1)

anchor2="async function startWhatsApp() {\n"
block=r'''function scheduleWhatsAppRecovery(reason = 'unknown') {
  if (whatsappRecoveryTimer) return;
  const sinceLast = Date.now() - lastWhatsappRecoveryAt;
  const delay = Math.max(15000, 60000 - sinceLast);
  logEvent('recovery', `Recuperação do WhatsApp agendada em ${Math.ceil(delay / 1000)}s.`, { reason });
  whatsappRecoveryTimer = setTimeout(async () => {
    whatsappRecoveryTimer = null;
    lastWhatsappRecoveryAt = Date.now();
    try {
      const current = waClient;
      waClient = null;
      if (current) await current.destroy().catch(() => undefined);
      waStatus = 'iniciando';
      await startWhatsApp();
      logEvent('recovery', 'Rotina de reconexão do WhatsApp iniciada.', { reason });
    } catch (error) {
      logEvent('error', 'Falha na recuperação automática do WhatsApp.', { error: String(error), reason });
      scheduleWhatsAppRecovery('retry-after-failure');
    }
  }, delay);
}

'''
if 'function scheduleWhatsAppRecovery' not in s:
    s=s.replace(anchor2,block+anchor2,1)

old="""  waClient.on('auth_failure', (message) => {
    waStatus = 'erro';
    lastError = String(message);
    logEvent('error', 'Falha de autenticação do WhatsApp.', { error: lastError });
  });"""
new="""  waClient.on('auth_failure', (message) => {
    waStatus = 'erro';
    lastError = String(message);
    logEvent('error', 'Falha de autenticação do WhatsApp.', { error: lastError });
    scheduleWhatsAppRecovery('auth_failure');
  });"""
if old in s: s=s.replace(old,new,1)

old="""  waClient.on('disconnected', (reason) => {
    waStatus = 'desconectado';
    lastError = String(reason);
    logEvent('warning', 'WhatsApp desconectado.', { reason: lastError });
  });"""
new="""  waClient.on('disconnected', (reason) => {
    waStatus = 'desconectado';
    lastError = String(reason);
    logEvent('warning', 'WhatsApp desconectado.', { reason: lastError });
    scheduleWhatsAppRecovery('disconnected');
  });"""
if old in s: s=s.replace(old,new,1)

old="""  waClient.initialize().catch((error) => {
    waStatus = 'erro';
    lastError = error instanceof Error ? error.message : String(error);
    logEvent('error', 'Falha ao iniciar WhatsApp.', { error: lastError });
  });"""
new="""  waClient.initialize().catch((error) => {
    waStatus = 'erro';
    lastError = error instanceof Error ? error.message : String(error);
    logEvent('error', 'Falha ao iniciar WhatsApp.', { error: lastError });
    scheduleWhatsAppRecovery('initialize_failure');
  });"""
if old in s: s=s.replace(old,new,1)

p.write_text(s)
print('whatsapp recovery patch applied')
