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

const mateusLemeCase = `*MODELO:* VW - VOLKSWAGEN/GOL SPECIAL 1.0 TOTAL FLEX 8V 5P
*SERVIÇOS:*
*ENDEREÇO ORIGEM:* RUA DOIS 85, BAIRRO: NOSSA SENHORA DE FATIMA, CIDADE: MATEUS LEME, ESTADO: MG, PAS: BRASIL, REF: CASA04 1 pessoa acompanha
*ENDEREÇO DESTINO:* RUA IGNES MARIA 326, BAIRRO: BETIM INDUSTRIAL, CIDADE: BETIM, ESTADO: MG, PAS: BRASIL, REF: CASA04 1 pessoa acompanha`;
const mateusFacts = extractOperationalFacts(mateusLemeCase);
assert.equal(mateusFacts.origin, 'RUA DOIS 85, NOSSA SENHORA DE FATIMA, MATEUS LEME, MG, BRASIL');
assert.equal(mateusFacts.destination, 'RUA IGNES MARIA 326, BETIM INDUSTRIAL, BETIM, MG, BRASIL');
assert.doesNotMatch(mateusFacts.origin, /BAIRRO:|CIDADE:|ESTADO:|PAS:/i);

// Garante que o caminho de rota tambem remove markdown e rotulos antes do geocoder.
const workerSource = fs.readFileSync(new URL('./vercel-whatsapp-worker.mjs', import.meta.url), 'utf8');
assert.match(workerSource, /lineWithoutWhatsAppMarkup/);
assert.match(workerSource, /normalizeAddressInput/);
assert.match(workerSource, /Rastreador do guincho sem atualização recente/);
assert.doesNotMatch(workerSource, /Não consegui localizar a origem com precisão suficiente/);

console.log('WHATSAPP_ADDRESS_FIELDS_OK');
