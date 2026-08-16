from pathlib import Path
for name in ['index.html','public/index.html']:
    p=Path(name); s=p.read_text()
    more='''\n<section id="more" class="page"><div class="head"><div><h2>Mais</h2><p>Gestão, suporte e configurações.</p></div></div><div class="more-grid"><button class="more-card" data-page="clients"><span>◌</span><div><b>Clientes e seguradoras</b><small>Cadastros e parceiros</small></div></button><button class="more-card" data-page="fleet"><span>▰</span><div><b>Frota</b><small>Guinchos e motoristas</small></div></button><button class="more-card" data-page="automations"><span>⚡</span><div><b>Automações</b><small>Regras da operação</small></div></button><button class="more-card" data-page="help"><span>?</span><div><b>Ajuda e segurança</b><small>Status e contingência</small></div></button></div><div class="card section"><h3>Configurações avançadas</h3><p class="muted">Use apenas para configuração ou suporte técnico.</p><div class="more-grid section"><button class="more-card compact" data-page="whatsapp"><span>◍</span><div><b>WhatsApp</b><small>Conexão da sessão</small></div></button><button class="more-card compact" data-page="groups"><span>◎</span><div><b>Grupos</b><small>Locais autorizados</small></div></button><button class="more-card compact" data-page="tracker"><span>⌖</span><div><b>Rastreador</b><small>Localização atual</small></div></button><button class="more-card compact" data-page="ai"><span>✦</span><div><b>Automação inteligente</b><small>Comportamento do robô</small></div></button></div></div></section>\n'''
    if 'id="more" class="page"' not in s:
        s=s.replace('\n<section id="help" class="page">',more+'\n<section id="help" class="page">',1)
    old='<button data-page="fleet"><span class="mico">▰</span>Frota</button></nav>'
    new='<button data-page="more"><span class="mico">•••</span>Mais</button></nav>'
    s=s.replace(old,new)
    p.write_text(s)

for name in ['app.js','public/app.js']:
    p=Path(name); s=p.read_text()
    s=s.replace("help:['Ajuda e segurança','Acompanhe a saúde da operação e saiba o que fazer em uma falha.']", "help:['Ajuda e segurança','Acompanhe a saúde da operação e saiba o que fazer em uma falha.'],more:['Mais','Gestão, suporte e configurações.']")
    p.write_text(s)

for name in ['app.css','public/app.css']:
    p=Path(name); s=p.read_text()
    extra='''.more-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:11px}.more-card{border:1px solid var(--line);background:var(--bg2);color:#fff;border-radius:17px;padding:17px;text-align:left;display:flex;align-items:center;gap:13px}.more-card>span{width:40px;height:40px;border-radius:13px;background:#22303b;display:grid;place-items:center;font-size:20px;color:var(--brand)}.more-card div{display:grid;gap:4px}.more-card small{color:var(--muted)}.more-card.compact{padding:13px}.more-card.compact>span{width:34px;height:34px;font-size:16px}@media(max-width:520px){.more-grid{grid-template-columns:1fr 1fr}.more-card{padding:14px;align-items:flex-start}.more-card>span{width:35px;height:35px}.more-card b{font-size:13px}.more-card small{font-size:11px}}'''
    if '.more-grid{' not in s: s += extra
    # Do not hide advanced desktop menu rule as mobile navigation has a dedicated More page.
    p.write_text(s)

for name in ['sw.js','public/sw.js']:
    p=Path(name); s=p.read_text().replace('bot-guincho-pwa-v3','bot-guincho-pwa-v4'); p.write_text(s)
print('mobile more navigation applied')
