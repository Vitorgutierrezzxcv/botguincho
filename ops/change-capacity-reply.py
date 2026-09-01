from pathlib import Path

path = Path('tools/vercel-whatsapp-worker.mjs')
text = path.read_text()
old = "'Indisponível no momento.'"
new = "'Motorista fora de rota.'"
count = text.count(old)
if count == 0:
    raise SystemExit('Nenhuma resposta de capacidade encontrada para alterar.')
text = text.replace(old, new)
path.write_text(text)
print(f'Alteradas {count} resposta(s) de capacidade.')
