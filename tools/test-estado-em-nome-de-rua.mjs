// Nomes de estado aparecem como nome de rua nas fichas reais das centrais.
// Tratar isso como estado recusava atendimento valido dentro de MG.
import assert from 'node:assert/strict';
import fs from 'node:fs';

const fonte = fs.readFileSync(new URL('./vercel-whatsapp-worker.mjs', import.meta.url), 'utf8');
const trecho = fonte.slice(fonte.indexOf('const BRAZIL_STATE_BY_NAME'), fonte.indexOf('function normalizeAddressForLookup('));
const normalizeForIntent = (value = '') => String(value)
  .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/\b(?:[a-z]\s+){2,}[a-z]\b/g, (m) => m.replace(/\s+/g, ''))
  .replace(/\s+/g, ' ').trim();
const detectBrazilState = new Function('normalizeForIntent', `${trecho}\nreturn detectBrazilState;`)(normalizeForIntent);

// Enderecos reais dos exports que estavam sendo recusados.
const dentroDeMg = [
  ['Av mato grosso 266 vila universal betim MG', 'MG'],
  ['Destino: RUA MATO GROSSO , nº 340, SAO CAETANO, CONTAGEM - MG', 'MG'],
  ['Origem: Rua Pará de Minas, nº 29, Centro , BETIM - MG', 'MG'],
  ['Destino: RUA PARA DE MINAS, nº 964, SAO BENEDITO, SANTA LUZIA - MG', 'MG'],
  ['ORIGEM: RUA SAO PAULO - BAIRRO: SANTO AFONSO, CIDADE: BETIM, ESTADO: MINAS GERAIS', 'MG'],
  ['ORIGEM: RUA GOIAS 162 BAIRRO: SANTO ANTONIO , CIDADE: JUATUBA, ESTADO: MINAS GERAIS', 'MG'],
  ['Serra Verde, Belo Horizonte - MG, 31749-185', 'MG'],
  ['guincho para Betim - MG', 'MG'],
];
for (const [endereco, esperado] of dentroDeMg) {
  const uf = detectBrazilState(endereco);
  // Vazio tambem serve: sem estado explicito o endereco segue para o geocoder
  // em vez de ser recusado. O que nao pode e apontar um estado que nao e MG.
  assert.ok(uf === esperado || uf === '', `${endereco} -> ${uf}, recusaria atendimento valido`);
}

// Fora de MG continua sendo detectado e recusado.
for (const [endereco, esperado] of [
  ['Rua das Palmeiras, 100, Centro, Vitória - ES', 'ES'],
  ['Rua X, 50, Campinas - SP', 'SP'],
  ['Avenida Brasil, 200, Belém, Para', 'PA'],
  ['Rua Y, 10, Campo Grande, Mato Grosso do Sul', 'MS'],
  ['Rua Z, 10, Cuiaba, Mato Grosso', 'MT'],
]) {
  assert.equal(detectBrazilState(endereco), esperado, `${endereco} deveria ser ${esperado}`);
}

console.log(`OK: ${dentroDeMg.length} enderecos de MG liberados, 5 de fora ainda recusados.`);
