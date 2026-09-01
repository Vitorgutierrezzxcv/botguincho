import fs from 'node:fs/promises';

const indexPath = 'tools/training-runtime-index.mjs';
let indexSource = await fs.readFile(indexPath, 'utf8');
if (!indexSource.includes('export function historicalExamplesForAi')) {
  indexSource += `\n\nexport function historicalExamplesForAi(text = '', groupName = '', limit = 4) {\n  const value = norm(text);\n  if (!value) return [];\n  const max = Math.min(6, Math.max(1, Number(limit) || 4));\n  const seen = new Set();\n  return ENTRIES\n    .map((entry) => {\n      const phrase = norm(entry.phrase);\n      const sameGroup = groupMatchScore(groupName, entry.group);\n      const exact = value === phrase;\n      const contained = Math.min(value.length, phrase.length) >= 4 && (value.includes(phrase) || phrase.includes(value));\n      const lexical = exact ? 1 : contained ? 0.94 : Math.max(dice(value, phrase), tokenCoverage(value, phrase));\n      return { ...entry, score: Math.min(1, lexical * 0.78 + sameGroup * 0.22) };\n    })\n    .filter((entry) => entry.score >= 0.34)\n    .sort((a, b) => b.score - a.score)\n    .filter((entry) => {\n      const key = \`${'${entry.intent}'}:${'${norm(entry.phrase)}'}\`;\n      if (seen.has(key)) return false;\n      seen.add(key);\n      return true;\n    })\n    .slice(0, max)\n    .map(({ group, intent, phrase, score }) => ({ group, intent, phrase, score: Math.round(score * 100) / 100 }));\n}\n`;
  await fs.writeFile(indexPath, indexSource);
}

const aiPath = 'tools/ai-operational-fallback.mjs';
let aiSource = await fs.readFile(aiPath, 'utf8');
const importAnchor = `import { normalizeAddressInput } from './address-normalization.mjs';`;
if (!aiSource.includes(`historicalExamplesForAi`)) {
  if (!aiSource.includes(importAnchor)) throw new Error('ai_import_anchor_missing');
  aiSource = aiSource.replace(importAnchor, `${importAnchor}\nimport { historicalExamplesForAi } from './training-runtime-index.mjs';`);

  const timeoutAnchor = `  const timeout = clampInt(process.env.OPENAI_FALLBACK_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 1000, 10000);\n  const openai = new OpenAI({ apiKey, baseURL });`;
  const timeoutReplacement = `  const timeout = clampInt(process.env.OPENAI_FALLBACK_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 1000, 10000);\n  const historicalExamples = historicalExamplesForAi(text, groupName, 4);\n  const examplesInstruction = historicalExamples.length\n    ? ['Exemplos anonimizados de linguagem real já observada (use apenas como referência de intenção):', ...historicalExamples.map((item) => \`- ${'${item.intent}'}: ${'${item.phrase}'}\`)].join('\\n')\n    : '';\n  const openai = new OpenAI({ apiKey, baseURL });`;
  if (!aiSource.includes(timeoutAnchor)) throw new Error('ai_timeout_anchor_missing');
  aiSource = aiSource.replace(timeoutAnchor, timeoutReplacement);

  const groupAnchor = `      'Classifique intenção apenas entre as opções do schema.',\n      \`Grupo WhatsApp: ${'${safeText(groupName, 120)'} || 'não informado'}.\`,`;
  const groupReplacement = `      'Classifique intenção apenas entre as opções do schema.',\n      examplesInstruction,\n      \`Grupo WhatsApp: ${'${safeText(groupName, 120)'} || 'não informado'}.\`,`;
  if (!aiSource.includes(groupAnchor)) throw new Error('ai_instruction_anchor_missing');
  aiSource = aiSource.replace(groupAnchor, groupReplacement);
  await fs.writeFile(aiPath, aiSource);
}

console.log('HISTORICAL_AI_EXAMPLES_PATCH_OK');
