from pathlib import Path
p=Path('tools/financial-engine.mjs')
text=p.read_text()
old="""      const statement = atDay(year, month, anchorDay);\n      if (statement.getTime() < done.getTime()) continue;"""
new="""      const statement = atDay(year, month, anchorDay);\n      // O último dia da janela também conta por inteiro.\n      if (dateOnly(statement) < dateOnly(done)) continue;"""
if old not in text: raise SystemExit('SEMIMONTHLY_CYCLE_PATTERN_NOT_FOUND')
p.write_text(text.replace(old,new,1))
print('SEMIMONTHLY_CYCLE_FIXED')
