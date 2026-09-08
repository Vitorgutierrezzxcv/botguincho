import fs from 'node:fs';

function patchFile(path, transform) {
  const before = fs.readFileSync(path, 'utf8');
  const after = transform(before);
  if (after === before) {
    console.log(`[queue-progress-fix] ${path}: nenhuma alteração necessária.`);
    return;
  }
  fs.writeFileSync(path, after);
  console.log(`[queue-progress-fix] ${path}: correção aplicada.`);
}

const progressCondition = `(status === 'concluido' || status === 'cancelado' || status === 'a_caminho' || status === 'em_atendimento' || eventType === 'evidencia_recebida' || phase === 'evidencias' || phase === 'no_destino')`;

patchFile('tools/vercel-whatsapp-worker.mjs', (source) => {
  const oldQueued = `      queued: eta?.queued === true ? true : (status === 'concluido' || status === 'cancelado' ? false : existing?.queued === true),\n      queuedBehindCallId: eta?.precedingCallId || existing?.queuedBehindCallId || null,`;
  const newQueued = `      // Qualquer progresso operacional real invalida a fila. Evidências/fotos, chegada,\n      // saída ou atendimento significam que essa corrida já começou e não pode receber\n      // depois uma mensagem falsa de \"Guincho liberado para este atendimento\".\n      queued: eta?.queued === true ? true : (${progressCondition} ? false : existing?.queued === true),\n      queuedBehindCallId: eta?.queued === true\n        ? (eta?.precedingCallId || existing?.queuedBehindCallId || null)\n        : (${progressCondition} ? null : (existing?.queuedBehindCallId || null)),`;
  if (!source.includes(oldQueued)) {
    if (source.includes('Qualquer progresso operacional real invalida a fila.')) return source;
    throw new Error('Trecho de fila do worker não encontrado; patch abortado para evitar alteração insegura.');
  }
  return source.replace(oldQueued, newQueued);
});

patchFile('tools/business-orchestration.mjs', (source) => {
  const oldFilter = `    .filter((call) => call?.queued === true\n      && (call?.queuedBehindCallId === completedCallId || call?.precedingCallId === completedCallId)\n      && String(call?.status || '') === 'autorizado')`;
  const newFilter = `    .filter((call) => call?.queued === true\n      && (call?.queuedBehindCallId === completedCallId || call?.precedingCallId === completedCallId)\n      && String(call?.status || '') === 'autorizado'\n      // Proteção contra estado de fila obsoleto: se já houve chegada/evidência, a corrida\n      // operacionalmente começou e não deve ser \"liberada\" outra vez.\n      && call?.arrivalConfirmed !== true\n      && !['evidencias','no_destino','em_atendimento','concluido'].includes(String(call?.operationalPhase || ''))\n      && !(Array.isArray(call?.evidenceChecklist) && call.evidenceChecklist.some((item) => item?.done === true)))`;
  if (!source.includes(oldFilter)) {
    if (source.includes('Proteção contra estado de fila obsoleto')) return source;
    throw new Error('Filtro de liberação de fila não encontrado; patch abortado para evitar alteração insegura.');
  }
  return source.replace(oldFilter, newFilter);
});

console.log('[queue-progress-fix] concluído.');
