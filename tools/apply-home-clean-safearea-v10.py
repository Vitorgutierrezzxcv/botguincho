from pathlib import Path

js=Path('public/acionador-tratto-v2.js')
s=js.read_text()

# Add recent operational history cards to the V2 home.
anchor="""    const estimatedProfit=billed-totalCosts;\n    const runHtml = calls.length ?"""
insert="""    const estimatedProfit=billed-totalCosts;\n    const recentCalls=[...realCalls].sort((a,b)=>new Date(b.ownerClosedAt||b.completedAt||b.authorizedAt||b.updatedAt||b.createdAt||0)-new Date(a.ownerClosedAt||a.completedAt||a.authorizedAt||a.updatedAt||a.createdAt||0)).slice(0,6);\n    const recentStatus=(c)=>{\n      if(finalized(c)||c.status==='concluido') return 'Concluída';\n      if(activeStatuses.has(c.status)) return 'Em andamento';\n      if(c.status==='cancelado') return 'Cancelada';\n      if(c.quoteOutcome==='won'||c.authorizedAt) return 'Aceita';\n      if(c.quoteOutcome==='lost') return 'Perdida';\n      return 'Cotação';\n    };\n    const recentHtml=recentCalls.length?recentCalls.map(c=>`<article class=\"ax-quote-card\"><div class=\"ax-quote-top\"><div><b>${esc2(c.insurer||c.client||c.groupName||'Atendimento')}</b><small>${esc2(c.vehicle||c.plate||'Veículo não informado')}</small></div><span class=\"ax-quote-status ${finalized(c)||c.status==='concluido'?'done':activeStatuses.has(c.status)?'live':c.status==='cancelado'?'cancelled':''}\">${recentStatus(c)}</span></div><div class=\"ax-quote-route\">${esc2(c.origin||'Origem não informada')} <span>→</span> ${esc2(c.destination||'Destino não informado')}</div><div class=\"ax-quote-foot\"><div><span>Valor</span><b>${value(c)>0?money(value(c)):'A calcular'}</b></div><div><span>KM</span><b>${km(c)>0?`${km(c).toLocaleString('pt-BR',{maximumFractionDigits:1})} km`:'—'}</b></div><button onclick=\"axGo('calls')\">Ver detalhes</button></div></article>`).join(''):`<div class=\"ax-empty-home\"><b>Nenhum atendimento recente</b>As cotações e corridas aparecerão aqui.</div>`;\n    const runHtml = calls.length ?"""
if anchor not in s:
    raise SystemExit('recent cards anchor not found')
s=s.replace(anchor,insert,1)

terminal="""<div class=\"ax-finance-card profit ${estimatedProfit<0?'negative':'positive'}\"><span>Lucro estimado</span><b>${money(estimatedProfit)}</b><small>Faturado − gastos − repasse</small></div></div></section>`;"""
replacement="""<div class=\"ax-finance-card profit ${estimatedProfit<0?'negative':'positive'}\"><span>Lucro estimado</span><b>${money(estimatedProfit)}</b><small>Faturado − gastos − repasse</small></div></div></section><section class=\"ax-quotes-section\"><div class=\"ax-quotes-head\"><div><span>COTAÇÕES RECENTES</span><h3>Atendimentos recentes</h3><p>Histórico rápido das últimas cotações e corridas, inclusive as concluídas.</p></div><button onclick=\"axGo('calls')\">Ver histórico</button></div><div class=\"ax-quotes-grid\">${recentHtml}</div></section>`;"""
if terminal not in s:
    raise SystemExit('home terminal anchor not found')
s=s.replace(terminal,replacement,1)

# Render the V2 shell immediately to eliminate the old-dashboard flash.
old_init="""  async function init(){\n    document.body.classList.add('tratto-ui');\n    buildMenu();\n    await refreshHomeData();\n    document.querySelectorAll('[data-page]').forEach((button)=>button.addEventListener('click',()=>setTimeout(()=>{void refreshHomeData()},80)));\n    setInterval(()=>{void refreshHomeData()},10000);\n  }\n  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(()=>{void init()},350));else setTimeout(()=>{void init()},350);\n"""
new_init="""  function init(){\n    document.body.classList.add('tratto-ui');\n    buildMenu();\n    renderHome();\n    highlightMenu();\n    updateGreeting();\n    document.documentElement.classList.remove('ax-v2-boot');\n    void refreshHomeData();\n    document.querySelectorAll('[data-page]').forEach((button)=>button.addEventListener('click',()=>setTimeout(()=>{void refreshHomeData()},80)));\n    setInterval(()=>{void refreshHomeData()},10000);\n  }\n  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();\n"""
if old_init not in s:
    raise SystemExit('init anchor not found')
s=s.replace(old_init,new_init,1)
js.write_text(s)

