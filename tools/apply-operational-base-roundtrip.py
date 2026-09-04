from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORKER = ROOT / 'tools/vercel-whatsapp-worker.mjs'
APP = ROOT / 'public/app.js'
INDEX = ROOT / 'public/index.html'
ROOT_APP = ROOT / 'app.js'
ROOT_INDEX = ROOT / 'index.html'

BASE = 'Rua Andre Luiz Pereira, 263, Residencial Lagoa, Betim - MG, CEP 32606-235'


def patch_worker(path: Path):
    s = path.read_text(encoding='utf-8')

    old = """async function getSettings() {\n  const saved = await readJson(settingsFile, {});\n  return { ...DEFAULT_SETTINGS, ...saved };\n}\n"""
    new = f"""const LEGACY_AMERICA_BASE_ADDRESS = '{BASE}';\n\nasync function getSettings() {{\n  const saved = await readJson(settingsFile, {{}});\n  const next = {{ ...DEFAULT_SETTINGS, ...saved }};\n  // Migração conservadora: somente a operação legada da América Guinchos recebe\n  // automaticamente a base já informada pelo proprietário. Novos tenants começam vazios.\n  if (clientId === 'cliente-teste' && !String(next.operationalBaseAddress || '').trim()) {{\n    next.operationalBaseAddress = LEGACY_AMERICA_BASE_ADDRESS;\n    await writeJson(settingsFile, next).catch(() => undefined);\n  }}\n  return next;\n}}\n"""
    if old in s:
        s = s.replace(old, new, 1)

    marker = """    aiInstructions: typeof req.body?.aiInstructions === 'string' ? req.body.aiInstructions.slice(0, 8000) : undefined,\n"""
    if marker in s and "operationalBaseAddress: typeof req.body?.operationalBaseAddress" not in s:
        s = s.replace(marker, marker + "    operationalBaseAddress: typeof req.body?.operationalBaseAddress === 'string' ? req.body.operationalBaseAddress.slice(0, 500).trim() : undefined,\n", 1)

    old_block = """  const reading = await getFreshTrackerReading();\n  if (!reading) return null;\n  const start = await trackerCoordinates(reading);\n  if (!start) return null;\n\n  const originPromise = originCoordinates\n    ? Promise.resolve({ latitude: Number(originCoordinates.latitude), longitude: Number(originCoordinates.longitude), displayName: originAddress || 'Origem' })\n    : geocodeAddress(originAddress);\n  const destinationPromise = geocodeAddress(destinationAddress);\n  const basePromise = baseAddress\n    ? geocodeAddress(baseAddress)\n    : Promise.resolve({ ...start, displayName: reading.address || 'Ponto de saída do caminhão' });\n  const [origin, destination, base] = await Promise.all([originPromise, destinationPromise, basePromise]);\n  if (!origin || !destination || !base) return null;\n\n  const [legToOrigin, serviceLeg, returnToBase] = await Promise.all([\n    routeBetween(start, origin),\n    routeBetween(origin, destination),\n    routeBetween(destination, base),\n  ]);\n  if (!legToOrigin || !serviceLeg || !returnToBase) return null;\n  const totalKm = Math.round((Number(legToOrigin.distanceKm || 0) + Number(serviceLeg.distanceKm || 0) + Number(returnToBase.distanceKm || 0)) * 10) / 10;\n  const totalMinutes = Number(legToOrigin.minutes || 0) + Number(serviceLeg.minutes || 0) + Number(returnToBase.minutes || 0);\n  return {\n    capturedAt: new Date().toISOString(),\n    basis: baseAddress ? 'truck_origin_destination_base' : 'truck_origin_destination_start',\n    start: { address: reading.address || '', latitude: start.latitude, longitude: start.longitude },\n    origin: { address: originAddress || origin.displayName || '', latitude: origin.latitude, longitude: origin.longitude, approximate: Boolean(origin.approximate), approximateLevel: origin.approximateLevel || null },\n    destination: { address: destinationAddress, latitude: destination.latitude, longitude: destination.longitude, approximate: Boolean(destination.approximate), approximateLevel: destination.approximateLevel || null },\n    base: { address: baseAddress || reading.address || 'Ponto de saída do caminhão', latitude: base.latitude, longitude: base.longitude },\n    legToOrigin: { km: legToOrigin.distanceKm, minutes: legToOrigin.minutes },\n    serviceLeg: { km: serviceLeg.distanceKm, minutes: serviceLeg.minutes },\n    returnToBase: { km: returnToBase.distanceKm, minutes: returnToBase.minutes },\n    totalKm,\n    totalMinutes,\n    routing: 'osrm_with_fallback',\n  };\n"""
    new_block = """  // O rastreador é usado apenas para ETA real até o cliente. O KM comercial\n  // é SEMPRE Base -> Origem -> Destino -> Base. Sem base não existe KM comercial confiável.\n  if (!baseAddress) return null;\n  const reading = await getFreshTrackerReading();\n  const trackerStart = reading ? await trackerCoordinates(reading) : null;\n\n  const originPromise = originCoordinates\n    ? Promise.resolve({ latitude: Number(originCoordinates.latitude), longitude: Number(originCoordinates.longitude), displayName: originAddress || 'Origem' })\n    : geocodeAddress(originAddress);\n  const destinationPromise = geocodeAddress(destinationAddress);\n  const basePromise = geocodeAddress(baseAddress);\n  const [origin, destination, base] = await Promise.all([originPromise, destinationPromise, basePromise]);\n  if (!origin || !destination || !base) return null;\n\n  const routePromises = [\n    routeBetween(base, origin),\n    routeBetween(origin, destination),\n    routeBetween(destination, base),\n    trackerStart ? routeBetween(trackerStart, origin) : Promise.resolve(null),\n  ];\n  const [baseToOrigin, serviceLeg, returnToBase, trackerToOrigin] = await Promise.all(routePromises);\n  if (!baseToOrigin || !serviceLeg || !returnToBase) return null;\n  const totalKm = Math.round((Number(baseToOrigin.distanceKm || 0) + Number(serviceLeg.distanceKm || 0) + Number(returnToBase.distanceKm || 0)) * 10) / 10;\n  const totalMinutes = Number(baseToOrigin.minutes || 0) + Number(serviceLeg.minutes || 0) + Number(returnToBase.minutes || 0);\n  return {\n    capturedAt: new Date().toISOString(),\n    basis: 'base_origin_destination_base',\n    start: trackerStart ? { address: reading?.address || '', latitude: trackerStart.latitude, longitude: trackerStart.longitude } : null,\n    origin: { address: originAddress || origin.displayName || '', latitude: origin.latitude, longitude: origin.longitude, approximate: Boolean(origin.approximate), approximateLevel: origin.approximateLevel || null },\n    destination: { address: destinationAddress, latitude: destination.latitude, longitude: destination.longitude, approximate: Boolean(destination.approximate), approximateLevel: destination.approximateLevel || null },\n    base: { address: baseAddress, latitude: base.latitude, longitude: base.longitude },\n    legToOrigin: { km: baseToOrigin.distanceKm, minutes: baseToOrigin.minutes },\n    serviceLeg: { km: serviceLeg.distanceKm, minutes: serviceLeg.minutes },\n    returnToBase: { km: returnToBase.distanceKm, minutes: returnToBase.minutes },\n    trackerToOrigin: trackerToOrigin ? { km: trackerToOrigin.distanceKm, minutes: trackerToOrigin.minutes } : null,\n    totalKm,\n    totalMinutes,\n    routing: 'osrm_with_fallback',\n  };\n"""
    if old_block not in s:
        raise SystemExit('computeFullServiceRoute block not found')
    s = s.replace(old_block, new_block, 1)

    s = s.replace("minutes: fullRoute.legToOrigin?.minutes ?? null,", "minutes: fullRoute.trackerToOrigin?.minutes ?? fullRoute.legToOrigin?.minutes ?? null,")
    s = s.replace("distanceKm: fullRoute.legToOrigin?.km ?? null,", "distanceKm: fullRoute.trackerToOrigin?.km ?? fullRoute.legToOrigin?.km ?? null,")

    path.write_text(s, encoding='utf-8')


