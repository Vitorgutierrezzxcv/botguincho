from pathlib import Path

js=Path('public/acionador-tratto-v2.js')
s=js.read_text()

anchor="""  function activeCalls(){\n    return (Array.isArray(getMgmt().calls)?getMgmt().calls:[]).filter(c=>!c.deletedAt && c.testRunId == null && activeStatuses.has(c.status));\n  }\n"""
insert="""  function isRealCall(call){\n    return Boolean(call) && !call.deletedAt && !(call.testMode === true && call.testRunId != null);\n  }\n\n  function currentDriverPeriod(){\n    const now=new Date();\n    const start=now.getDate()>=20?new Date(now.getFullYear(),now.getMonth(),20):new Date(now.getFullYear(),now.getMonth()-1,20);\n    const end=now.getDate()>=20?new Date(now.getFullYear(),now.getMonth()+1,20,23,59,59,999):new Date(now.getFullYear(),now.getMonth(),20,23,59,59,999);\n    return {start,end};\n  }\n\n  function inDriverPeriod(call){\n    const raw=call?.authorizedAt||call?.ownerClosedAt||call?.completedAt||call?.createdAt||call?.updatedAt;\n    if(!raw) return false;\n    const d=new Date(raw);\n    if(Number.isNaN(d.getTime())) return false;\n    const {start,end}=currentDriverPeriod();\n    return d>=start&&d<=end;\n  }\n\n  function activeCalls(){\n    return (Array.isArray(getMgmt().calls)?getMgmt().calls:[]).filter(c=>isRealCall(c) && activeStatuses.has(c.status));\n  }\n"""
if anchor not in s:
    raise SystemExit('activeCalls anchor not found')
s=s.replace(anchor,insert,1)

old="""    const finalCalls=(state.calls||[]).filter(c=>!c.deletedAt&&finalized(c));\n    const billed=finalCalls.reduce((s,c)=>s+n(c.value||c.calculatedValue||c.quoteCalculatedValue),0);\n"""
new="""    const realCalls=(state.calls||[]).filter(isRealCall);\n    const finalCalls=realCalls.filter(finalized);\n    const billed=finalCalls.reduce((s,c)=>s+n(c.value||c.calculatedValue||c.quoteCalculatedValue),0);\n    const completedToday=finalCalls.filter(c=>{const raw=c.ownerClosedAt||c.completedAt||c.updatedAt||c.createdAt;if(!raw)return false;const d=new Date(raw),now=new Date();return !Number.isNaN(d.getTime())&&d.getFullYear()===now.getFullYear()&&d.getMonth()===now.getMonth()&&d.getDate()===now.getDate()}).length;\n"""
if old not in s:
    raise SystemExit('finalCalls anchor not found')
s=s.replace(old,new,1)

old2="""    const driverDue = n(payroll?.totalAmount || payroll?.projectedAmount) || (state.calls||[]).filter(c=>!c.deletedAt&&accepted(c)&&!finalized(c)).reduce((s,c)=>s+driverPay(c),0);\n"""
new2="""    const driverDue = n(payroll?.totalAmount || payroll?.projectedAmount) || realCalls.filter(c=>accepted(c)&&inDriverPeriod(c)).reduce((s,c)=>s+driverPay(c),0);\n"""
if old2 not in s:
    raise SystemExit('driverDue anchor not found')
s=s.replace(old2,new2,1)

old3="""<div class=\"ax-finance-card revenue\"><span>Faturado</span><b>${money(billed)}</b><small>Corridas concluídas</small></div>"""
new3="""<div class=\"ax-finance-card revenue\"><span>Faturado</span><b>${money(billed)}</b><small>${completedToday} corrida${completedToday===1?'':'s'} concluída${completedToday===1?'':'s'} hoje</small></div>"""
if old3 not in s:
    raise SystemExit('revenue card anchor not found')
s=s.replace(old3,new3,1)

js.write_text(s)

idx=Path('public/index.html')
i=idx.read_text()
i=i.replace('/acionador-tratto-v2.js?v=8','/acionador-tratto-v2.js?v=9')
i=i.replace('/acionador-tratto-v2.css?v=7','/acionador-tratto-v2.css?v=9')
idx.write_text(i)
# trigger v9
