from pathlib import Path

worker = Path('tools/vercel-whatsapp-worker.mjs')
s = worker.read_text()

old = """    const line = lines[index];
    const normalized = normalizeForIntent(line);
    const normalizedMatch = normalized.match(pattern);
"""
new = """    const line = lines[index];
    // As centrais usam negrito do WhatsApp nos rotulos, ex. *ENDEREÇO ORIGEM:*.
    // O markdown nao faz parte do endereco e nao pode impedir o reconhecimento do campo.
    const lineWithoutWhatsAppMarkup = line.replace(/[*_~`]/g, '');
    const normalized = normalizeForIntent(lineWithoutWhatsAppMarkup);
    const normalizedMatch = normalized.match(pattern);
"""
if s.count(old) != 1:
    raise SystemExit(f'extractLabeledField normalize: esperado 1, encontrado {s.count(old)}')
s = s.replace(old, new, 1)

old = """      const inlineValue = line.replace(labelRegex, '').trim();
      if (inlineValue) return inlineValue;
"""
new = """      const inlineValue = lineWithoutWhatsAppMarkup.replace(labelRegex, '').trim();
      if (inlineValue) return inlineValue;
"""
if s.count(old) != 1:
    raise SystemExit(f'extractLabeledField inline: esperado 1, encontrado {s.count(old)}')
s = s.replace(old, new, 1)

old = """function cleanAddressQuery(value = '') {
  return String(value)
    .replace(/\\bref\\.?\\s*:.*$/i, '')
"""
new = """function cleanAddressQuery(value = '') {
  return String(value)
    // Remove apenas formatacao/rótulos administrativos da ficha; preserva o endereco.
    .replace(/[*_~`]/g, '')
    .replace(/\\b(?:BAIRRO|CIDADE|ESTADO|PA[IÍ]S|PAS)\\s*:\\s*/gi, '')
    .replace(/\\bref\\.?\\s*:.*$/i, '')
"""
if s.count(old) != 1:
    raise SystemExit(f'cleanAddressQuery: esperado 1, encontrado {s.count(old)}')
s = s.replace(old, new, 1)
worker.write_text(s)

knowledge = Path('tools/operational-knowledge.mjs')
t = knowledge.read_text()
old = """function labeled(text, labels = []) {
  const raw = String(text || '').replace(/\\r/g, '');
"""
new = """function labeled(text, labels = []) {
  // O WhatsApp envia rotulos em negrito como *MODELO:* e *ENDEREÇO ORIGEM:*.
  // A formatacao nao deve fazer parte do valor nem quebrar o parser.
  const raw = String(text || '').replace(/\\r/g, '').replace(/[*_~`]/g, '');
"""
if t.count(old) != 1:
    raise SystemExit(f'operational labeled: esperado 1, encontrado {t.count(old)}')
t = t.replace(old, new, 1)

marker = """export function extractOperationalFacts(text = '') {
"""
helper = """function cleanStructuredAddressValue(value = '') {
  return String(value || '')
    .replace(/[*_~`]/g, '')
    .replace(/\\bref\\.?\\s*:.*$/i, '')
    .replace(/\\b(?:BAIRRO|CIDADE|ESTADO|PA[IÍ]S|PAS)\\s*:\\s*/gi, '')
    .replace(/\\s*,\\s*/g, ', ')
    .replace(/\\s+/g, ' ')
    .replace(/(?:,\\s*)+$/g, '')
    .trim();
}

"""
if t.count(marker) != 1:
    raise SystemExit(f'extractOperationalFacts marker: esperado 1, encontrado {t.count(marker)}')
t = t.replace(marker, helper + marker, 1)

old = """  const origin = labeled(raw, ['ORIGEM', 'ENDERE[CÇ]O\\\\s*ORIGEM']);
  const destination = labeled(raw, ['DESTINO', 'ENDERE[CÇ]O\\\\s*DESTINO']);
"""
new = """  const origin = cleanStructuredAddressValue(labeled(raw, ['ORIGEM', 'ENDERE[CÇ]O\\\\s*ORIGEM']));
  const destination = cleanStructuredAddressValue(labeled(raw, ['DESTINO', 'ENDERE[CÇ]O\\\\s*DESTINO']));
"""
if t.count(old) != 1:
    raise SystemExit(f'origin/destination facts: esperado 1, encontrado {t.count(old)}')
t = t.replace(old, new, 1)
knowledge.write_text(t)

Path('tools/test-whatsapp-address-fields.mjs').write_text(r'''import assert from 'node:assert/strict';
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
''')
