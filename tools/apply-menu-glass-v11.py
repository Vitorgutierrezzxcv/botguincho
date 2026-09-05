from pathlib import Path

css=Path('public/acionador-contrast-v5.css')
c=css.read_text()
extra=r'''

/* MENU V11 — backdrop glass/desfoque atrás do popup */
html body.tratto-ui:has(.ax-menu-drawer.open)::before{
  content:"";
  position:fixed;
  inset:0;
  z-index:9980;
  background:rgba(233,239,249,.34);
  backdrop-filter:blur(12px) saturate(118%);
  -webkit-backdrop-filter:blur(12px) saturate(118%);
  pointer-events:none;
  opacity:1;
}
html body.tratto-ui .ax-menu-drawer{
  z-index:9990!important;
  background:rgba(255,255,255,.84)!important;
  backdrop-filter:blur(24px) saturate(145%)!important;
  -webkit-backdrop-filter:blur(24px) saturate(145%)!important;
  border:1px solid rgba(255,255,255,.72)!important;
  box-shadow:0 24px 70px rgba(31,45,72,.24),inset 0 1px 0 rgba(255,255,255,.72)!important;
}
html body.tratto-ui .ax-menu-fab{z-index:9995!important}
'''
if 'MENU V11' not in c:
    c += extra
css.write_text(c)

idx=Path('public/index.html')
i=idx.read_text()
i=i.replace('/acionador-contrast-v5.css?v=10','/acionador-contrast-v5.css?v=11')
idx.write_text(i)
# trigger v11
