from pathlib import Path

for name in ['index.html','public/index.html']:
    p=Path(name); s=p.read_text()
    s=s.replace('<button data-page="automations"><span class="ico">⚡</span>Automações</button></nav></div>', '<button data-page="automations"><span class="ico">⚡</span>Automações</button><button data-page="help"><span class="ico">?</span>Ajuda</button></nav></div>')
    s=s.replace('<div class="nav-group"><div class="nav-label">Bot Guincho</div><nav class="nav">', '<details class="nav-group advanced-menu"><summary class="nav-label">Configurações avançadas</summary><nav class="nav">')
    s=s.replace('<button data-page="ai"><span class="ico">✦</span>Inteligência</button></nav></div><div class="section">', '<button data-page="ai"><span class="ico">✦</span>Automação inteligente</button></nav></details><div class="section">')
    s=s.replace('WhatsApp, GConnect, chamados, frota, financeiro e automações em uma única operação mobile-first.', 'Chamados, rastreador, financeiro e automações trabalhando juntos em uma única central.')
    s=s.replace('<span>GConnect</span><b id="trackerMetric">...</b>', '<span>Rastreador</span><b id="trackerMetric">...</b>')
    s=s.replace('<span>GConnect</span><b id="healthTracker">...</b>', '<span>Rastreador</span><b id="healthTracker">...</b>')
    s=s.replace('<span>IA</span><b id="aiMetric">...</b>', '<span>Automação inteligente</span><b id="aiMetric">...</b>')
    s=s.replace('<span>IA</span><b id="healthAi">...</b>', '<span>Automação</span><b id="healthAi">...</b>')
    s=s.replace('<div class="kpi-line"><span>3. Calcula ETA</span><b>GConnect</b></div>', '<div class="kpi-line"><span>3. Calcula previsão</span><b>Rastreador</b></div>')
    s=s.replace('<h2>Rastreador</h2><p>GConnect lido pelo Android emulado.</p>', '<h2>Rastreador</h2><p>Localização atual do guincho usada nas previsões.</p>')
    s=s.replace('<h2>Inteligência</h2><p>Configure o comportamento da IA.</p>', '<h2>Automação inteligente</h2><p>Controle como o robô responde às mensagens operacionais.</p>')
    s=s.replace('<b>Modo humano</b><div class="muted">Pausa respostas automáticas.</div>', '<b>Pausar respostas automáticas</b><div class="muted">Use apenas quando quiser assumir o atendimento manualmente.</div>')

    dashboard_marker='<div class="card section"><div class="head"><div><h3>Saúde da automação</h3>'
    onboarding='''<div id="onboardingCard" class="card section onboarding-card"><div class="head"><div><h3>Comece por aqui</h3><p>Quatro passos para deixar a operação pronta.</p></div><button class="btn small ghost" id="dismissOnboarding">Entendi</button></div><div class="onboarding-grid"><button data-page="automations" class="onboarding-step"><b>1</b><span><strong>Cadastre a empresa</strong><small>Nome e dados básicos.</small></span></button><button data-page="groups" class="onboarding-step"><b>2</b><span><strong>Confira os grupos</strong><small>Onde o robô pode responder.</small></span></button><button data-page="fleet" class="onboarding-step"><b>3</b><span><strong>Confira o guincho</strong><small>Placa e motorista.</small></span></button><button data-page="help" class="onboarding-step"><b>4</b><span><strong>Veja como acompanhar</strong><small>Saúde e contingência.</small></span></button></div></div>'''
    if 'id="onboardingCard"' not in s:
        s=s.replace(dashboard_marker,onboarding+dashboard_marker,1)

    help_section='''\n<section id="help" class="page"><div class="head"><div><h2>Ajuda e segurança</h2><p>O que acompanhar no dia a dia e o que fazer se algo sair do normal.</p></div><button class="btn secondary" id="refreshHelp">Verificar agora</button></div><div class="grid2"><div class="card"><h3>Status da operação</h3><div id="helpStatus" class="notice warn section">Verificando...</div><div class="kpi-line"><span>WhatsApp</span><b id="helpWhatsapp">...</b></div><div class="kpi-line"><span>Rastreador</span><b id="helpTracker">...</b></div><div class="kpi-line"><span>Rotas</span><b id="helpRoutes">...</b></div><div class="kpi-line"><span>Automação</span><b id="helpAi">...</b></div></div><div class="card"><h3>Como interpretar</h3><div class="support-rule"><span class="support-dot green"></span><div><b>Verde — pode operar normalmente</b><p>Nenhuma ação é necessária.</p></div></div><div class="support-rule"><span class="support-dot yellow"></span><div><b>Amarelo — aguarde alguns minutos</b><p>O sistema tenta se recuperar automaticamente. Evite alterar configurações.</p></div></div><div class="support-rule"><span class="support-dot red"></span><div><b>Vermelho — assuma manualmente</b><p>Responda os grupos manualmente até o status voltar ao normal e acione o suporte.</p></div></div></div></div><div class="grid2 section"><div class="card"><h3>Se o robô não responder</h3><ol class="help-list"><li>Confira se o topo do aplicativo mostra <b>Operação online</b>.</li><li>Abra esta página e toque em <b>Verificar agora</b>.</li><li>Se o Rastreador estiver desatualizado, não confie em previsão antiga.</li><li>Se continuar vermelho, faça o atendimento manual e acione o suporte.</li></ol></div><div class="card"><h3>Boas práticas</h3><ol class="help-list"><li>Não desconecte o WhatsApp do aparelho principal sem necessidade.</li><li>Não altere Configurações avançadas durante um atendimento.</li><li>Confira a página de Chamados ao fim do dia.</li><li>Marque recebimentos no Financeiro para manter o saldo correto.</li></ol></div></div><div class="notice good section"><b>Proteção automática ativa.</b> O sistema monitora WhatsApp, rastreador e rotas periodicamente e tenta se recuperar sozinho quando possível.</div></section>\n'''
    if 'id="help" class="page"' not in s:
        s=s.replace('\n</main></div><nav class="mobile-tabs">',help_section+'\n</main></div><nav class="mobile-tabs">',1)
    p.write_text(s)

