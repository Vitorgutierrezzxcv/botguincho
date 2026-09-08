import fs from 'node:fs';

function replaceOnce(text, from, to, label) {
  if (text.includes(to)) return text;
  if (!text.includes(from)) throw new Error(`${label}: padrão não encontrado`);
  return text.replace(from, to);
}

const knowledgePath = 'tools/operational-knowledge.mjs';
let knowledge = fs.readFileSync(knowledgePath, 'utf8');

const kmAnchor = String.raw`    /(?:finaliz(?:ado|amos)|fech(?:ado|amento))[^\n]{0,30}?\b(\d+(?:[.,]\d+)?)\s*km\b/i,`;
const kmReverse = String.raw`    /\b(\d+(?:[.,]\d+)?)\s*kms?\b[^\n]{0,40}?\b(?:finaliz(?:ado|ada|amos)|fech(?:ado|ada|amento))\b/i,`;
knowledge = replaceOnce(
  knowledge,
  kmAnchor,
  `${kmReverse}\n${kmAnchor}`,
  'closure-km-reverse',
);

const valueAnchor = String.raw`    /(?:fechamento|finalizado)[^\n]{0,60}?(?:r\$\s*)(\d{2,6}(?:[.,]\d{1,2})?)/i,`;
const valueReverse = String.raw`    /(?:r\$\s*)(\d{2,6}(?:[.,]\d{1,2})?)[^\n]{0,80}?\b(?:finaliz(?:ado|ada)|fech(?:ado|ada|amento))\b/i,`;
knowledge = replaceOnce(
  knowledge,
  valueAnchor,
  `${valueReverse}\n${valueAnchor}`,
  'closure-value-reverse',
);

fs.writeFileSync(knowledgePath, knowledge);

const workerPath = 'tools/vercel-whatsapp-worker.mjs';
let worker = fs.readFileSync(workerPath, 'utf8');

const kmPriorityOld = `    reportedTotalKm,\n    totalKm: automaticKm ?? reportedTotalKm ?? call?.totalKm ?? null,`;
const kmPriorityNew = `    reportedTotalKm,\n    // No fechamento, o KM explicitamente informado pela central prevalece sobre a estimativa da rota.\n    totalKm: reportedTotalKm ?? automaticKm ?? call?.totalKm ?? null,`;
worker = replaceOnce(worker, kmPriorityOld, kmPriorityNew, 'closure-km-priority');

const replyOld = `  const lines = ['Execução registrada ✅'];\n  const km = saved?.billableKm ?? automaticKm ?? facts.totalKm;\n  if (Number.isFinite(Number(km))) lines.push(\`Quilometragem para conferência: \${Number(km).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km.\`);`;
const replyNew = `  const lines = ['Execução registrada ✅'];\n  // Nunca exibir 0 km por falha de interpretação. O valor informado pela central tem prioridade.\n  const km = [facts.reportedTotalKm, saved?.billableKm, automaticKm, facts.totalKm]\n    .map((item) => Number(item))\n    .find((item) => Number.isFinite(item) && item > 0) ?? null;\n  if (km !== null) lines.push(\`Quilometragem para conferência: \${km.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km.\`);\n  else lines.push('Quilometragem não identificada na mensagem. Confira o KM no aplicativo antes de concluir.');`;
worker = replaceOnce(worker, replyOld, replyNew, 'closure-zero-km-guard');

fs.writeFileSync(workerPath, worker);

console.log('[closure-values-fix] KM/valor de fechamento corrigidos e proteção contra 0 km aplicada.');
