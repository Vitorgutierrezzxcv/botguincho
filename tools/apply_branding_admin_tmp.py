from pathlib import Path

# Carrega a identidade dinâmica em todas as telas HTML oficiais.
for path in [Path('index.html'), Path('qr.html'), *Path('public').glob('*.html')]:
    if not path.exists():
        continue
    s = path.read_text(encoding='utf-8')
    if 'src="/branding.js"' not in s:
        s = s.replace('</body>', '<script src="/branding.js" defer></script></body>')
    if path.name == 'master.html':
        if 'branding-admin.css' not in s:
            s = s.replace('</head>', '<link rel="stylesheet" href="/branding-admin.css"></head>')
        if 'src="/branding-admin.js"' not in s:
            s = s.replace('</body>', '<script src="/branding-admin.js" defer></script></body>')
    s = s.replace('href="/manifest.webmanifest"', 'href="/api/branding/manifest"')
    s = s.replace('<link rel="apple-touch-icon" href="/icon.svg">', '<link rel="apple-touch-icon" href="/api/branding/asset?kind=app_icon">')
    s = s.replace('<link rel="icon" href="/icon.svg">', '<link rel="icon" href="/api/branding/asset?kind=favicon">')
    path.write_text(s, encoding='utf-8')

# Atualiza o cache do PWA e inclui o runtime de identidade.
for path in [Path('sw.js'), Path('public/sw.js')]:
    if not path.exists():
        continue
    s = path.read_text(encoding='utf-8')
    s = s.replace('central-guincho-pwa-v21', 'acionador-pwa-v22')
    if "'/branding.js'" not in s:
        s = s.replace("'/icon.svg'", "'/icon.svg','/branding.js'")
    path.write_text(s, encoding='utf-8')

print('Central de personalização integrada.')