for name in ['app.js','public/app.js']:
    p=Path(name); s=p.read_text()
    s=s.replace("ai:['Inteligência','Comportamento das respostas automáticas.']", "ai:['Automação inteligente','Controle as respostas automáticas.'],help:['Ajuda e segurança','Acompanhe a saúde da operação e saiba o que fazer em uma falha.']")
    s=s.replace("if(name==='ai')loadSettings()", "if(name==='ai')loadSettings();if(name==='help')loadHelp()")
    health_anchor="async function loadManagement(){"
    help_fn="""async function loadHelp(){try{const h=await api('/api/worker/health');const c=h.checks||{};const ok=h.status==='operational';if($('helpStatus')){$('helpStatus').textContent=ok?'Tudo certo. A operação está funcionando normalmente.':'Atenção: existe um componente que precisa de acompanhamento.';$('helpStatus').className='notice '+(ok?'good':'bad')};if($('helpWhatsapp'))$('helpWhatsapp').textContent=c.whatsapp?.ok?'Online':'Atenção';if($('helpTracker'))$('helpTracker').textContent=c.tracker?.ok?`Online · ${c.tracker.ageSeconds??0}s`:'Desatualizado';if($('helpRoutes'))$('helpRoutes').textContent=c.routes?.ok?'Online':'Atenção';if($('helpAi'))$('helpAi').textContent=c.ai?.ok?'Ativa':'Atenção'}catch(e){if($('helpStatus')){$('helpStatus').textContent='Não foi possível verificar o sistema agora. Faça o atendimento manual até uma nova verificação.';$('helpStatus').className='notice bad'}}}\n"""
    if 'async function loadHelp()' not in s:
        s=s.replace(health_anchor,help_fn+health_anchor,1)
    s=s.replace("const q=s.whatsapp?.qrDataUrl", "if($('clientSetupHint'))$('clientSetupHint').style.display='none';const q=s.whatsapp?.qrDataUrl")
    init_anchor="if('serviceWorker'in navigator)"
    setup="""if($('refreshHelp'))$('refreshHelp').onclick=loadHelp;\nif($('dismissOnboarding'))$('dismissOnboarding').onclick=()=>{localStorage.setItem('bg-onboarding-done','1');$('onboardingCard')?.remove()};\nif(localStorage.getItem('bg-onboarding-done')==='1')$('onboardingCard')?.remove();\n"""
    if "bg-onboarding-done" not in s:
        s=s.replace(init_anchor,setup+init_anchor,1)
    p.write_text(s)

for name in ['app.css','public/app.css']:
    p=Path(name); s=p.read_text()
    extra='''.advanced-menu{margin:14px 0}.advanced-menu summary{cursor:pointer;list-style:none}.advanced-menu summary::-webkit-details-marker{display:none}.advanced-menu summary:after{content:"⌄";float:right;color:#7f8d98}.advanced-menu[open] summary:after{content:"⌃"}.onboarding-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.onboarding-step{border:1px solid var(--line);background:#11181e;color:#fff;border-radius:14px;padding:13px;text-align:left;display:flex;gap:10px;align-items:flex-start}.onboarding-step>b{width:27px;height:27px;border-radius:9px;background:#263746;display:grid;place-items:center;color:var(--brand)}.onboarding-step span{display:grid;gap:3px}.onboarding-step small{color:var(--muted);line-height:1.35}.support-rule{display:flex;gap:12px;padding:13px 0;border-bottom:1px solid #28343d}.support-rule p{margin:4px 0 0;color:var(--muted);font-size:13px}.support-dot{width:12px;height:12px;border-radius:50%;margin-top:4px;flex:0 0 auto}.support-dot.green{background:var(--green)}.support-dot.yellow{background:var(--yellow)}.support-dot.red{background:var(--red)}.help-list{margin:12px 0 0;padding-left:20px;color:#cbd5dc;line-height:1.7}.help-list li+li{margin-top:7px}@media(max-width:860px){.onboarding-grid{grid-template-columns:1fr 1fr}.advanced-menu{display:none}}@media(max-width:520px){.onboarding-grid{grid-template-columns:1fr}}'''
    if '.onboarding-grid{' not in s:
        s += extra
    p.write_text(s)

for name in ['sw.js','public/sw.js']:
    p=Path(name); s=p.read_text().replace('bot-guincho-pwa-v2','bot-guincho-pwa-v3'); p.write_text(s)
print('client delivery interface applied')
