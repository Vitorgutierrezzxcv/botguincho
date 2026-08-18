from pathlib import Path
p=Path('tools/vercel-whatsapp-worker.mjs')
s=p.read_text()
old=".replace(/\\b(?:PA[IÍ]S|PAS)\\s*:\\s*BRASIL\\b/gi, '')"
new=".replace(/\\b(?:PA[IÍ]S|PAS)\\s*:\\s*(?:BRASIL)?/gi, '')"
if old not in s:
    raise SystemExit('PAS normalization line not found')
s=s.replace(old,new,1)
p.write_text(s)
print('patched')
