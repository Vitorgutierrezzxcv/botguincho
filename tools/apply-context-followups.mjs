import fs from 'node:fs/promises';

async function patchFile(path, transform) {
  const before = await fs.readFile(path, 'utf8');
  const after = transform(before);
  if (after === before) throw new Error(`patch_not_applied:${path}`);
  await fs.writeFile(path, after);
}

await patchFile('tools/learning-engine.mjs', (source) => {
  const oldSchedule = `  if (\n    /\\b(agendamento|agendado|agendada)\\b/.test(value)\n    || (hasOperationalContext && /\\bamanha\\s+(?:as|às)\\s*\\d{1,2}/.test(value))\n    || (hasOperationalContext && /\\bpara o dia\\s+\\d{1,2}[\\/.-]\\d{1,2}/.test(value))\n  ) {\n    return 'scheduled_dispatch';\n  }\n\n  if (/\\b(pode\\s*seguir|pode\\s*ir|liberado|libera|autorizado|autorizada)\\b/.test(value) || /^seguir\\??$/.test(value)) return 'authorization';`;
  const newSchedule = `  // Follow-ups curtos de agenda aparecem logo depois de uma cotacao completa.\n  // Comunicados administrativos ja foram filtrados acima, portanto \"amanha as 7\"\n  // pode ser tratado como agendamento sem exigir repetir origem/destino.\n  const shortSchedule = /^(?:amanha|hoje)(?:\\s+(?:as|a))?\\s+\\d{1,2}(?:(?::|h)\\d{0,2})?$/i.test(value);\n  if (\n    /\\b(agendamento|agendado|agendada)\\b/.test(value)\n    || shortSchedule\n    || /\\bamanha\\s+(?:as|a)?\\s*\\d{1,2}(?:(?::|h)\\d{0,2})?\\b/.test(value)\n    || /\\bpara o dia\\s+\\d{1,2}[\\/.-]\\d{1,2}/.test(value)\n  ) {\n    return 'scheduled_dispatch';\n  }\n\n  if (/\\b(pode\\s*(?:seguir|prosseguir|continuar|ir)|liberado|libera|autorizado|autorizada)\\b/.test(value) || /^(?:seguir|prosseguir)\\??$/.test(value)) return 'authorization';`;
  if (!source.includes(oldSchedule)) throw new Error('learning_schedule_anchor_missing');
  return source.replace(oldSchedule, newSchedule);
});

