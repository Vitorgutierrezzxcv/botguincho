import fs from 'node:fs';

const file = 'tools/vercel-whatsapp-worker.mjs';
let source = fs.readFileSync(file, 'utf8');

const importNeedle = "import { normalizeAddressInput } from './address-normalization.mjs';";
const importReplacement = `${importNeedle}\nimport { detectBrazilStateFromAddress } from './address-state-detection.mjs';`;
if (!source.includes("./address-state-detection.mjs")) {
  if (!source.includes(importNeedle)) throw new Error('Import anchor not found');
  source = source.replace(importNeedle, importReplacement);
}

const callNeedle = 'const explicitState = detectBrazilState(query);';
const occurrences = source.split(callNeedle).length - 1;
if (occurrences !== 1) throw new Error(`Expected exactly one geocode state detection call, found ${occurrences}`);
source = source.replace(callNeedle, 'const explicitState = detectBrazilStateFromAddress(query);');

fs.writeFileSync(file, source);
console.log('SAFE_STATE_DETECTION_APPLIED');