def patch_index(path: Path):
    s = path.read_text(encoding='utf-8')
    anchor = '<div class="grid2"><div class="card"><h3>Automações ativas</h3><div id="automationList" class="section"></div></div><div class="card"><h3>Empresa</h3><p class="muted">Dados usados no controle interno.</p><button class="btn secondary section" id="companyBtn">Editar dados da empresa</button></div></div>'
    card = anchor + f'<div class="card section"><div class="head"><div><h3>Base operacional</h3><p>Usada no cálculo comercial de todas as corridas.</p></div></div><div class="notice good section">Regra de KM: <b>Base → Cliente → Destino → Base</b>. O rastreador continua sendo usado somente para a previsão real de chegada ao cliente.</div><div class="form-grid section"><div class="field" style="grid-column:1/-1"><label>Endereço da base</label><input id="operationalBaseAddress" placeholder="Rua, número, bairro, cidade, UF e CEP" value=""></div></div><div class="actions"><button class="btn" id="saveOperationalBase">Salvar base</button></div><div id="operationalBaseNotice" class="notice good section" style="display:none"></div></div>'
    if 'id="operationalBaseAddress"' not in s:
        if anchor not in s:
            raise SystemExit(f'automations anchor not found in {path}')
        s = s.replace(anchor, card, 1)
    path.write_text(s, encoding='utf-8')


