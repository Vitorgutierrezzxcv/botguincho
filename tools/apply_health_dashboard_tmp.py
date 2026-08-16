from pathlib import Path

for name in ['index.html', 'public/index.html']:
    p = Path(name)
    s = p.read_text()
    marker = '<div class="card section install-card">'
    health = '<div class="card section"><div class="head"><div><h3>Saúde da automação</h3><p>Monitoramento automático da operação.</p></div><span id="healthOverall" class="tag yellow">Verificando</span></div><div class="grid2"><div><div class="kpi-line"><span>WhatsApp</span><b id="healthWhatsapp">...</b></div><div class="kpi-line"><span>GConnect</span><b id="healthTracker">...</b></div><div class="kpi-line"><span>Última localização</span><b id="healthAge">...</b></div></div><div><div class="kpi-line"><span>Rotas</span><b id="healthRoutes">...</b></div><div class="kpi-line"><span>IA</span><b id="healthAi">...</b></div><div class="kpi-line"><span>Grupos ativos</span><b id="healthGroups">...</b></div></div></div><div id="healthIssues" class="notice good section">Sistema operacional.</div></div>'
    if 'id="healthOverall"' not in s:
        if marker not in s:
            raise SystemExit(f'health html anchor missing {name}')
        s = s.replace(marker, health + marker, 1)
    p.write_text(s)

health_fn = r'''async function loadHealth(){try{const h=await api('/api/worker/health');const c=h.checks||{};const ok=h.status==='operational';if($('healthOverall')){$('healthOverall').textContent=ok?'Operacional':'Atenção';$('healthOverall').className='tag '+(ok?'green':'red')};if($('healthWhatsapp'))$('healthWhatsapp').textContent=c.whatsapp?.ok?'Online':(c.whatsapp?.status||'Offline');if($('healthTracker'))$('healthTracker').textContent=c.tracker?.ok?'Online':'Desatualizado';if($('healthAge'))$('healthAge').textContent=Number.isFinite(c.tracker?.ageSeconds)?`${c.tracker.ageSeconds}s atrás`:'Sem leitura';if($('healthRoutes'))$('healthRoutes').textContent=c.routes?.ok?'Online':'Indisponível';if($('healthAi'))$('healthAi').textContent=c.ai?.ok?'Online':(c.ai?.status||'Indisponível');if($('healthGroups'))$('healthGroups').textContent=h.groupsSelected??'—';if($('healthIssues')){const issues=[];if(!c.whatsapp?.ok)issues.push('WhatsApp não está pronto');if(!c.tracker?.ok)issues.push('GConnect sem leitura recente');if(!c.routes?.ok)issues.push('Roteadores indisponíveis');$('healthIssues').textContent=issues.length?issues.join(' · '):'Sistema operacional. Nenhuma falha crítica detectada.';$('healthIssues').className='notice '+(issues.length?'bad':'good')}}catch(e){if($('healthOverall')){$('healthOverall').textContent='Sem diagnóstico';$('healthOverall').className='tag red'};if($('healthIssues')){$('healthIssues').textContent='Não foi possível consultar o monitor de saúde.';$('healthIssues').className='notice bad'}}}
'''

for name in ['app.js', 'public/app.js']:
    p = Path(name)
    s = p.read_text()
    if 'async function loadHealth()' not in s:
        anchor = 'async function loadManagement(){'
        if anchor not in s:
            raise SystemExit(f'health js anchor missing {name}')
        s = s.replace(anchor, health_fn + anchor, 1)
    s = s.replace('Promise.allSettled([loadStatus(),loadManagement(),loadActivity()])', 'Promise.allSettled([loadStatus(),loadManagement(),loadActivity(),loadHealth()])')
    if 'setInterval(()=>loadHealth().catch(()=>{}),30000)' not in s:
        s = s.replace('setInterval(()=>loadActivity().catch(()=>{}),30000)', 'setInterval(()=>loadActivity().catch(()=>{}),30000);setInterval(()=>loadHealth().catch(()=>{}),30000)')
    p.write_text(s)

for name in ['sw.js', 'public/sw.js']:
    p = Path(name)
    s = p.read_text().replace('bot-guincho-pwa-v1', 'bot-guincho-pwa-v2')
    p.write_text(s)

print('health dashboard patch applied')
