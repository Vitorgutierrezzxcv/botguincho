const STATE_CODES = new Set([
  'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO',
]);

const STATE_NAMES = new Map([
  ['ACRE','AC'],['ALAGOAS','AL'],['AMAPA','AP'],['AMAZONAS','AM'],['BAHIA','BA'],['CEARA','CE'],
  ['DISTRITO FEDERAL','DF'],['ESPIRITO SANTO','ES'],['GOIAS','GO'],['MARANHAO','MA'],['MATO GROSSO DO SUL','MS'],
  ['MATO GROSSO','MT'],['MINAS GERAIS','MG'],['PARAIBA','PB'],['PARANA','PR'],['PERNAMBUCO','PE'],['PIAUI','PI'],
  ['RIO DE JANEIRO','RJ'],['RIO GRANDE DO NORTE','RN'],['RIO GRANDE DO SUL','RS'],['RONDONIA','RO'],['RORAIMA','RR'],
  ['SANTA CATARINA','SC'],['SAO PAULO','SP'],['SERGIPE','SE'],['TOCANTINS','TO'],
  // Para e ambiguo em texto corrido; so sera aceito pelas regras de posicao/rotulo abaixo.
  ['PARA','PA'],
]);

function normalize(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[‐‑‒–—−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function validCode(value) {
  const code = String(value || '').toUpperCase();
  return STATE_CODES.has(code) ? code : null;
}

export function detectBrazilStateFromAddress(value = '') {
  const text = normalize(value);
  if (!text) return null;

  // Formas explicitas: "ESTADO: MG" / "UF MG".
  const labeledCode = text.match(/(?:^|[\s,;|])(?:ESTADO|UF)\s*[:=\-]?\s*([A-Z]{2})(?=$|[\s,;|])/);
  if (labeledCode) return validCode(labeledCode[1]);

  // Sigla em posicao de endereco: "Betim - MG", "Contagem/MG", ", MG,".
  const separatedCode = text.match(/(?:^|[,;|\/]|\s-\s)\s*([A-Z]{2})\s*(?=$|[,;|])/);
  if (separatedCode) {
    const code = validCode(separatedCode[1]);
    if (code) return code;
  }

  // Sigla ao final, inclusive "Betim MG".
  const trailingCode = text.match(/(?:^|\s)([A-Z]{2})\s*$/);
  if (trailingCode) {
    const code = validCode(trailingCode[1]);
    if (code) return code;
  }

  // Nome do estado em rotulo ou apos separador. Evita interpretar palavras comuns
  // no meio do logradouro como estados.
  for (const [name, code] of [...STATE_NAMES.entries()].sort((a, b) => b[0].length - a[0].length)) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const labeled = new RegExp(`(?:ESTADO|UF)\\s*[:=\\-]?\\s*${escaped}(?=$|[,;|])`);
    const separated = new RegExp(`(?:^|[,;|\\/]|\\s-\\s)\\s*${escaped}\\s*(?=$|[,;|.])`);
    const trailing = new RegExp(`(?:^|\\s)${escaped}\\s*[.]?$`);
    if (labeled.test(text) || separated.test(text) || trailing.test(text)) return code;
  }

  return null;
}
