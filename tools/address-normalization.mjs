export function normalizeAddressInput(value = '') {
  return String(value)
    .replace(/[*_~`]/g, '')
    .replace(/\b(?:BAIRRO|CIDADE|ESTADO|PA[IÍ]S|PAS)\s*:\s*/gi, '')
    .replace(/\bref\.?\s*:.*$/i, '')
    // Centrais enviam muito "nº -", "s/n" e "sem número". Esses marcadores
    // significam ausência de número e não podem virar um hífen solto na busca.
    .replace(/\b(?:n[uú]mero|numero|nro\.?|num\.?|n[º°])\s*[:#]?\s*(?:-|s\/?n|sem\s+n[uú]mero)\s*,?/gi, '')
    .replace(/(?:^|,)\s*(?:-|s\/?n|sem\s+n[uú]mero)\s*(?=,|$)/gi, '')
    .replace(/\bn[º°]\s*/gi, '')
    .replace(/[?]+$/g, '')
    .replace(/\s*,\s*,+/g, ', ')
    .replace(/^\s*,|,\s*$/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+[–—-]\s+/g, ' - ')
    .trim();
}
