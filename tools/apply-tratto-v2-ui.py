from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INDEX = ROOT / 'public' / 'index.html'
s = INDEX.read_text(encoding='utf-8')

css = '<link rel="stylesheet" href="/acionador-tratto-v2.css?v=2">'
js = '<script src="/acionador-tratto-v2.js?v=2"></script>'

if css not in s:
    s = s.replace('</head>', css + '</head>', 1)
if js not in s:
    s = s.replace('</body>', js + '</body>', 1)

INDEX.write_text(s, encoding='utf-8')
print('Trattor V2 UI enabled.')
