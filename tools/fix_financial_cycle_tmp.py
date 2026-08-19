from pathlib import Path
p=Path('tools/financial-engine.mjs')
text=p.read_text()
old="""  let statement = atDay(done.getUTCFullYear(), done.getUTCMonth(), cycle.statementDay);\n  if (done.getTime() > statement.getTime()) statement = atDay(done.getUTCFullYear(), done.getUTCMonth()+1, cycle.statementDay);\n  const lookback = Number(cycle.lookbackDays || 30);\n  const periodEnd = statement;\n  const periodStart = addDays(periodEnd, -lookback);"""
new="""  let statement = atDay(done.getUTCFullYear(), done.getUTCMonth(), cycle.statementDay);\n  // O fechamento vale pelo dia civil inteiro: um serviço concluído no próprio dia 30\n  // pertence ao fechamento do dia 30, mesmo que tenha ocorrido depois do meio-dia.\n  if (dateOnly(done) > dateOnly(statement)) statement = atDay(done.getUTCFullYear(), done.getUTCMonth()+1, cycle.statementDay);\n  const periodEnd = statement;\n  // Para fechamento mensal ancorado em um dia fixo, o período é entre um fechamento\n  // e o próximo (ex.: 30/07 -> 30/08), preservando a regra comercial por calendário.\n  const periodStart = atDay(statement.getUTCFullYear(), statement.getUTCMonth()-1, cycle.statementDay);"""
if old not in text: raise SystemExit('MONTHLY_CYCLE_PATTERN_NOT_FOUND')
p.write_text(text.replace(old,new,1))
print('FINANCIAL_CYCLE_FIXED')
