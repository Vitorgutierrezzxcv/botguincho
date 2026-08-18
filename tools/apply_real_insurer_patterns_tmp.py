from pathlib import Path
p=Path('tools/vercel-whatsapp-worker.mjs')
s=p.read_text()

old="""function looksLikeDispatch(text = '') {
  const value = normalizeForIntent(text);
  const hasService = /\\b(reboque|guincho|servico selecionado|assistencia 24h|remocao)\\b/.test(value);
  const hasOrigin = /\\borigem\\s*[:\\-]/.test(value);
  const hasDestination = /\\bdestino\\s*[:\\-]/.test(value);
  const hasVehicleOrProblem = /\\b(veiculo|carro|moto|pane|fiat|ford|chevrolet|volkswagen|renault|toyota|honda|hyundai|idea|gol|onix|ka)\\b/.test(value);
  return (hasService && (hasOrigin || hasDestination || hasVehicleOrProblem)) || (hasOrigin && hasDestination);
}

function asksAvailability(text = '') {
  const value = normalizeForIntent(text);
  if (looksLikeDispatch(value)) return false;
  return /\\b(disponivel|disponibilidade|tem guincho|tem reboque|consegue atender|pode atender|tem como atender|esta livre|ta livre)\\b/.test(value);
}
"""
new="""function looksLikeDispatch(text = '') {
  const value = normalizeForIntent(text);
  const hasService = /\\b(reboque|guincho|servico selecionado|assistencia 24h|remocao|acionamento)\\b/.test(value);
  const hasOrigin = /\\b(?:endereco\\s+(?:de\\s+)?)?origem\\b/.test(value);
  const hasDestination = /\\b(?:endereco\\s+(?:de\\s+)?)?destino\\b/.test(value);
  const hasVehicleOrProblem = /\\b(veiculo|carro|moto|pane|fiat|ford|chevrolet|volkswagen|renault|toyota|honda|hyundai|idea|gol|onix|ka|strada|palio|uno|classic)\\b/.test(value);
  return (hasService && (hasOrigin || hasDestination || hasVehicleOrProblem)) || (hasOrigin && hasDestination);
}

function asksAvailability(text = '') {
  const value = normalizeForIntent(text);
  return /\\b(disponivel|disponibilidade|tem guincho|tem reboque|consegue atender|pode atender|tem como atender|esta livre|ta livre|disponivel para remocao|disponivel para o reboque)\\b/.test(value);
}
"""
assert old in s
s=s.replace(old,new)

old="""  const pattern = new RegExp(`^(?:${escapedAliases.join('|')})\\\\s*[:\\\\-]\\\\s*(.*)$`);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const normalized = normalizeForIntent(line);
    if (!pattern.test(normalized)) continue;

    const rawMatch = line.match(/^\\s*[^:\\-]+?\\s*[:\\-]\\s*(.*)$/);
    const inlineValue = rawMatch?.[1]?.trim();
    if (inlineValue) return inlineValue;
"""
new="""  const pattern = new RegExp(`^(?:${escapedAliases.join('|')})\\\\b\\\\s*(?:[:\\\\-]\\\\s*)?(.*)$`);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const normalized = normalizeForIntent(line);
    const normalizedMatch = normalized.match(pattern);
    if (!normalizedMatch) continue;

    const inlineValueNormalized = normalizedMatch?.[1]?.trim();
    if (inlineValueNormalized) {
      // Remove o rótulo mantendo a grafia original do endereço.
      const labelRegex = target === 'origem'
        ? /^\\s*(?:endere[cç]o\\s+(?:de\\s+)?)?origem\\s*(?:[:\\-]\\s*)?/i
        : /^\\s*(?:endere[cç]o\\s+(?:de\\s+)?)?destino\\s*(?:[:\\-]\\s*)?/i;
      const inlineValue = line.replace(labelRegex, '').trim();
      if (inlineValue) return inlineValue;
    }
"""
assert old in s
s=s.replace(old,new)

old="""function asksDistance(text = '') {
  const value = normalizeForIntent(text);
  return /\\b(qual (?:a )?distancia|quanto(?:s)? km|quantos quilometros|distancia (?:ate|para|pro|do guincho|do local|do cliente))\\b/.test(value);
}
"""
new="""function asksDistance(text = '') {
  const value = normalizeForIntent(text);
  return /\\b(qual (?:a )?distancia|quanto(?:s)? km|quantos quilometros|distancia (?:ate|para|pro|do guincho|do local|do cliente)|km totais?|quilometragem(?: total)?)\\b/.test(value);
}
"""
assert old in s
s=s.replace(old,new)

old="""    if (looksLikeDispatch(readableText)) {
      await handleDispatch(msg, groupName, readableText, incomingLocation);
      return;
    }

    if (asksEta(readableText)) {
"""
new="""    // Em grupos de assistência é comum enviarem todos os dados do serviço e, no fim,
    // perguntarem apenas se há disponibilidade. Isso ainda não é um acionamento aceito.
    if (asksAvailability(readableText)) {
      await replyAndRemember(msg, groupName, readableText, 'Disponível ✅', { intent: 'availability' });
      return;
    }

    if (looksLikeDispatch(readableText)) {
      await handleDispatch(msg, groupName, readableText, incomingLocation);
      return;
    }

    if (asksEta(readableText)) {
"""
assert old in s
s=s.replace(old,new)

old="""    if (asksAvailability(readableText)) {
      await replyAndRemember(msg, groupName, readableText, 'Disponível ✅', { intent: 'availability' });
      return;
    }

    const greeting = greetingReply(readableText);
"""
new="""    const greeting = greetingReply(readableText);
"""
assert old in s
s=s.replace(old,new)

p.write_text(s)
print('patched real insurer patterns')