await patchFile('tools/operational-knowledge.mjs', (source) => {
  const oldFacts = `  const dateMatch = raw.match(/\\b(\\d{1,2})[\\/.-](\\d{1,2})(?:[\\/.-](\\d{2,4}))\\b/);\n  const timeMatch = raw.match(/\\b(?:[aà]s?\\s*)?(\\d{1,2})[:h](\\d{2})\\b/i);\n  let scheduledAt = null;\n  if (/\\bagend/.test(value) && dateMatch) {\n    const year = Number(dateMatch[3] || new Date().getFullYear());\n    const fullYear = year < 100 ? 2000 + year : year;\n    const hh = Number(timeMatch?.[1] || 0), mm = Number(timeMatch?.[2] || 0);\n    const dt = new Date(fullYear, Number(dateMatch[2]) - 1, Number(dateMatch[1]), hh, mm);\n    if (!Number.isNaN(dt.getTime())) scheduledAt = dt.toISOString();\n  } else if (/\\bagend|\\bamanha\\b/.test(value) && /\\bamanha\\b/.test(value) && timeMatch) {\n    const dt = new Date();\n    dt.setDate(dt.getDate() + 1);\n    dt.setHours(Number(timeMatch[1]), Number(timeMatch[2]), 0, 0);\n    scheduledAt = dt.toISOString();\n  }`;
  const newFacts = `  const dateMatch = raw.match(/\\b(\\d{1,2})[\\/.-](\\d{1,2})(?:[\\/.-](\\d{2,4}))\\b/);\n  const explicitTimeMatch = raw.match(/\\b(?:[aà]s?\\s*)?(\\d{1,2})(?::(\\d{2})|h(?:\\s*(\\d{2}))?)\\b/i);\n  const relativeTimeMatch = raw.match(/\\b(?:amanh[ãa]|hoje)(?:\\s+(?:[aà]s?))?\\s*(\\d{1,2})(?:(?::|h)\\s*(\\d{1,2}))?\\b/i);\n  const timeMatch = relativeTimeMatch || explicitTimeMatch;\n  let scheduledAt = null;\n  const saoPauloDateParts = (date = new Date()) => {\n    const parts = new Intl.DateTimeFormat('en-CA', {\n      timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',\n    }).formatToParts(date);\n    const get = (type) => parts.find((part) => part.type === type)?.value || '';\n    return { year: Number(get('year')), month: Number(get('month')), day: Number(get('day')) };\n  };\n  const toSaoPauloIso = ({ year, month, day, hour = 0, minute = 0 }) => {\n    const pad = (n) => String(n).padStart(2, '0');\n    const value = new Date(\`${'${year}'}-${'${pad(month)}'}-${'${pad(day)}'}T${'${pad(hour)}'}:${'${pad(minute)}'}:00-03:00\`);\n    return Number.isNaN(value.getTime()) ? null : value.toISOString();\n  };\n  if (/\\bagend/.test(value) && dateMatch) {\n    const nowParts = saoPauloDateParts();\n    const year = Number(dateMatch[3] || nowParts.year);\n    const fullYear = year < 100 ? 2000 + year : year;\n    const hh = Number(timeMatch?.[1] || 0), mm = Number(timeMatch?.[2] || timeMatch?.[3] || 0);\n    scheduledAt = toSaoPauloIso({ year: fullYear, month: Number(dateMatch[2]), day: Number(dateMatch[1]), hour: hh, minute: mm });\n  } else if (/\\bamanha\\b/.test(value) && timeMatch) {\n    const current = saoPauloDateParts();\n    const noonUtc = new Date(Date.UTC(current.year, current.month - 1, current.day, 12, 0, 0));\n    noonUtc.setUTCDate(noonUtc.getUTCDate() + 1);\n    const next = saoPauloDateParts(noonUtc);\n    const hh = Number(timeMatch[1] || 0), mm = Number(timeMatch[2] || timeMatch[3] || 0);\n    scheduledAt = toSaoPauloIso({ ...next, hour: hh, minute: mm });\n  } else if (/\\bhoje\\b/.test(value) && timeMatch) {\n    const current = saoPauloDateParts();\n    const hh = Number(timeMatch[1] || 0), mm = Number(timeMatch[2] || timeMatch[3] || 0);\n    scheduledAt = toSaoPauloIso({ ...current, hour: hh, minute: mm });\n  }`;
  if (!source.includes(oldFacts)) throw new Error('operational_schedule_anchor_missing');
  return source.replace(oldFacts, newFacts);
});

await patchFile('tools/vercel-whatsapp-worker.mjs', (source) => {
  const oldHandler = `async function handleScheduledRuntime(msg, groupName, readableText, context) {\n  const call = context.recentCall;`;
  const newHandler = `async function handleScheduledRuntime(msg, groupName, readableText, context) {\n  // Follow-up temporal curto (ex.: \"AMANHA AS 7\") pertence à cotação aberta\n  // mais recente do grupo, e não a uma corrida antiga atualizada pelo rastreador.\n  const pendingCall = pendingAuthorizationCallForGroup(context.management?.calls || [], msg.from);\n  const call = pendingCall || context.recentCall;`;
  if (!source.includes(oldHandler)) throw new Error('scheduled_handler_anchor_missing');
  return source.replace(oldHandler, newHandler);
});

console.log('CONTEXT_FOLLOWUPS_PATCH_OK');
