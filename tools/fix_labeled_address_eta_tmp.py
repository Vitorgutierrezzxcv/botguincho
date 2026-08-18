from pathlib import Path
p=Path('tools/vercel-whatsapp-worker.mjs')
s=p.read_text()
helper=r'''function normalizeLabeledBrazilAddress(value = '') {
  return cleanAddressQuery(value)
    .replace(/\bBAIRRO\s*:\s*/gi, ', ')
    .replace(/\bCIDADE\s*:\s*/gi, ', ')
    .replace(/\bESTADO\s*:\s*/gi, ', ')
    .replace(/\b(?:PA[IÍ]S|PAS)\s*:\s*BRASIL\b/gi, '')
    .replace(/\s*,\s*,+/g, ', ')
    .replace(/\s+-\s*,/g, ',')
    .replace(/,\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

'''
marker='function parseBrazilAddress(address = \'\') {\n  const query = cleanAddressQuery(address);'
replacement="function parseBrazilAddress(address = '') {\n  const query = normalizeLabeledBrazilAddress(address);"
if helper not in s:
    idx=s.find("function parseBrazilAddress(address = '') {")
    if idx < 0: raise SystemExit('parseBrazilAddress not found')
    s=s[:idx]+helper+s[idx:]
if marker in s:
    s=s.replace(marker,replacement,1)
elif replacement not in s:
    raise SystemExit('parseBrazilAddress query line not found')
p.write_text(s)
print('patched')
