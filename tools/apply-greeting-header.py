from pathlib import Path

# 1) Expor o primeiro nome do usuário e a empresa já resolvidos pela sessão.
p = Path('public/account-session.js')
s = p.read_text()
old = "    const companyName=membership?.companies?.name||'Acionador.ai';\n    const canManage=membership?.role==='owner'&&membership?.companies?.id;"
new = "    const companyName=membership?.companies?.name||'Acionador.ai';\n    window.__acionadorUserName=display;\n    window.__acionadorCompanyName=companyName;\n    const canManage=membership?.role==='owner'&&membership?.companies?.id;"
if old not in s:
    raise SystemExit('account-session: marcador não encontrado')
s = s.replace(old, new, 1)
p.write_text(s)

# 2) Transformar o título global em saudação dinâmica e impedir que a navegação volte a escrever o nome da página.
p = Path('public/acionador-tratto-v2.js')
s = p.read_text()
marker = "  window.axGo = go;\n\n  function buildMenu(){"
insert = """  window.axGo = go;\n\n  function greetingName(){\n    const state=getMgmt();\n    const raw=window.__acionadorUserName || state?.user?.name || state?.company?.ownerName || state?.company?.contactName || '';\n    const clean=String(raw||'').trim();\n    if(!clean || /^(usuário|usuario|acionador\\.ai|central operacional)$/i.test(clean)) return '';\n    return clean.split(/\\s+/)[0];\n  }\n\n  function updateGreeting(){\n    const title=document.getElementById('title');\n    if(!title) return;\n    const hour=new Date().getHours();\n    const greeting=hour<12?'Bom dia':hour<18?'Boa tarde':'Boa noite';\n    const name=greetingName();\n    title.textContent=name?`${greeting}, ${name}`:greeting;\n    const subtitle=document.getElementById('subtitle');\n    if(subtitle){subtitle.textContent='';subtitle.style.display='none'}\n  }\n\n  function buildMenu(){"""
if marker not in s:
    raise SystemExit('v2 js: marcador principal não encontrado')
s = s.replace(marker, insert, 1)
s = s.replace('<small>CENTRAL OPERACIONAL</small>', '<small>ACOMPANHAMENTO EM TEMPO REAL</small>', 1)
old_init = "    renderHome();\n    highlightMenu();\n    document.querySelectorAll('[data-page]').forEach((button)=>button.addEventListener('click',()=>setTimeout(()=>{renderHome();highlightMenu()},60)));\n    setInterval(()=>{renderHome();highlightMenu()},5000);"
new_init = "    renderHome();\n    highlightMenu();\n    updateGreeting();\n    document.querySelectorAll('[data-page]').forEach((button)=>button.addEventListener('click',()=>setTimeout(()=>{renderHome();highlightMenu();updateGreeting()},80)));\n    setInterval(()=>{renderHome();highlightMenu();updateGreeting()},5000);"
if old_init not in s:
    raise SystemExit('v2 js: init não encontrado')
s = s.replace(old_init, new_init, 1)
p.write_text(s)

# 3) Remover visual de barra do topo em todas as páginas e manter somente saudação + status.
p = Path('public/acionador-mobile-v4.css')
s = p.read_text()
append = r'''

/* V5 — cabeçalho humano: sem barra fixa, só saudação + status */
html body.tratto-ui .topbar{
  position:relative!important;
  top:auto!important;
  z-index:40!important;
  background:transparent!important;
  border:0!important;
  border-bottom:0!important;
  border-radius:0!important;
  box-shadow:none!important;
  backdrop-filter:none!important;
  -webkit-backdrop-filter:none!important;
  padding:8px 2px 10px!important;
  margin:0 0 12px!important;
  min-height:58px!important;
  align-items:center!important;
}
html body.tratto-ui .topbar>div:first-child{min-width:0!important;flex:1 1 auto!important}
html body.tratto-ui .topbar h1{
  margin:0!important;
  color:#152037!important;
  font-size:clamp(23px,3vw,30px)!important;
  font-weight:850!important;
  line-height:1.08!important;
  letter-spacing:-.04em!important;
}
html body.tratto-ui .topbar p{display:none!important}
html body.tratto-ui .status-pill{
  flex:0 0 auto!important;
  background:#fff!important;
  color:#6b778d!important;
  border:1px solid #e1e6ee!important;
  box-shadow:0 2px 8px rgba(31,57,95,.035)!important;
}
@media(max-width:860px){
  html body.tratto-ui .topbar{
    position:relative!important;
    top:auto!important;
    margin:0 0 12px!important;
    padding:calc(16px + env(safe-area-inset-top)) 2px 8px!important;
    background:transparent!important;
    border:0!important;
    box-shadow:none!important;
  }
  html body.tratto-ui .topbar h1{font-size:24px!important}
  html body.tratto-ui .status-pill{font-size:11px!important;padding:7px 9px!important}
}
@media(max-width:430px){
  html body.tratto-ui .topbar{margin-left:0!important;margin-right:0!important;padding-left:1px!important;padding-right:1px!important}
  html body.tratto-ui .topbar h1{font-size:23px!important}
  html body.tratto-ui .status-pill{max-width:46vw!important}
}
'''
if 'V5 — cabeçalho humano' not in s:
    s += append
p.write_text(s)

# 4) Bump de versão para furar cache do PWA/browser.
p = Path('public/index.html')
s = p.read_text()
s = s.replace('/acionador-mobile-v4.css?v=4', '/acionador-mobile-v4.css?v=5')
s = s.replace('/acionador-tratto-v2.js?v=3', '/acionador-tratto-v2.js?v=5')
p.write_text(s)
