from pathlib import Path

js = Path('public/acionador-tratto-v2.js')
s = js.read_text()

old_calc = """    const payroll=currentPayroll();\n    const driverDue = n(payroll?.totalAmount || payroll?.projectedAmount) || (state.calls||[]).filter(c=>!c.deletedAt&&accepted(c)&&!finalized(c)).reduce((s,c)=>s+driverPay(c),0);\n    const driver=(state.fleet||[]).find(x=>x.driver)?.driver || payroll?.driverName || 'Mauro';\n"""
new_calc = """    const payroll=currentPayroll();\n    const driverDue = n(payroll?.totalAmount || payroll?.projectedAmount) || (state.calls||[]).filter(c=>!c.deletedAt&&accepted(c)&&!finalized(c)).reduce((s,c)=>s+driverPay(c),0);\n    const driver=(state.fleet||[]).find(x=>x.driver)?.driver || payroll?.driverName || 'Mauro';\n    const expenseRows=finance.filter(f=>f.type==='despesa'&&!f.deletedAt);\n    const driverExpenseRows=expenseRows.filter(f=>/repasse|motorista|mauro|driver/i.test(String(f.description||f.name||f.category||'')));\n    const driverExpenseBooked=driverExpenseRows.reduce((sum,f)=>sum+n(f.amount),0);\n    const driverCost=driverExpenseBooked || driverDue;\n    const otherExpenses=Math.max(0,expenseRows.reduce((sum,f)=>sum+n(f.amount),0)-driverExpenseBooked);\n    const totalCosts=otherExpenses+driverCost;\n    const estimatedProfit=billed-totalCosts;\n"""
if old_calc not in s:
    raise SystemExit('calculation anchor not found')
s = s.replace(old_calc, new_calc, 1)

start = s.index("    root.innerHTML=`")
end = s.index("`;\n  }", start) + 2
old_html = s[start:end]
new_html = """    root.innerHTML=`<div class=\"ax-home-hero ax-home-hero-single\"><section class=\"ax-welcome\"><div><small>ACOMPANHAMENTO EM TEMPO REAL</small><h2>${calls.length?`${calls.length} corrida${calls.length>1?'s':''} acontecendo agora`:'Operação pronta para receber chamadas'}</h2><p>${awaiting.length?`${awaiting.length} corrida${awaiting.length>1?'s':''} aguardando fechamento.`:'Acompanhe, edite e conclua os atendimentos sem sair da tela inicial.'}</p></div><div class=\"ax-welcome-actions\"><button class=\"ax-btn light\" onclick=\"axGo('operations')\">Abrir operação</button><button class=\"ax-btn glass\" onclick=\"ownerEditCall(null,'quote')\">+ Corrida manual</button></div></section></div><section class=\"ax-active-section\"><div class=\"ax-section-head\"><div><h3>Corridas em andamento</h3><p>Prioridade da operação: acompanhar e concluir atendimentos.</p></div><button class=\"ax-link-btn\" onclick=\"axGo('operations')\">Ver operação</button></div><div class=\"ax-run-list\">${runHtml}</div></section><aside class=\"ax-driver-summary ax-driver-after-runs\"><div><span class=\"label\">REPASSE DO MOTORISTA</span><div class=\"ax-driver-name\">${esc2(driver)}</div><p class=\"ax-driver-copy\">Provisão do período atual com base nas corridas aceitas e concluídas.</p></div><div><div class=\"ax-driver-total\">${money(driverCost)}</div><div class=\"ax-driver-foot\"><span>${payroll?.periodStart&&payroll?.periodEnd?`${payroll.periodStart} → ${payroll.periodEnd}`:'Período atual'}</span><button class=\"ax-link-btn\" style=\"color:#fff\" onclick=\"axGo('fleet')\">Ver repasse</button></div></div></aside><section class=\"ax-company-summary\"><div class=\"ax-company-summary-head\"><div><span class=\"ax-summary-kicker\">RESUMO DA EMPRESA</span><h3>Visão financeira do período</h3><p>Faturamento, custos, repasse e resultado da operação em um único lugar.</p></div><button class=\"ax-summary-action\" onclick=\"axGo('finance')\">Abrir financeiro</button></div><div class=\"ax-finance-overview\"><div class=\"ax-finance-card revenue\"><span>Faturado</span><b>${money(billed)}</b><small>Corridas concluídas</small></div><div class=\"ax-finance-card received\"><span>Recebido</span><b>${money(received)}</b><small>Entradas confirmadas</small></div><div class=\"ax-finance-card pending\"><span>A receber</span><b>${money(receivable)}</b><small>Receitas pendentes</small></div><div class=\"ax-finance-card expense\"><span>Gastos operacionais</span><b>${money(otherExpenses)}</b><small>Despesas sem o repasse</small></div><div class=\"ax-finance-card driver\"><span>Repasse motorista</span><b>${money(driverCost)}</b><small>${esc2(driver)} · período atual</small></div><div class=\"ax-finance-card profit ${estimatedProfit<0?'negative':'positive'}\"><span>Lucro estimado</span><b>${money(estimatedProfit)}</b><small>Faturado − gastos − repasse</small></div></div></section>`;"""
s = s[:start] + new_html + s[end:]
js.write_text(s)

