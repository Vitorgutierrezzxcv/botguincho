import fs from 'node:fs';

const file = new URL('./vercel-whatsapp-worker.mjs', import.meta.url);
let source = fs.readFileSync(file, 'utf8');

function replaceOnce(oldText, newText, label) {
  if (source.includes(newText)) return;
  const index = source.indexOf(oldText);
  if (index < 0) throw new Error(`Patch de respostas curtas: bloco não encontrado (${label}).`);
  source = source.slice(0, index) + newText + source.slice(index + oldText.length);
}

replaceOnce(
`function asksDistance(text = '') {
  const value = normalizeForIntent(text);
  if (/^kms?\\s*\\?+$/.test(value)) return true;
  return /\\b(qual (?:a )?distancia|quanto(?:s)? km|quantos quilometros|distancia (?:ate|para|pro|do guincho|do local|do cliente)|km totais?|quilometragem(?: total)?)\\b/.test(value);
}
`,
`function asksDistance(text = '') {
  const value = normalizeForIntent(text);
  if (/^kms?\\s*\\?+$/.test(value)) return true;
  return /\\b(qual (?:a )?distancia|quanto(?:s)? km|quantos quilometros|distancia (?:ate|para|pro|do guincho|do local|do cliente)|km totais?|quilometragem(?: total)?)\\b/.test(value);
}

function asksValue(text = '') {
  const value = normalizeForIntent(text).replace(/[!.,;:]+/g, ' ').replace(/\\s+/g, ' ').trim();
  return /^(?:valor|preco|preco do atendimento|valor do atendimento|quanto fica|quanto deu)\\s*\\?*$/.test(value)
    || /^(?:qual|q)\\s+(?:o\\s+)?valor\\s*\\?*$/.test(value);
}

function isShortKmQuestion(text = '') {
  const value = normalizeForIntent(text).replace(/[!.,;:]+/g, ' ').replace(/\\s+/g, ' ').trim();
  return /^(?:km|kms|quilometragem|km total|kms total|km totais|kms totais)\\s*\\?*$/.test(value);
}
`,
'asksDistance/asksValue',
);

replaceOnce(
`  if (looksLikeDispatch(value) || asksAvailability(value) || asksEta(value) || asksDistance(value) || asksTrackerLocation(value)) return true;`,
`  if (looksLikeDispatch(value) || asksAvailability(value) || asksEta(value) || asksDistance(value) || asksValue(value) || asksTrackerLocation(value)) return true;`,
'isOperationalMessage',
);

replaceOnce(
`async function handleDistanceQuestion(msg, groupName, readableText, quotedText = '') {
  const target = await resolveRouteQuestionTarget(msg.from, readableText, quotedText);`,
`async function handleDistanceQuestion(msg, groupName, readableText, quotedText = '', context = null) {
  const call = context?.recentCall || null;
  if (isShortKmQuestion(readableText)) {
    const totalKm = call?.billableKm ?? call?.estimatedTotalKm ?? call?.totalKm ?? call?.routeBreakdown?.totalKm ?? null;
    if (Number.isFinite(Number(totalKm))) {
      const label = ['autorizado','a_caminho','em_atendimento','aguardando_fechamento','finalizado','concluido'].includes(String(call?.status || '').toLowerCase())
        ? 'Quilometragem total'
        : 'Percurso estimado do atendimento';
      await replyAndRemember(msg, groupName, readableText, \`${'${label}'}: ${'${formatKm(totalKm)}'} km.\`, {
        intent: 'distance-summary', callId: call?.id || null, totalKm: Number(totalKm),
      });
      return;
    }
  }
  const target = await resolveRouteQuestionTarget(msg.from, readableText, quotedText);`,
'handleDistanceQuestion',
);

replaceOnce(
`async function handleTrackerLocationQuestion(msg, groupName, readableText) {`,
`async function handleValueQuestion(msg, groupName, readableText, context = null) {
  const call = context?.recentCall || null;
  if (!call) {
    await replyAndRemember(msg, groupName, readableText, 'Não encontrei atendimento recente para consultar o valor.', { intent: 'value-short-without-call' });
    return;
  }

  const storedAmount = [call.value, call.calculatedValue, call.estimatedValue, call.calculatedAmount, call.commercial?.calculatedAmount]
    .map(Number)
    .find((value) => Number.isFinite(value) && value > 0) || 0;
  if (storedAmount > 0) {
    const finalStatuses = new Set(['aguardando_fechamento', 'finalizado', 'concluido']);
    const label = finalStatuses.has(String(call.status || '').toLowerCase()) ? 'Valor do atendimento' : 'Valor estimado';
    await replyAndRemember(msg, groupName, readableText, \`${'${label}'}: ${'${formatCurrency(storedAmount)}'}.\`, {
      intent: 'value-short', callId: call.id, amount: storedAmount, source: 'stored',
    });
    return;
  }

  const totalKm = call.billableKm ?? call.estimatedTotalKm ?? call.routeBreakdown?.totalKm ?? call.totalKm ?? null;
  if (totalKm !== null && totalKm !== undefined && context?.approvedRules) {
    const commercial = reconcileCommercial({
      approvedRules: context.approvedRules,
      facts: { ...(context.facts || {}), vehicleType: call.vehicleType || context?.facts?.vehicleType || null, totalKm },
      estimatedTotalKm: totalKm,
    });
    const calculated = Number(commercial?.calculatedAmount || 0);
    if (commercial?.status === 'ok' && calculated > 0) {
      await replyAndRemember(msg, groupName, readableText, \`Valor estimado: ${'${formatCurrency(calculated)}'}.\`, {
        intent: 'value-short', callId: call.id, amount: calculated, source: 'recalculated',
      });
      return;
    }
  }

  await replyAndRemember(msg, groupName, readableText, 'Valor ainda não calculado para este atendimento.', {
    intent: 'value-short-unavailable', callId: call.id,
  });
}

async function handleTrackerLocationQuestion(msg, groupName, readableText) {`,
'handleValueQuestion',
);

replaceOnce(
`    if (runtimeIntent === 'quote') {`,
`    // Perguntas curtas sobre uma corrida já registrada não devem reabrir a cotação.
    // O atalho vem depois das proteções de silêncio, horário, disponibilidade e área.
    if (!looksLikeDispatch(readableText)) {
      if (asksEta(readableText)) {
        await handleEtaQuestion(msg, groupName, readableText, quotedText, operationalContext);
        return;
      }
      if (asksDistance(readableText)) {
        await handleDistanceQuestion(msg, groupName, readableText, quotedText, operationalContext);
        return;
      }
      if (asksValue(readableText)) {
        await handleValueQuestion(msg, groupName, readableText, operationalContext);
        return;
      }
    }

    if (runtimeIntent === 'quote') {`,
'prioridade dos atalhos',
);

replaceOnce(
`    if (asksDistance(readableText)) {
      await handleDistanceQuestion(msg, groupName, readableText, quotedText);
      return;
    }

    if (asksTrackerLocation(readableText)) {`,
`    if (asksDistance(readableText)) {
      await handleDistanceQuestion(msg, groupName, readableText, quotedText, operationalContext);
      return;
    }

    if (asksValue(readableText)) {
      await handleValueQuestion(msg, groupName, readableText, operationalContext);
      return;
    }

    if (asksTrackerLocation(readableText)) {`,
'fallback final de distância/valor',
);

fs.writeFileSync(file, source);
console.log('Patch de respostas curtas aplicado com sucesso.');
