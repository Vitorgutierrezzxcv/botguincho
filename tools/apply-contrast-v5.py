from pathlib import Path
p=Path('public/index.html')
s=p.read_text()
link='<link rel="stylesheet" href="/acionador-contrast-v5.css?v=5">'
if 'acionador-contrast-v5.css' not in s:
    s=s.replace('</head>',link+'\n</head>')
p.write_text(s)
