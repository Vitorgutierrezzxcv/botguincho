import fs from 'node:fs/promises';

const file = new URL('./ai-operational-fallback.mjs', import.meta.url);
const testFile = new URL('./test-ai-operational-fallback.mjs', import.meta.url);

let source = await fs.readFile(file, 'utf8');
const before = `  if (intent === 'other' || intent === 'incomplete_dispatch') return true;\n  if (!facts?.origin || !facts?.destination || !facts?.vehicleType) return true;\n  if (messyStructuredMessage(text)) return true;\n  return false;`;
const after = `  if (intent === 'other' || intent === 'incomplete_dispatch') return true;\n  if (!facts?.origin || !facts?.destination || !facts?.vehicleType) return true;\n  // Se o parser deterministico ja reconheceu uma cotacao completa, nao gastamos\n  // tempo nem credito com IA apenas por causa de ruido como \"nº -\". O endereco\n  // passa pelo normalizador/geocoder; a IA continua sendo fallback quando faltar dado.\n  if (intent === 'quote') return false;\n  if (messyStructuredMessage(text)) return true;\n  return false;`;
if (!source.includes(before)) throw new Error('Trecho esperado do fallback nao encontrado');
source = source.replace(before, after);
await fs.writeFile(file, source);

let test = await fs.readFile(testFile, 'utf8');
test = test.replace(
  `assert.equal(shouldUseAiOperationalFallback({ text: messy, facts: deterministicFacts, intent: 'quote' }), true);`,
  `assert.equal(shouldUseAiOperationalFallback({ text: messy, facts: deterministicFacts, intent: 'quote' }), false, 'cotacao deterministica completa deve usar fast path sem IA');\nassert.equal(shouldUseAiOperationalFallback({ text: messy, facts: { ...deterministicFacts, origin: '' }, intent: 'quote' }), true, 'faltando origem deve usar IA');`,
);
await fs.writeFile(testFile, test);

console.log('AI_FAST_PATH_APPLIED');