css = Path('public/acionador-contrast-v5.css')
c = css.read_text()
extra = r'''

/* HOME V6 — prioridade operacional e resumo financeiro completo */
body.tratto-ui .ax-home-hero-single{grid-template-columns:1fr!important}
body.tratto-ui .ax-active-section{
  border:1.5px solid #86adfa!important;
  border-radius:28px!important;
  padding:18px!important;
  background:linear-gradient(180deg,#f8fbff 0%,#f2f7ff 100%)!important;
  box-shadow:0 0 0 4px rgba(47,107,234,.055),0 14px 34px rgba(31,57,95,.075)!important;
  position:relative!important;
  overflow:hidden!important;
}
body.tratto-ui .ax-active-section:before{
  content:"";position:absolute;left:0;top:0;bottom:0;width:5px;
  background:linear-gradient(180deg,#2465e8,#6a98f7)
}
body.tratto-ui .ax-active-section>.ax-section-head{margin:0 2px 14px 5px!important}
body.tratto-ui .ax-active-section>.ax-run-list{
  padding:0!important;border:0!important;background:transparent!important;box-shadow:none!important;border-radius:0!important
}
body.tratto-ui .ax-driver-after-runs{
  display:grid!important;grid-template-columns:minmax(0,1fr) auto!important;align-items:end!important;gap:20px!important;
}
body.tratto-ui .ax-driver-copy{margin:8px 0 0!important;color:rgba(255,255,255,.72)!important;font-size:13px!important;line-height:1.45!important;max-width:560px}
body.tratto-ui .ax-company-summary{
  border:1.5px solid #d8e4f7!important;
  border-radius:28px!important;
  padding:22px!important;
  background:linear-gradient(145deg,#ffffff 0%,#f8fbff 100%)!important;
  box-shadow:0 14px 36px rgba(31,57,95,.075)!important;
  position:relative!important;
  overflow:hidden!important;
}
body.tratto-ui .ax-company-summary:before{
  content:"";position:absolute;left:0;right:0;top:0;height:5px;
  background:linear-gradient(90deg,#2f6bea,#5b8ff5 55%,#36b37e)
}
body.tratto-ui .ax-company-summary-head{display:flex!important;justify-content:space-between!important;align-items:flex-end!important;gap:18px!important;margin-bottom:18px!important}
body.tratto-ui .ax-summary-kicker{display:block;color:#2f6bea!important;font-size:11px!important;font-weight:900!important;letter-spacing:.12em!important;margin-bottom:5px!important}
body.tratto-ui .ax-company-summary-head h3{margin:0!important;font-size:24px!important;letter-spacing:-.035em!important;color:#172033!important}
body.tratto-ui .ax-company-summary-head p{margin:6px 0 0!important;color:#78859a!important;font-size:13px!important}
body.tratto-ui .ax-summary-action{border:1px solid #d7e3f4!important;background:#fff!important;color:#245fc9!important;border-radius:13px!important;min-height:42px!important;padding:0 14px!important;font-weight:850!important}
body.tratto-ui .ax-finance-overview{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:11px!important}
body.tratto-ui .ax-finance-card{border:1px solid #e4eaf2!important;border-radius:18px!important;padding:16px!important;min-height:116px!important;background:#fff!important}
body.tratto-ui .ax-finance-card span{display:block!important;font-size:11px!important;font-weight:850!important;color:#738198!important;text-transform:uppercase!important;letter-spacing:.035em!important}
body.tratto-ui .ax-finance-card b{display:block!important;font-size:24px!important;letter-spacing:-.035em!important;color:#172033!important;margin-top:9px!important}
body.tratto-ui .ax-finance-card small{display:block!important;color:#8a96a8!important;font-size:11px!important;margin-top:5px!important}
body.tratto-ui .ax-finance-card.revenue{background:#eef4ff!important;border-color:#d6e4ff!important}
body.tratto-ui .ax-finance-card.received{background:#ecfaf3!important;border-color:#d1efdf!important}
body.tratto-ui .ax-finance-card.pending{background:#fff8e7!important;border-color:#f1e2b8!important}
body.tratto-ui .ax-finance-card.expense{background:#fff4f3!important;border-color:#f4d9d6!important}
body.tratto-ui .ax-finance-card.driver{background:#f4f0ff!important;border-color:#e4dcfb!important}
body.tratto-ui .ax-finance-card.profit{background:linear-gradient(145deg,#172033,#24344e)!important;border-color:#172033!important;box-shadow:0 10px 24px rgba(23,32,51,.16)!important}
body.tratto-ui .ax-finance-card.profit span,body.tratto-ui .ax-finance-card.profit b,body.tratto-ui .ax-finance-card.profit small{color:#fff!important}
body.tratto-ui .ax-finance-card.profit small{color:rgba(255,255,255,.7)!important}
body.tratto-ui .ax-finance-card.profit.negative{background:linear-gradient(145deg,#7f2730,#a63845)!important;border-color:#8f2f39!important}

@media(max-width:860px){
  body.tratto-ui .ax-active-section{padding:15px!important;border-radius:23px!important}
  body.tratto-ui .ax-driver-after-runs{grid-template-columns:1fr!important;gap:14px!important}
  body.tratto-ui .ax-company-summary{padding:17px!important;border-radius:23px!important}
  body.tratto-ui .ax-company-summary-head{align-items:flex-start!important;flex-direction:column!important;gap:12px!important}
  body.tratto-ui .ax-summary-action{width:100%!important}
  body.tratto-ui .ax-finance-overview{grid-template-columns:1fr 1fr!important;gap:9px!important}
  body.tratto-ui .ax-finance-card{padding:14px!important;min-height:108px!important}
  body.tratto-ui .ax-finance-card b{font-size:21px!important}
}
@media(max-width:430px){body.tratto-ui .ax-finance-overview{grid-template-columns:1fr 1fr!important}}
'''
if 'HOME V6' not in c:
    c += extra
css.write_text(c)
