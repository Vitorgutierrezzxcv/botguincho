from pathlib import Path
p=Path('public/index.html')
s=p.read_text()
link='<link rel="stylesheet" href="/acionador-operation-v13.css?v=13">'
if 'acionador-operation-v13.css' not in s:
    s=s.replace('</head>', link+'\n</head>')
else:
    import re
    s=re.sub(r'<link rel="stylesheet" href="/acionador-operation-v13\.css\?v=\d+">', link, s)
p.write_text(s)
