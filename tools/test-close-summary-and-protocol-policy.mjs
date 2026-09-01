import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync(new URL('./vercel-whatsapp-worker.mjs', import.meta.url), 'utf8');
assert.match(worker, /Veículo: \${vehicle/);
assert.match(worker, /Origem: \${origin}/);
assert.match(worker, /Destino: \${destination}/);
assert.match(worker, /Valor do serviço:/);
assert.match(worker, /Adicionais confirmados:/);
assert.match(worker, /Valor final:/);
assert.match(worker, /protocolo formal sem correspondencia nao autoriza nada sozinho/i);
assert.match(worker, /await handleQuoteRuntime\(msg, groupName, readableText, null/);
console.log('CLOSE_SUMMARY_PROTOCOL_POLICY_OK');
