from pathlib import Path

js=Path('public/acionador-tratto-v2.js')
s=js.read_text()
s=s.replace("const billed=finalCalls.reduce((s,c)=>s+n(c.value),0);","const billed=finalCalls.reduce((s,c)=>s+n(c.value||c.calculatedValue||c.quoteCalculatedValue),0);")
old="""  function init(){
    document.body.classList.add('tratto-ui');
    buildMenu();
    renderHome();
    highlightMenu();
    updateGreeting();
    document.querySelectorAll('[data-page]').forEach((button)=>button.addEventListener('click',()=>setTimeout(()=>{renderHome();highlightMenu();updateGreeting()},80)));
    setInterval(()=>{renderHome();highlightMenu();updateGreeting()},5000);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(init,350));else setTimeout(init,350);
"""
new="""  async function refreshHomeData(){
    if(typeof loadManagement==='function'){
      try{await loadManagement()}catch{}
    }
    renderHome();
    highlightMenu();
    updateGreeting();
  }

  async function init(){
    document.body.classList.add('tratto-ui');
    buildMenu();
    await refreshHomeData();
    document.querySelectorAll('[data-page]').forEach((button)=>button.addEventListener('click',()=>setTimeout(()=>{void refreshHomeData()},80)));
    setInterval(()=>{void refreshHomeData()},10000);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(()=>{void init()},350));else setTimeout(()=>{void init()},350);
"""
if old not in s:
    raise SystemExit('init anchor not found')
s=s.replace(old,new,1)
js.write_text(s)

css=Path('public/acionador-contrast-v5.css')
c=css.read_text()
extra='''\n\n/* HOME V8 — remove moldura interna duplicada */\nbody.tratto-ui .ax-active-section > .ax-section-head{\n  border:0!important;\n  border-radius:0!important;\n  background:transparent!important;\n  box-shadow:none!important;\n  padding:2px 2px 12px 6px!important;\n}\nbody.tratto-ui .ax-active-section > .ax-section-head::before{display:none!important;content:none!important}\nbody.tratto-ui .ax-active-section > .ax-run-list{\n  border:0!important;\n  border-radius:0!important;\n  background:transparent!important;\n  box-shadow:none!important;\n  padding:0!important;\n}\n'''
if 'HOME V8' not in c:c+=extra
css.write_text(c)

idx=Path('public/index.html')
i=idx.read_text()
i=i.replace('/acionador-contrast-v5.css?v=7','/acionador-contrast-v5.css?v=8')
i=i.replace('/acionador-tratto-v2.js?v=7','/acionador-tratto-v2.js?v=8')
idx.write_text(i)
