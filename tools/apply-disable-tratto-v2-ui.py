from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INDEX = ROOT / 'public/index.html'
s = INDEX.read_text(encoding='utf-8')
s = s.replace('<link rel="stylesheet" href="/acionador-tratto-v2.css?v=2">', '')
s = s.replace('<script src="/acionador-tratto-v2.js?v=2"></script>', '')
INDEX.write_text(s, encoding='utf-8')
print('Tratto V2 UI activation disabled; stable UI restored.')
