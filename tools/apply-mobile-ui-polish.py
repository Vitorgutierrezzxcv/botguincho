from pathlib import Path

path = Path('public/acionador-tratto-v2.css')
css = path.read_text(encoding='utf-8')
marker = '/* ACIONADOR_MOBILE_POLISH_V1 */'
block = r'''

/* ACIONADOR_MOBILE_POLISH_V1 */
/* Remove a barra inferior antiga e usa somente o menu flutuante expansível. */
.tratto-ui .mobile-tabs,
.tratto-ui .bottom-nav,
.tratto-ui .mobile-bottom-nav,
.tratto-ui .app-bottom-nav,
.tratto-ui .bottom-navigation,
.tratto-ui nav.mobile-tabs{display:none!important}

/* Menu flutuante no canto direito. */
.ax-menu-fab{left:auto!important;right:22px!important}
.ax-menu-drawer{left:auto!important;right:18px!important;transform-origin:bottom right!important}

/* Padronização visual de cards em todas as páginas. */
.tratto-ui .page>.card,
.tratto-ui .page .card,
.tratto-ui .metric-card,
.tratto-ui .op-card,
.tratto-ui .op-summary-card,
.tratto-ui .more-card,
.tratto-ui .group,
.tratto-ui .event,
.tratto-ui .table-wrap,
.tratto-ui .notice,
.tratto-ui .tracker-grid>div,
.tratto-ui .onboarding-step{
  border-radius:22px!important;
  border-color:var(--ax-line)!important;
  box-shadow:0 8px 28px rgba(25,39,70,.055)!important;
}

.tratto-ui .page>.card,
.tratto-ui .page .card,
.tratto-ui .metric-card,
.tratto-ui .op-card,
.tratto-ui .more-card,
.tratto-ui .group,
.tratto-ui .event,
.tratto-ui .table-wrap,
.tratto-ui .tracker-grid>div,
.tratto-ui .onboarding-step{
  background:#fff!important;
  color:var(--ax-text)!important;
}

.tratto-ui .page .card h2,
.tratto-ui .page .card h3,
.tratto-ui .page .card b,
.tratto-ui .more-card b,
.tratto-ui .group b,
.tratto-ui .event b{color:var(--ax-text)!important}

.tratto-ui .page .muted,
.tratto-ui .page .small,
.tratto-ui .page small,
.tratto-ui .head p,
.tratto-ui .more-card small{color:var(--ax-muted)!important}

.tratto-ui .head{margin-bottom:18px!important}
.tratto-ui .head h2{font-size:28px!important;letter-spacing:-.035em!important}
.tratto-ui .head p{font-size:14px!important;line-height:1.45!important}

.tratto-ui .btn,
.tratto-ui button.btn{border-radius:14px!important;min-height:46px!important;font-weight:850!important}

.tratto-ui .table-wrap{overflow:auto!important;background:#fff!important}
.tratto-ui .table th{background:#f7f9fc!important;color:#758096!important;border-color:var(--ax-line)!important}
.tratto-ui .table td{background:#fff!important;color:var(--ax-text)!important;border-color:var(--ax-line)!important}
.tratto-ui .table tr:hover td{background:#f8faff!important}

.tratto-ui .form-grid .field input,
.tratto-ui .form-grid .field select,
.tratto-ui .form-grid .field textarea,
.tratto-ui .field input,
.tratto-ui .field select,
.tratto-ui .field textarea{
  background:#fff!important;
  color:var(--ax-text)!important;
  border-color:#dfe4ec!important;
  border-radius:14px!important;
}

.tratto-ui .field label{color:#69768d!important}

/* Mobile: mais respiro, cards sem overflow e ações em largura total. */
@media(max-width:900px){
  .tratto-ui .main{padding-bottom:calc(26px + env(safe-area-inset-bottom))!important}
  .ax-menu-fab{left:auto!important;right:14px!important;bottom:calc(16px + env(safe-area-inset-bottom))!important}
  .ax-menu-drawer{left:auto!important;right:12px!important;bottom:calc(82px + env(safe-area-inset-bottom))!important;width:calc(100vw - 24px)!important}

  .tratto-ui .page>.card,
  .tratto-ui .page .card,
  .tratto-ui .op-card,
  .tratto-ui .metric-card,
  .tratto-ui .more-card{border-radius:20px!important}

  .tratto-ui .head h2{font-size:25px!important}
  .tratto-ui .head{gap:10px!important}
  .tratto-ui .grid2,
  .tratto-ui .grid3{grid-template-columns:1fr!important;gap:12px!important}

  .tratto-ui .metrics{grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:10px!important}
  .tratto-ui .metric-card{padding:15px!important;min-width:0!important}
  .tratto-ui .metric-card strong{font-size:22px!important;overflow-wrap:anywhere}

  .tratto-ui .op-card,
  .tratto-ui .ax-run-card{min-width:0!important;overflow:hidden!important}
  .tratto-ui .op-route,
  .tratto-ui .ax-route{overflow-wrap:anywhere!important;word-break:break-word!important}
  .tratto-ui .op-meta,
  .tratto-ui .ax-run-meta{min-width:0!important}
  .tratto-ui .op-meta>div,
  .tratto-ui .ax-run-meta>div{min-width:0!important;overflow:hidden!important}
  .tratto-ui .op-meta b,
  .tratto-ui .ax-run-meta b{overflow-wrap:anywhere!important}

  .tratto-ui .op-actions,
  .tratto-ui .ax-run-actions{grid-template-columns:1fr!important}
  .tratto-ui .op-actions .btn,
  .tratto-ui .ax-run-actions button{width:100%!important;min-height:50px!important}

  .tratto-ui .more-grid{grid-template-columns:1fr 1fr!important;gap:10px!important}
  .tratto-ui .more-card{min-width:0!important}
}

@media(max-width:520px){
  .tratto-ui .main{padding-left:12px!important;padding-right:12px!important}
  .tratto-ui .topbar{margin-left:-12px!important;margin-right:-12px!important}
  .tratto-ui .metrics{grid-template-columns:1fr 1fr!important}
  .tratto-ui .more-grid{grid-template-columns:1fr 1fr!important}
  .tratto-ui .page>.card,
  .tratto-ui .page .card,
  .tratto-ui .op-card{padding:16px!important}
}
'''

if marker not in css:
    css += block
else:
    start = css.index(marker)
    css = css[:start].rstrip() + block

path.write_text(css, encoding='utf-8')
print('Mobile UI polish applied')
