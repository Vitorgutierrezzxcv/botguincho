from pathlib import Path

p = Path('public/index.html')
s = p.read_text(encoding='utf-8')

# Bust old PWA/browser cache for the V2 assets.
s = s.replace('/acionador-tratto-v2.css?v=3', '/acionador-tratto-v2.css?v=4')
s = s.replace('/acionador-tratto-v2.js?v=3', '/acionador-tratto-v2.js?v=4')

css_tag = '<link rel="stylesheet" href="/acionador-mobile-v4.css?v=1">'
if css_tag not in s:
    marker = '<link rel="stylesheet" href="/acionador-tratto-v2.css?v=4">'
    if marker not in s:
        raise SystemExit('V2 CSS marker not found')
    s = s.replace(marker, marker + css_tag, 1)

js_tag = '<script src="/acionador-mobile-v4.js?v=1"></script>'
if js_tag not in s:
    marker = '<script src="/acionador-tratto-v2.js?v=4"></script>'
    if marker not in s:
        raise SystemExit('V2 JS marker not found')
    s = s.replace(marker, marker + js_tag, 1)

p.write_text(s, encoding='utf-8')
print('Mobile V4 activated')
