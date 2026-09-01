from pathlib import Path

path = Path('tools/vercel-whatsapp-worker.mjs')
s = path.read_text()

old_import = "import { sanitizeExcludedAreas, matchExcludedArea } from './excluded-areas.mjs';"
new_import = "import { extractLabeledAddressBlock, sanitizeExcludedAreas, matchExcludedArea } from './excluded-areas.mjs';"
if new_import not in s:
    if old_import not in s:
        raise SystemExit('import marker missing')
    s = s.replace(old_import, new_import, 1)

replacements = [
    (
        "  const originAddress = extractLabeledField(readableText, 'Origem') || facts.origin || enderecoEmTextoLivre(readableText) || null;\n  const destinationAddress = extractLabeledField(readableText, 'Destino') || facts.destination || null;",
        "  const originAddress = extractLabeledAddressBlock(readableText, 'Origem') || facts.origin || extractLabeledField(readableText, 'Origem') || enderecoEmTextoLivre(readableText) || null;\n  const destinationAddress = extractLabeledAddressBlock(readableText, 'Destino') || facts.destination || extractLabeledField(readableText, 'Destino') || null;",
    ),
    (
        "  const originAddress = extractLabeledField(text, 'Origem') || facts.origin || enderecoEmTextoLivre(text) || pending?.origin || null;\n  const destinationAddress = extractLabeledField(text, 'Destino') || facts.destination || pending?.destination || null;",
        "  const originAddress = extractLabeledAddressBlock(text, 'Origem') || facts.origin || extractLabeledField(text, 'Origem') || enderecoEmTextoLivre(text) || pending?.origin || null;\n  const destinationAddress = extractLabeledAddressBlock(text, 'Destino') || facts.destination || extractLabeledField(text, 'Destino') || pending?.destination || null;",
    ),
    (
        "  const originAddress = extractLabeledField(readableText, 'Origem');\n  const destinationAddress = extractLabeledField(readableText, 'Destino');",
        "  const originAddress = extractLabeledAddressBlock(readableText, 'Origem') || extractLabeledField(readableText, 'Origem');\n  const destinationAddress = extractLabeledAddressBlock(readableText, 'Destino') || extractLabeledField(readableText, 'Destino');",
    ),
]

for old, new in replacements:
    if new in s:
        continue
    if old not in s:
        raise SystemExit(f'marker missing: {old[:100]}')
    s = s.replace(old, new, 1)

path.write_text(s)
