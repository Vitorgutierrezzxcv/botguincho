import fs from 'node:fs';

const file = 'tools/vercel-whatsapp-worker.mjs';
let source = fs.readFileSync(file, 'utf8');

const anchor = `    const canBeRejectedByArea = hasExplicitAreaAddress && ['availability','quote','dispatch_details','incomplete_dispatch','protocol_received','authorization','formal_dispatch','scheduled_dispatch'].includes(runtimeIntent);`;
const replacement = `    // Pergunta isolada de disponibilidade (ex.: \"Disponível?\") não possui endereço próprio.
    // Nunca pode reutilizar origem/destino de corrida anterior para decidir cobertura.
    const bareAvailabilityQuestion = runtimeIntent === 'availability' && !hasExplicitAreaAddress;
    const canBeRejectedByArea = !bareAvailabilityQuestion && hasExplicitAreaAddress && ['availability','quote','dispatch_details','incomplete_dispatch','protocol_received','authorization','formal_dispatch','scheduled_dispatch'].includes(runtimeIntent);`;

if (source.includes(anchor)) {
  source = source.replace(anchor, replacement);
} else if (!source.includes('const bareAvailabilityQuestion =')) {
  throw new Error('Gate de disponibilidade/área não encontrado.');
}

// Defesa adicional: qualquer pergunta curta e isolada de disponibilidade deve ser tratada
// antes de handlers que tentem resolver endereço implícito/recente.
const shortAnchor = `    // Perguntas curtas sobre uma corrida já registrada não devem reabrir a cotação.`;
const shortInsert = `    // Disponibilidade curta não deve consultar endereço/corrida anterior.\n    if (runtimeIntent === 'availability' && !looksLikeDispatch(readableText) && !/\\b(origem|destino)\\b\\s*[:=\\-]?/i.test(String(readableText || ''))) {\n      await replyAndRemember(msg, groupName, readableText, 'Disponível ✅', { intent: 'availability-short-safe' });\n      return;\n    }\n\n${shortAnchor}`;

if (source.includes(shortAnchor) && !source.includes("intent: 'availability-short-safe'")) {
  source = source.replace(shortAnchor, shortInsert);
}

fs.writeFileSync(file, source);
console.log('Disponibilidade curta protegida contra área herdada.');
