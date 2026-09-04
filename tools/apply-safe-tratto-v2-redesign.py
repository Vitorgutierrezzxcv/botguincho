from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
JS = ROOT / 'public' / 'acionador-tratto-v2.js'
INDEX = ROOT / 'public' / 'index.html'

s = JS.read_text(encoding='utf-8')

# Access management state defensively. `mgmt` is owned by app.js and may not be
# ready at the exact moment this UI layer initializes.
anchor = """  const activeStatuses = new Set(['autorizado','a_caminho','em_atendimento','aguardando_fechamento']);\n"""
insert = anchor + """  const getMgmt = () => {\n    try {\n      if (typeof mgmt !== 'undefined' && mgmt && typeof mgmt === 'object') return mgmt;\n    } catch {}\n    return { company:{}, calls:[], finance:[], fleet:[], driverPayrolls:[] };\n  };\n"""
if 'const getMgmt = () =>' not in s:
    if anchor not in s: raise SystemExit('getMgmt anchor not found')
    s = s.replace(anchor, insert, 1)

s = s.replace("(Array.isArray(mgmt?.driverPayrolls)?mgmt.driverPayrolls:[])", "(Array.isArray(getMgmt().driverPayrolls)?getMgmt().driverPayrolls:[])")
s = s.replace("(Array.isArray(mgmt?.calls)?mgmt.calls:[])", "(Array.isArray(getMgmt().calls)?getMgmt().calls:[])")
s = s.replace("const finance=Array.isArray(mgmt?.finance)?mgmt.finance:[];", "const state=getMgmt();\n    const finance=Array.isArray(state.finance)?state.finance:[];")
s = s.replace("const finalCalls=(mgmt?.calls||[]).filter(c=>!c.deletedAt&&finalized(c));", "const finalCalls=(state.calls||[]).filter(c=>!c.deletedAt&&finalized(c));")
s = s.replace("(mgmt?.calls||[]).filter(c=>!c.deletedAt&&accepted(c)&&!finalized(c))", "(state.calls||[]).filter(c=>!c.deletedAt&&accepted(c)&&!finalized(c))")
s = s.replace("const driver=(mgmt?.fleet||[]).find(x=>x.driver)?.driver || payroll?.driverName || 'Mauro';", "const driver=(state.fleet||[]).find(x=>x.driver)?.driver || payroll?.driverName || 'Mauro';")

# The old MutationObserver watched the whole .main subtree. renderHome itself
# modifies that subtree, which could create a render loop and freeze/blank the UI.
old_init = """  function init(){buildMenu(); renderHome(); highlightMenu();\n    const obs=new MutationObserver(()=>{renderHome();highlightMenu()});\n    document.querySelector('.main') && obs.observe(document.querySelector('.main'),{subtree:true,childList:true,attributes:true,attributeFilter:['class']});\n    setInterval(()=>{renderHome();highlightMenu()},5000);\n  }\n"""
new_init = """  function init(){\n    document.body.classList.add('tratto-ui');\n    buildMenu();\n    renderHome();\n    highlightMenu();\n    document.querySelectorAll('[data-page]').forEach((button)=>button.addEventListener('click',()=>setTimeout(()=>{renderHome();highlightMenu()},60)));\n    setInterval(()=>{renderHome();highlightMenu()},5000);\n  }\n"""
if old_init in s:
    s = s.replace(old_init, new_init, 1)
elif "document.body.classList.add('tratto-ui')" not in s:
    raise SystemExit('safe init anchor not found')

JS.write_text(s, encoding='utf-8')

# Enable only the tested UI layer. Backend/worker behavior is untouched.
i = INDEX.read_text(encoding='utf-8')
css = '<link rel="stylesheet" href="/acionador-tratto-v2.css?v=3">'
js = '<script src="/acionador-tratto-v2.js?v=3"></script>'
# Remove older activation tags first to avoid duplicate scripts/styles.
import re
i = re.sub(r'<link rel="stylesheet" href="/acionador-tratto-v2\.css\?v=\d+">', '', i)
i = re.sub(r'<script src="/acionador-tratto-v2\.js\?v=\d+"></script>', '', i)
if css not in i: i = i.replace('</head>', css + '\n</head>', 1)
if js not in i: i = i.replace('</body>', js + '\n</body>', 1)
INDEX.write_text(i, encoding='utf-8')

print('Safe Acionador redesign enabled.')
