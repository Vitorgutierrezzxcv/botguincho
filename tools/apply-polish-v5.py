from pathlib import Path
p=Path('public/index.html')
s=p.read_text()
needle='<link rel="stylesheet" href="/acionador-mobile-v4.css?v=1">'
link='<link rel="stylesheet" href="/acionador-polish-v5.css?v=1">'
if link not in s:
    if needle not in s:
        raise SystemExit('mobile v4 stylesheet marker not found')
    s=s.replace(needle, needle+link)
p.write_text(s)
