from pathlib import Path

js=Path('public/acionador-tratto-v2.js')
s=js.read_text()

old="""    const drawer = document.createElement('div'); drawer.id='axMenuDrawer'; drawer.className='ax-menu-drawer';
    const items = [
"""
new="""    const drawer = document.createElement('div'); drawer.id='axMenuDrawer'; drawer.className='ax-menu-drawer';
    const overlay = document.createElement('div'); overlay.id='axMenuOverlay'; overlay.className='ax-menu-overlay';
    const items = [
"""
if old not in s:
    raise SystemExit('menu drawer anchor not found')
s=s.replace(old,new,1)

old2="""    drawer.querySelectorAll('[data-ax-page]').forEach(b=>b.addEventListener('click',()=>go(b.dataset.axPage)));
    fab.addEventListener('click',()=>drawer.classList.toggle('open'));
    document.addEventListener('click',(e)=>{if(!drawer.contains(e.target)&&e.target!==fab)drawer.classList.remove('open')});
    document.body.append(drawer,fab);
"""
new2="""    const setMenuOpen=(open)=>{
      drawer.classList.toggle('open',open);
      overlay.classList.toggle('open',open);
      document.body.classList.toggle('ax-menu-open',open);
      fab.setAttribute('aria-expanded',open?'true':'false');
    };
    drawer.querySelectorAll('[data-ax-page]').forEach(b=>b.addEventListener('click',()=>{go(b.dataset.axPage);setMenuOpen(false)}));
    fab.addEventListener('click',(e)=>{e.stopPropagation();setMenuOpen(!drawer.classList.contains('open'))});
    overlay.addEventListener('click',()=>setMenuOpen(false));
    document.addEventListener('keydown',(e)=>{if(e.key==='Escape')setMenuOpen(false)});
    document.body.append(overlay,drawer,fab);
"""
if old2 not in s:
    raise SystemExit('menu event anchor not found')
s=s.replace(old2,new2,1)
js.write_text(s)

css=Path('public/acionador-contrast-v5.css')
c=css.read_text()
extra=r'''

/* MENU V12 — overlay real para glass/blur no iPhone */
html body.tratto-ui .ax-menu-overlay{
  position:fixed!important;
  inset:0!important;
  z-index:9985!important;
  opacity:0!important;
  visibility:hidden!important;
  pointer-events:none!important;
  background:rgba(22,32,52,.18)!important;
  backdrop-filter:blur(14px) saturate(115%)!important;
  -webkit-backdrop-filter:blur(14px) saturate(115%)!important;
  transition:opacity .2s ease,visibility .2s ease!important;
}
html body.tratto-ui .ax-menu-overlay.open{
  opacity:1!important;
  visibility:visible!important;
  pointer-events:auto!important;
}
html body.tratto-ui.ax-menu-open{
  overflow:hidden!important;
  touch-action:none!important;
}
html body.tratto-ui .ax-menu-drawer{
  z-index:9990!important;
  background:rgba(255,255,255,.78)!important;
  backdrop-filter:blur(28px) saturate(155%)!important;
  -webkit-backdrop-filter:blur(28px) saturate(155%)!important;
  border:1px solid rgba(255,255,255,.76)!important;
  box-shadow:0 28px 80px rgba(20,31,52,.30),inset 0 1px 0 rgba(255,255,255,.84)!important;
}
html body.tratto-ui .ax-menu-fab{z-index:9995!important}

/* remove dependência do :has usado na V11 */
html body.tratto-ui:has(.ax-menu-drawer.open)::before{display:none!important}
'''
if 'MENU V12' not in c:
    c += extra
css.write_text(c)

idx=Path('public/index.html')
i=idx.read_text()
i=i.replace('/acionador-contrast-v5.css?v=11','/acionador-contrast-v5.css?v=12')
i=i.replace('/acionador-tratto-v2.js?v=10','/acionador-tratto-v2.js?v=12')
idx.write_text(i)
