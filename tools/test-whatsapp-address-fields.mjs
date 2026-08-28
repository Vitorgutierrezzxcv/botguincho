import assert from 'node:assert/strict';
import fs from 'node:fs';
import { extractOperationalFacts } from './operational-knowledge.mjs';

const realFailedQuote = `*MODELO:* FIAT/UNO MILLE 1.0 FIRE/ F.FLEX/ ECONOMY 4P
*SERVIÇOS:* REBOQUE LEVE
*ENDEREÇO ORIGEM:* RUA MADEIRA 75, BAIRRO: SAO CRISTOVAO, CIDADE: BETIM, ESTADO: MG, PAS: BRASIL, REF: CHASSI GABARITO
*ENDEREÇO DESTINO:* RUA MARTE 297, BAIRRO: JARDIM RIACHO DAS PEDRAS, CIDADE: CONTAGEM, ESTADO: MG, PAS: BRASIL, REF: PREDIO DA TOP`;

const facts = extractOperationalFacts(realFailedQuote);
assert.equal(facts.origin, 'RUA MADEIRA 75, SAO CRISTOVAO, BETIM, MG, BRASIL');
assert.equal(facts.destination, 'RUA MARTE 297, JARDIM RIACHO DAS PEDRAS, CONTAGEM, MG, BRASIL');
assert.match(String(facts.vehicle || ''), /FIAT\/UNO/i);
assert.doesNotMatch(facts.origin, /[*]|BAIRRO:|CIDADE:|ESTADO:|PAS:/i);
assert.doesNotMatch(facts.destination, /[*]|BAIRRO:|CIDADE:|ESTADO:|PAS:/i);

// Garante que o caminho de rota tambem remove markdown e rotulos antes do geocoder.
const workerSource = fs.readFileSync(new URL('./vercel-whatsapp-worker.mjs', import.meta.url), 'utf8');
assert.match(workerSource, /lineWithoutWhatsAppMarkup/);
assert.match(workerSource, /BAIRRO\|CIDADE\|ESTADO\|PA\[IÍ\]S\|PAS/);

console.log('WHATSAPP_ADDRESS_FIELDS_OK');
