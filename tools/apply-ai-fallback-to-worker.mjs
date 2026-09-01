import fs from 'node:fs/promises';

const file = 'tools/vercel-whatsapp-worker.mjs';
let source = await fs.readFile(file, 'utf8');

const importNeedle = "import { normalizeAddressInput } from './address-normalization.mjs';";
const importReplacement = `${importNeedle}\nimport { maybeInterpretOperationalMessage } from './ai-operational-fallback.mjs';`;
if (!source.includes("./ai-operational-fallback.mjs")) {
  if (!source.includes(importNeedle)) throw new Error('import anchor not found');
  source = source.replace(importNeedle, importReplacement);
}

const oldContext = `  const facts = extractOperationalFacts(text);\n  const provisionalIntent = classifyRuntimeIntent(text, groupName, provisionalRecentCall);\n  const recentCall = provisionalIntent === 'closure'\n    ? (oldestActiveManagementCallForGroup(management, groupId) || provisionalRecentCall)\n    : provisionalRecentCall;\n  const intent = classifyRuntimeIntent(text, groupName, recentCall);\n  return { management, recentCall, knowledge, approvedRules, commercialRuleSource: commercialResolution.source, billingProfile, facts, intent, profile: resolveGroupProfile(groupName) };`;

const newContext = `  const deterministicFacts = extractOperationalFacts(text);\n  const provisionalIntent = classifyRuntimeIntent(text, groupName, provisionalRecentCall);\n  const recentCall = provisionalIntent === 'closure'\n    ? (oldestActiveManagementCallForGroup(management, groupId) || provisionalRecentCall)\n    : provisionalRecentCall;\n  const deterministicIntent = classifyRuntimeIntent(text, groupName, recentCall);\n  const aiInterpretation = await maybeInterpretOperationalMessage({\n    text,\n    groupName,\n    facts: deterministicFacts,\n    intent: deterministicIntent,\n  });\n  const facts = aiInterpretation?.facts || deterministicFacts;\n  const intent = aiInterpretation?.intent || deterministicIntent;\n  if (aiInterpretation?.meta?.used) {\n    logEvent('ai_fallback', 'Mensagem operacional normalizada pela IA', {\n      groupId,\n      groupName,\n      model: aiInterpretation.meta.model,\n      confidence: aiInterpretation.meta.confidence,\n      dailyCall: aiInterpretation.meta.dailyCall,\n      dailyLimit: aiInterpretation.meta.dailyLimit,\n      inputTokens: aiInterpretation.meta.inputTokens,\n      outputTokens: aiInterpretation.meta.outputTokens,\n    });\n  }\n  return { management, recentCall, knowledge, approvedRules, commercialRuleSource: commercialResolution.source, billingProfile, facts, intent, profile: resolveGroupProfile(groupName), aiFallback: aiInterpretation?.meta || null };`;

if (!source.includes('const deterministicFacts = extractOperationalFacts(text);')) {
  if (!source.includes(oldContext)) throw new Error('operational context anchor not found');
  source = source.replace(oldContext, newContext);
}

await fs.writeFile(file, source);
console.log('AI_FALLBACK_WORKER_PATCH_OK');