def patch_app(path: Path):
    s = path.read_text(encoding='utf-8')
    s = s.replace("if(name==='automations'){loadExcludedAreas();loadOperatingHours();}", "if(name==='automations'){loadExcludedAreas();loadOperatingHours();loadOperationalBase();}")
    marker = "async function loadSettings(){try{const d=await api('/api/worker/settings');"
    if 'async function loadOperationalBase()' not in s:
        fn = """async function loadOperationalBase(){try{const d=await api('/api/worker/settings');if($('operationalBaseAddress'))$('operationalBaseAddress').value=d.operationalBaseAddress||'';if($('operationalBaseNotice')){$('operationalBaseNotice').style.display='block';$('operationalBaseNotice').className='notice '+(d.operationalBaseAddress?'good':'warn');$('operationalBaseNotice').textContent=d.operationalBaseAddress?'Base configurada. O KM comercial usa Base → Cliente → Destino → Base.':'Configure a base para liberar o cálculo comercial completo.'}}catch(e){if($('operationalBaseNotice')){$('operationalBaseNotice').style.display='block';$('operationalBaseNotice').className='notice bad';$('operationalBaseNotice').textContent=e.message}}}\nif($('saveOperationalBase'))$('saveOperationalBase').onclick=async()=>{const address=String($('operationalBaseAddress')?.value||'').trim();if(!address){alert('Informe o endereço completo da base.');return}await api('/api/worker/settings',{method:'POST',body:JSON.stringify({operationalBaseAddress:address})});await loadOperationalBase();alert('Base operacional salva. As próximas cotações usarão Base → Cliente → Destino → Base.')};;\n"""
        if marker not in s:
            raise SystemExit(f'loadSettings marker not found in {path}')
        s = s.replace(marker, fn + marker, 1)
    path.write_text(s, encoding='utf-8')


patch_worker(WORKER)
for p in [INDEX, ROOT_INDEX]:
    if p.exists(): patch_index(p)
for p in [APP, ROOT_APP]:
    if p.exists(): patch_app(p)
print('Operational base + roundtrip commercial routing patch applied.')
