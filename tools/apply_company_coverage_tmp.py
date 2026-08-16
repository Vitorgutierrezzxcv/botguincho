from pathlib import Path
p=Path('tools/vercel-whatsapp-worker.mjs'); s=p.read_text()
# settings fields
s=s.replace("  humanTakeover: false,\n};", "  humanTakeover: false,\n  serviceState: 'MG',\n  priorityCities: [],\n};",1)
# coverage constants / mutable state
old="""const SERVICE_STATE = 'MG';\nconst RMBH_PRIORITY_CITIES = [\n  'Belo Horizonte','Betim','Contagem','Nova Lima','Ribeirão das Neves','Sabará','Santa Luzia',\n  'Ibirité','Confins','Lagoa Santa','Vespasiano','Pedro Leopoldo','São José da Lapa','Matozinhos',\n  'Sarzedo','Mário Campos','Brumadinho','Igarapé','Juatuba','Mateus Leme','Esmeraldas','Caeté',\n  'Nova União','Rio Acima','Raposos','Itaguara','Itatiaiuçu','Florestal','Baldim','Capim Branco',\n];\nconst RMBH_PRIORITY_KEYS = RMBH_PRIORITY_CITIES.map((city) => normalizeForIntent(city));"""
new="""const DEFAULT_SERVICE_STATE = 'MG';\nconst DEFAULT_PRIORITY_CITIES = [\n  'Belo Horizonte','Betim','Contagem','Nova Lima','Ribeirão das Neves','Sabará','Santa Luzia',\n  'Ibirité','Confins','Lagoa Santa','Vespasiano','Pedro Leopoldo','São José da Lapa','Matozinhos',\n  'Sarzedo','Mário Campos','Brumadinho','Igarapé','Juatuba','Mateus Leme','Esmeraldas','Caeté',\n  'Nova União','Rio Acima','Raposos','Itaguara','Itatiaiuçu','Florestal','Baldim','Capim Branco',\n];\nlet configuredServiceState = DEFAULT_SERVICE_STATE;\nlet configuredPriorityCities = [...DEFAULT_PRIORITY_CITIES];\nlet configuredPriorityKeys = configuredPriorityCities.map((city) => normalizeForIntent(city));\n\nasync function refreshServiceArea() {\n  const settings = await getSettings();\n  const state = normalizeBrazilState(settings.serviceState || DEFAULT_SERVICE_STATE);\n  configuredServiceState = state || DEFAULT_SERVICE_STATE;\n  const cities = Array.isArray(settings.priorityCities) ? settings.priorityCities.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 80) : [];\n  configuredPriorityCities = cities.length ? cities : (configuredServiceState === 'MG' ? [...DEFAULT_PRIORITY_CITIES] : []);\n  configuredPriorityKeys = configuredPriorityCities.map((city) => normalizeForIntent(city));\n}\n\nfunction serviceAreaLabel() {\n  return configuredPriorityCities.length ? `${configuredServiceState} · cidades prioritárias configuradas` : configuredServiceState;\n}"""
if old not in s: raise SystemExit('coverage constants anchor missing')
s=s.replace(old,new,1)
s=s.replace('state !== SERVICE_STATE','state !== configuredServiceState')
s=s.replace('state === SERVICE_STATE','state === configuredServiceState')
s=s.replace("parts.state || SERVICE_STATE", "parts.state || configuredServiceState")
s=s.replace('RMBH_PRIORITY_KEYS.findIndex', 'configuredPriorityKeys.findIndex')
s=s.replace('RMBH_PRIORITY_CITIES[index]', 'configuredPriorityCities[index]')
# user agent generic
s=s.replace("BotGuincho/1.5 (cobertura-MG; https://botguincho.vercel.app/)", "BotGuincho/2.0 (cobertura-configuravel; https://botguincho.vercel.app/)")
# replies generic service state
s=s.replace("'Fora da área de atendimento. Atendemos somente Minas Gerais.'", "`Fora da área de atendimento. Atendemos somente ${configuredServiceState}.`")
# settings endpoint patch fields
needle="""    humanTakeover: Boolean(req.body?.humanTakeover),\n  };"""
replacement="""    humanTakeover: Boolean(req.body?.humanTakeover),\n    serviceState: typeof req.body?.serviceState === 'string' ? normalizeBrazilState(req.body.serviceState) || configuredServiceState : undefined,\n    priorityCities: Array.isArray(req.body?.priorityCities) ? req.body.priorityCities.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 80) : undefined,\n  };"""
if needle not in s: raise SystemExit('settings endpoint anchor missing')
s=s.replace(needle,replacement,1)
# after save in endpoint refresh area
s=s.replace("  res.json({ ok: true, settings: await saveSettings(patch) });", "  const settings = await saveSettings(patch);\n  await refreshServiceArea();\n  res.json({ ok: true, settings, serviceArea: { state: configuredServiceState, priorityCities: configuredPriorityCities } });",1)
# health/status expose coverage
s=s.replace("    recentErrors,\n  };", "    recentErrors,\n    serviceArea: { state: configuredServiceState, priorityCities: configuredPriorityCities, label: serviceAreaLabel() },\n  };",1)
s=s.replace("    groupsSelected: allowed.size,\n  });", "    groupsSelected: allowed.size,\n    serviceArea: { state: configuredServiceState, priorityCities: configuredPriorityCities },\n  });",1)
# startup refresh before WhatsApp
s=s.replace("await getPairCode();\nawait startWhatsApp();", "await getPairCode();\nawait refreshServiceArea();\nawait startWhatsApp();")
p.write_text(s)
print('company coverage patch applied')