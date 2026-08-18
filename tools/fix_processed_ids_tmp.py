from pathlib import Path
p=Path('tools/vercel-whatsapp-worker.mjs')
s=p.read_text()
needle='const routeProviderState = new Map();\n'
if 'const processedMessageIds = new Map();' not in s:
    if needle not in s: raise SystemExit('marker not found')
    s=s.replace(needle, needle+'const processedMessageIds = new Map();\n',1)
p.write_text(s)
print('ok')
