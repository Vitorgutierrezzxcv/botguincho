import fs from 'node:fs';

function replaceOnce(text, from, to, label) {
  if (text.includes(to)) return text;
  if (!text.includes(from)) throw new Error(`${label}: padrão não encontrado`);
  return text.replace(from, to);
}

// 1) O classificador não pode transformar um "ok" da central em autorização
// depois que o próprio prestador recusou manualmente aquele atendimento.
const knowledgePath = 'tools/operational-knowledge.mjs';
let knowledge = fs.readFileSync(knowledgePath, 'utf8');

knowledge = replaceOnce(
  knowledge,
  "  const activeService = ['autorizado','a_caminho','em_atendimento','aguardando_fechamento'].includes(recentCall?.status);\n  const evidenceContext = activeService || recentCall?.status === 'concluido';",
  "  const activeService = ['autorizado','a_caminho','em_atendimento','aguardando_fechamento'].includes(recentCall?.status);\n  const manuallyDeclined = Boolean(recentCall?.providerDeclinedAt) || (recentCall?.quoteOutcome === 'lost' && Boolean(recentCall?.providerDeclineText));\n  const evidenceContext = activeService || recentCall?.status === 'concluido';",
  'knowledge-manual-decline-state',
);

knowledge = replaceOnce(
  knowledge,
  "  const pendingAuthorizationContext = ['cotacao','aguardando_aprovacao','aguardando_dados','agendado'].includes(recentCall?.status) && !recentCall?.authorizedAt;",
  "  const pendingAuthorizationContext = ['cotacao','aguardando_aprovacao','aguardando_dados','agendado'].includes(recentCall?.status) && !recentCall?.authorizedAt && !manuallyDeclined;",
  'knowledge-short-ok-guard',
);

knowledge = replaceOnce(
  knowledge,
  "  if (base === 'authorization') return 'authorization';",
  "  if (base === 'authorization' && manuallyDeclined) return 'other';\n  if (base === 'authorization') return 'authorization';",
  'knowledge-explicit-authorization-guard',
);

fs.writeFileSync(knowledgePath, knowledge);

// 2) Uma cotação recusada manualmente deixa de ser candidata a autorização pendente.
const orchestrationPath = 'tools/business-orchestration.mjs';
let orchestration = fs.readFileSync(orchestrationPath, 'utf8');
orchestration = replaceOnce(
  orchestration,
  "  const all = (Array.isArray(calls) ? calls : []).filter((call) => call?.sourceGroupId === id && !call?.deletedAt && call?.status !== 'excluido');",
  "  const all = (Array.isArray(calls) ? calls : []).filter((call) => call?.sourceGroupId === id && !call?.deletedAt && call?.status !== 'excluido' && !call?.providerDeclinedAt && call?.quoteOutcome !== 'lost');",
  'pending-authorization-ignore-declined',
);
fs.writeFileSync(orchestrationPath, orchestration);

// 3) Resposta humana no WhatsApp é autoridade operacional. Se o prestador disser
// que não fará o serviço, marcamos exatamente a cotação pendente como perdida.
const workerPath = 'tools/vercel-whatsapp-worker.mjs';
let worker = fs.readFileSync(workerPath, 'utf8');

worker = replaceOnce(
  worker,
  "import { scheduledCapacitySnapshot, isFutureScheduledCall, formatScheduledAtBr } from './scheduling-policy.mjs';\nimport { verifiedCommercialEntryForGroup, verifiedCommercialResolution } from './verified-commercial-catalog.mjs';",
  "import { scheduledCapacitySnapshot, isFutureScheduledCall, formatScheduledAtBr } from './scheduling-policy.mjs';\nimport { isManualServiceRefusal, isCallManuallyDeclined, markCallManuallyDeclined } from './human-intervention.mjs';\nimport { verifiedCommercialEntryForGroup, verifiedCommercialResolution } from './verified-commercial-catalog.mjs';",
  'worker-human-intervention-import',
);

worker = replaceOnce(
  worker,
  "  const intent = aiInterpretation?.intent || deterministicIntent;",
  "  let intent = aiInterpretation?.intent || deterministicIntent;\n  // A IA também não pode reabrir uma corrida que o prestador recusou manualmente.\n  if (isCallManuallyDeclined(recentCall) && intent === 'authorization') intent = 'other';",
  'worker-ai-authorization-guard',
);

const fingerprintAnchor = "      const botAt = botReplyFingerprints.get(fingerprint);\n      if (botAt && Date.now() - botAt < 90000) { botReplyFingerprints.delete(fingerprint); return; }\n      const inbound = lastInboundByGroup.get(groupId);";
const fingerprintReplacement = "      const botAt = botReplyFingerprints.get(fingerprint);\n      if (botAt && Date.now() - botAt < 90000) { botReplyFingerprints.delete(fingerprint); return; }\n\n      // Mensagens enviadas manualmente pelo prestador têm precedência sobre o bot.\n      // Ex.: prestador responde \"Não estamos fazendo\" e a central responde \"ok\".\n      // Esse \"ok\" é apenas ciência da recusa e jamais uma autorização.\n      if (isManualServiceRefusal(body)) {\n        const management = await getManagement();\n        const pending = pendingAuthorizationCallForGroup(management.calls, groupId);\n        if (pending) {\n          markCallManuallyDeclined(pending, body);\n          await saveManagement(management);\n          logEvent('human-control', `${chat?.name || groupId}: atendimento recusado manualmente pelo prestador.`, { groupId, callId: pending.id || null });\n        }\n      }\n\n      const inbound = lastInboundByGroup.get(groupId);";
worker = replaceOnce(worker, fingerprintAnchor, fingerprintReplacement, 'worker-human-refusal-state');

fs.writeFileSync(workerPath, worker);
console.log('[human-refusal-guard] recusa manual agora bloqueia autorização automática posterior.');
