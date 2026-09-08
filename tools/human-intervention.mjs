function norm(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isManualServiceRefusal(text = '') {
  const value = norm(text);
  if (!value) return false;

  const explicitWorkRefusal = /^nao\s+(?:estamos|tamos)\s+(?:fazendo|pegando|atendendo)(?:\s+(?:(?:esse|este|o)\s+)?(?:trabalho|servico|atendimento))?$/.test(value)
    || /^nao\s+(?:fazemos|pegamos|atendemos)(?:\s+(?:(?:esse|este|o)\s+)?(?:trabalho|servico|atendimento))?$/.test(value)
    || /^nao\s+(?:consigo|conseguimos|podemos)\s+(?:fazer|pegar|atender|ir|assumir)(?:\s+(?:(?:esse|este|o)\s+)?(?:trabalho|servico|atendimento))?$/.test(value)
    || /^nao\s+(?:da|daria)\s+(?:pra|para)\s+(?:fazer|pegar|atender|ir|assumir)(?:\s+(?:(?:esse|este|o)\s+)?(?:trabalho|servico|atendimento))?$/.test(value);

  const availabilityRefusal = /^(?:estamos\s+)?sem\s+disponibilidade(?:\s+(?:agora|no momento))?$/.test(value)
    || /^nao\s+(?:tenho|temos)\s+disponibilidade(?:\s+(?:agora|no momento))?$/.test(value);

  const referencedJobRefusal = /^(?:esse|este)\s+(?:trabalho|servico|atendimento)\s+(?:nao|n)$/.test(value)
    || /^(?:esse|este)\s+(?:nao|n)\s+(?:fazemos|pegamos|atendemos)$/.test(value);

  return explicitWorkRefusal || availabilityRefusal || referencedJobRefusal;
}

export function isCallManuallyDeclined(call = {}) {
  return Boolean(call?.providerDeclinedAt) || (call?.quoteOutcome === 'lost' && Boolean(call?.providerDeclineText));
}

export function markCallManuallyDeclined(call = {}, text = '', at = new Date().toISOString()) {
  if (!call || typeof call !== 'object') return call;
  const timestamp = new Date(at);
  const iso = Number.isFinite(timestamp.getTime()) ? timestamp.toISOString() : new Date().toISOString();
  call.providerDeclinedAt = iso;
  call.providerDeclineText = String(text || '').trim().slice(0, 500);
  call.quoteTracked = call.quoteTracked === true || Boolean(call.quoteRequestedAt) || ['cotacao','aguardando_dados','aguardando_aprovacao','agendado'].includes(String(call.status || ''));
  if (call.quoteTracked) {
    call.quoteOutcome = 'lost';
    call.quoteLostAt = call.quoteLostAt || iso;
  }
  call.updatedAt = iso;
  return call;
}