# Final CSS layer: keep only V2 home content, safe-area-correct drawer, and premium recent cards.
css=Path('public/acionador-contrast-v5.css')
c=css.read_text()
extra=r'''

/* HOME V10 — home limpa, menu respeitando safe area e cotações recentes */
body.tratto-ui #dashboard > :not(#axHomeV2){display:none!important}

html body.tratto-ui .ax-menu-fab{
  left:auto!important;
  right:max(16px,env(safe-area-inset-right))!important;
  bottom:max(16px,env(safe-area-inset-bottom))!important;
}
html body.tratto-ui .ax-menu-drawer{
  left:auto!important;
  right:max(12px,env(safe-area-inset-right))!important;
  top:calc(env(safe-area-inset-top) + 12px)!important;
  bottom:calc(env(safe-area-inset-bottom) + 86px)!important;
  width:min(340px,calc(100vw - env(safe-area-inset-left) - env(safe-area-inset-right) - 24px))!important;
  max-height:none!important;
  overflow-y:auto!important;
  overflow-x:hidden!important;
  overscroll-behavior:contain!important;
  -webkit-overflow-scrolling:touch!important;
  border-radius:26px!important;
  padding:14px 14px max(14px,env(safe-area-inset-bottom))!important;
}
html body.tratto-ui .ax-menu-drawer.open{transform:none!important}

body.tratto-ui .ax-quotes-section{
  border:1.5px solid #d7e4fb!important;
  border-radius:28px!important;
  padding:20px!important;
  background:linear-gradient(145deg,#ffffff 0%,#f7faff 100%)!important;
  box-shadow:0 14px 36px rgba(31,57,95,.07)!important;
  position:relative!important;
  overflow:hidden!important;
}
body.tratto-ui .ax-quotes-section:before{
  content:"";position:absolute;left:0;right:0;top:0;height:5px;
  background:linear-gradient(90deg,#2f6bea,#6a98f7)
}
body.tratto-ui .ax-quotes-head{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;margin-bottom:14px}
body.tratto-ui .ax-quotes-head>div>span{display:block;font-size:11px;font-weight:900;letter-spacing:.12em;color:#2f6bea!important;margin-bottom:5px}
body.tratto-ui .ax-quotes-head h3{margin:0;color:#172033!important;font-size:24px;letter-spacing:-.035em}
body.tratto-ui .ax-quotes-head p{margin:6px 0 0;color:#78859a!important;font-size:13px}
body.tratto-ui .ax-quotes-head button,
body.tratto-ui .ax-quote-foot button{border:1px solid #d6e3f7;background:#fff;color:#245fc9;border-radius:13px;min-height:42px;padding:0 14px;font-weight:850}
body.tratto-ui .ax-quotes-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:11px}
body.tratto-ui .ax-quote-card{background:#fff;border:1px solid #dfe8f5;border-radius:19px;padding:15px;box-shadow:0 6px 18px rgba(31,57,95,.045);min-width:0}
body.tratto-ui .ax-quote-top{display:flex;justify-content:space-between;align-items:flex-start;gap:10px}
body.tratto-ui .ax-quote-top>div{min-width:0}
body.tratto-ui .ax-quote-top b{display:block;color:#172033!important;font-size:16px;overflow-wrap:anywhere}
body.tratto-ui .ax-quote-top small{display:block;color:#7b879b!important;margin-top:3px;overflow-wrap:anywhere}
body.tratto-ui .ax-quote-status{flex:0 0 auto;border-radius:999px;padding:6px 9px;background:#eef4ff;color:#245fc9!important;font-size:10.5px;font-weight:850}
body.tratto-ui .ax-quote-status.done{background:#eaf8f1;color:#23835d!important}
body.tratto-ui .ax-quote-status.live{background:#eef4ff;color:#245fc9!important}
body.tratto-ui .ax-quote-status.cancelled{background:#fff0f2;color:#bb4652!important}
body.tratto-ui .ax-quote-route{margin-top:12px;padding:12px;background:#f7f9fc;border-radius:14px;color:#536178!important;font-size:12.5px;line-height:1.45;overflow-wrap:anywhere}
body.tratto-ui .ax-quote-route span{color:#9aa5b6!important}
body.tratto-ui .ax-quote-foot{display:grid;grid-template-columns:1fr .7fr auto;gap:8px;align-items:end;margin-top:11px}
body.tratto-ui .ax-quote-foot>div{min-width:0}
body.tratto-ui .ax-quote-foot span{display:block;font-size:10px;color:#8a96a8!important}
body.tratto-ui .ax-quote-foot b{display:block;color:#172033!important;font-size:13px;margin-top:2px}

@media(max-width:860px){
  html body.tratto-ui .ax-menu-drawer{
    top:calc(env(safe-area-inset-top) + 10px)!important;
    bottom:calc(env(safe-area-inset-bottom) + 82px)!important;
    right:max(10px,env(safe-area-inset-right))!important;
    width:calc(100vw - env(safe-area-inset-left) - env(safe-area-inset-right) - 20px)!important;
    border-radius:24px!important;
  }
  body.tratto-ui .ax-quotes-section{padding:16px!important;border-radius:23px!important}
  body.tratto-ui .ax-quotes-head{align-items:flex-start;flex-direction:column;gap:10px}
  body.tratto-ui .ax-quotes-head h3{font-size:21px!important}
  body.tratto-ui .ax-quotes-head button{width:100%!important}
  body.tratto-ui .ax-quotes-grid{grid-template-columns:1fr!important}
  body.tratto-ui .ax-quote-card{padding:14px!important;border-radius:17px!important}
  body.tratto-ui .ax-quote-foot{grid-template-columns:1fr 1fr!important}
  body.tratto-ui .ax-quote-foot button{grid-column:1/-1;width:100%!important}
}
'''
if 'HOME V10' not in c:
    c += extra
css.write_text(c)

# Prevent old dashboard paint before V2 JS boots and bust asset cache.
idx=Path('public/index.html')
i=idx.read_text()
if 'ax-v2-boot' not in i:
    i=i.replace('</head>', '<style id="axV2Boot">html.ax-v2-boot #dashboard{visibility:hidden!important}</style><script>document.documentElement.classList.add("ax-v2-boot")</script></head>')
i=i.replace('/acionador-tratto-v2.css?v=9','/acionador-tratto-v2.css?v=10')
i=i.replace('/acionador-contrast-v5.css?v=8','/acionador-contrast-v5.css?v=10')
i=i.replace('/acionador-tratto-v2.js?v=9','/acionador-tratto-v2.js?v=10')
idx.write_text(i)
