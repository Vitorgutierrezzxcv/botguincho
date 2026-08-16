from pathlib import Path
p=Path('tools/vercel-whatsapp-worker.mjs')
s=p.read_text()

# greeting helpers after asksAvailability
anchor="function asksEta(text = '') {\n"
block=r'''function greetingReply(text = '') {
  const value = normalizeForIntent(text).replace(/[!.,;:?]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (/^(bom dia|oi bom dia|ola bom dia|opa bom dia)$/.test(value)) return 'Bom dia! 👋';
  if (/^(boa tarde|oi boa tarde|ola boa tarde|opa boa tarde)$/.test(value)) return 'Boa tarde! 👋';
  if (/^(boa noite|oi boa noite|ola boa noite|opa boa noite)$/.test(value)) return 'Boa noite! 👋';
  if (/^(oi|ola|opa)$/.test(value)) return 'Olá! 👋';
  return null;
}

'''
if 'function greetingReply' not in s:
    if anchor not in s: raise SystemExit('greeting anchor missing')
    s=s.replace(anchor,block+anchor,1)

# Add resilient ETA wrapper after computeEtaToClient
anchor2="function trackerContextText(location) {\n"
block2=r'''async function computeEtaWithRetry(input = {}, options = {}) {
  const attempts = Math.max(1, Math.min(3, Number(options.attempts || 3)));
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const eta = await computeEtaToClient(input);
      if (eta) {
        if (attempt > 1) logEvent('recovery', `ETA recuperado na tentativa ${attempt}.`);
        return eta;
      }
      lastError = new Error('ETA indisponível sem erro explícito.');
    } catch (error) {
      lastError = error;
      logEvent('warning', `Tentativa ${attempt}/${attempts} de ETA falhou.`, { error: String(error) });
    }
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 1200 * attempt));
  }
  if (lastError) logEvent('safety', 'ETA suspenso após tentativas; nenhum dado antigo será reutilizado.', { error: String(lastError) });
  return null;
}

'''
if 'async function computeEtaWithRetry' not in s:
    if anchor2 not in s: raise SystemExit('eta wrapper anchor missing')
    s=s.replace(anchor2,block2+anchor2,1)

# Replace only handler-level calls (all occurrences are okay: route-test also benefits)
s=s.replace("eta = await computeEtaToClient({\n      targetAddress: state.originAddress,", "eta = await computeEtaWithRetry({\n      targetAddress: state.originAddress,")
s=s.replace("eta = await computeEtaToClient({\n      targetAddress: target.targetAddress,", "eta = await computeEtaWithRetry({\n      targetAddress: target.targetAddress,")

# Safe dispatch reply when ETA unavailable
old="""  const reply = formatEtaReply(eta, true);
  await replyAndRemember(msg, groupName, readableText, reply, { intent: 'dispatch', etaMinutes: eta?.minutes ?? null });"""
new="""  const reply = eta
    ? formatEtaReply(eta, true)
    : 'Confirmado ✅\\nEstou atualizando a localização para calcular a previsão.';
  await replyAndRemember(msg, groupName, readableText, reply, {
    intent: eta ? 'dispatch' : 'dispatch-safe-mode',
    etaMinutes: eta?.minutes ?? null,
  });"""
if old in s:
    s=s.replace(old,new,1)
elif "dispatch-safe-mode" not in s:
    raise SystemExit('dispatch reply anchor missing')

# Friendlier safe ETA unavailable message
s=s.replace("'Não consegui calcular a previsão agora.'", "'Estou atualizando a localização para calcular a previsão. Tente novamente em alguns segundos.'")
s=s.replace("'Não consegui calcular a rota agora.'", "'Estou atualizando a localização para calcular a rota. Tente novamente em alguns segundos.'")

# Add greeting before non-operational ignore, but after availability and all critical intents
anchor3="""    if (!isOperationalMessage(readableText)) {
      logEvent('ignored', `${groupName}: mensagem não operacional ignorada.`, { groupId: msg.from });
      return;
    }"""
new3="""    const greeting = greetingReply(readableText);
    if (greeting) {
      await replyAndRemember(msg, groupName, readableText, greeting, { intent: 'greeting' });
      return;
    }

    if (!isOperationalMessage(readableText)) {
      logEvent('ignored', `${groupName}: mensagem não operacional ignorada.`, { groupId: msg.from });
      return;
    }"""
if anchor3 in s:
    s=s.replace(anchor3,new3,1)
elif "intent: 'greeting'" not in s:
    raise SystemExit('greeting handler anchor missing')

p.write_text(s)
print('block1 hardening applied')
