from pathlib import Path
p=Path('tools/operational-knowledge.mjs')
text=p.read_text()
old="""  if (profile.key === 'company-truck' && /cotacao\\s+visao|tipo\\s*:\\s*visao/.test(value)) return 'quote';\n  if (hasQuoteSignals(text)) return 'quote';\n  if (base === 'authorization') return 'authorization';\n  if (base === 'closure') return 'closure';"""
new="""  if (profile.key === 'company-truck' && /cotacao\\s+visao|tipo\\s*:\\s*visao/.test(value)) return 'quote';\n\n  // A mesma pergunta de valor muda de significado conforme o estado do chamado.\n  // Depois da autorização/execução, frases de finalização são fechamento, não nova cotação.\n  const activeService = ['autorizado','a_caminho','em_atendimento'].includes(recentCall?.status);\n  const closureQuestion = /\\b(finaliz|fechamento|fechamos|quanto finalizou|em quantos km|quantos km|km final|km e valor|valor final|finalizou em)\\b/.test(value);\n  if (activeService && (base === 'closure' || closureQuestion)) return 'closure';\n\n  if (hasQuoteSignals(text)) return 'quote';\n  if (base === 'authorization') return 'authorization';\n  if (base === 'closure') return 'closure';"""
if old not in text: raise SystemExit('CONTEXTUAL_CLOSURE_PATTERN_NOT_FOUND')
p.write_text(text.replace(old,new,1))
print('CONTEXTUAL_CLOSURE_FIXED')
