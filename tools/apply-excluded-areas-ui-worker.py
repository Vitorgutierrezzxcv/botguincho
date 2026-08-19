from pathlib import Path
import re


def replace_once(path, old, new):
    p = Path(path)
    s = p.read_text()
    if new in s:
        return
    if old not in s:
        raise SystemExit(f'marker missing in {path}: {old[:120]!r}')
    p.write_text(s.replace(old, new, 1))


def regex_replace_once(path, pattern, replacement):
    p = Path(path)
    s = p.read_text()
    if re.search(pattern, s, flags=re.S) is None:
        raise SystemExit(f'regex marker missing in {path}: {pattern}')
    p.write_text(re.sub(pattern, replacement, s, count=1, flags=re.S))

worker = 'tools/vercel-whatsapp-worker.mjs'
replace_once(
    worker,
    "import { classifyRuntimeIntent, resolveGroupProfile, extractOperationalFacts, buildEvidenceChecklist, reconcileCommercial, learningContextForGroup, shouldStaySilent } from './operational-knowledge.mjs';",
    "import { classifyRuntimeIntent, resolveGroupProfile, extractOperationalFacts, buildEvidenceChecklist, reconcileCommercial, learningContextForGroup, shouldStaySilent } from './operational-knowledge.mjs';\nimport { sanitizeExcludedAreas, matchExcludedArea } from './excluded-areas.mjs';",
)

replace_once(
    worker,
    "  serviceState: 'MG',\n  priorityCities: [],\n};",
    "  serviceState: 'MG',\n  priorityCities: [],\n  excludedAreas: [],\n  outOfRouteReply: 'Motorista fora de rota.',\n};",
)

helper = r'''
async function reverseGeocodeRegionForExclusion(coordinates) {
  if (!coordinates || !validCoordinates(coordinates.latitude, coordinates.longitude)) return null;
  try {
    const url = new URL('https://nominatim.openstreetmap.org/reverse');
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('lat', String(coordinates.latitude));
    url.searchParams.set('lon', String(coordinates.longitude));
    url.searchParams.set('zoom', '18');
    url.searchParams.set('addressdetails', '1');
    const response = await fetch(url, {
      headers: {
        'user-agent': 'BotGuincho/2.1 (areas-fora-de-rota; https://botguincho.vercel.app/)',
        'accept-language': 'pt-BR,pt;q=0.9',
      },
      signal: AbortSignal.timeout(9000),
    });
    if (!response.ok) return null;
    const data = await response.json();
    const address = data?.address || {};
    return {
      city: address.city || address.town || address.municipality || address.village || address.county || '',
      district: address.neighbourhood || address.suburb || address.city_district || address.quarter || address.hamlet || '',
      state: normalizeBrazilState(address.state || String(address['ISO3166-2-lvl4'] || '').split('-').pop() || ''),
      displayName: data?.display_name || '',
    };
  } catch (error) {
    logEvent('warning', 'Não foi possível identificar cidade/bairro para regra de fora de rota.', { error: String(error) });
    return null;
  }
}

function matchConfiguredExcludedAddress(address, scope, settings, region = null) {
  const areas = sanitizeExcludedAreas(settings?.excludedAreas || []);
  if (!areas.length) return null;
  const parsedAddress = address && !extractMapsUrl(address) && !coordinatesFromText(address)
    ? parseBrazilAddress(address)
    : null;
  return matchExcludedArea({ address, parsedAddress, region, areas, scope });
}

async function resolveConfiguredExcludedAddress(address, scope, settings) {
  if (!address) return null;
  const direct = matchConfiguredExcludedAddress(address, scope, settings);
  if (direct) return direct;

  let coordinates = coordinatesFromText(address);
  if (!coordinates && extractMapsUrl(address)) coordinates = await coordinatesFromMapsUrl(address).catch(() => null);
  if (!coordinates) return null;
  const region = await reverseGeocodeRegionForExclusion(coordinates);
  return region ? matchConfiguredExcludedAddress(address, scope, settings, region) : null;
}

async function findConfiguredExcludedArea({ groupId, readableText, facts = {}, incomingLocation = null, settings }) {
  const areas = sanitizeExcludedAreas(settings?.excludedAreas || []);
  if (!areas.length) return null;

  const originAddress = extractLabeledField(readableText, 'Origem') || facts.origin || null;
  const destinationAddress = extractLabeledField(readableText, 'Destino') || facts.destination || null;

  if (originAddress) {
    const originMatch = await resolveConfiguredExcludedAddress(originAddress, 'origin', settings);
    if (originMatch) return { ...originMatch, address: originAddress };
  }
  if (destinationAddress) {
    const destinationMatch = await resolveConfiguredExcludedAddress(destinationAddress, 'destination', settings);
    if (destinationMatch) return { ...destinationMatch, address: destinationAddress };
  }

  let originCoordinates = incomingLocation;
  if (!originAddress && !originCoordinates && groupId) {
    const shared = await getRecentSharedLocation(groupId).catch(() => null);
    if (shared?.coordinates && Number.isFinite(shared.at) && Date.now() - shared.at <= 15 * 60 * 1000) {
      originCoordinates = shared.coordinates;
    }
  }
  if (!originAddress && originCoordinates) {
    const region = await reverseGeocodeRegionForExclusion(originCoordinates);
    const locationMatch = region ? matchExcludedArea({ region, areas, scope: 'origin' }) : null;
    if (locationMatch) return { ...locationMatch, region };
  }

  return null;
}

function outOfRouteReply(settings) {
  return String(settings?.outOfRouteReply || 'Motorista fora de rota.').trim().slice(0, 300) || 'Motorista fora de rota.';
}

'''
replace_once(
    worker,
    "async function currentOperationalContext(groupId, groupName, text) {",
    helper + "async function currentOperationalContext(groupId, groupName, text) {",
)

replace_once(
    worker,
    "  if (!targetAddress) return false;\n\n  if (isExplicitlyOutOfCoverage(targetAddress)) {",
    "  if (!targetAddress) return false;\n\n  const areaSettings = await getSettings();\n  const excludedArea = await resolveConfiguredExcludedAddress(targetAddress, 'origin', areaSettings);\n  if (excludedArea) {\n    await replyAndRemember(msg, groupName, readableText, outOfRouteReply(areaSettings), { intent: 'out-of-route', areaType: excludedArea.type, areaName: excludedArea.name, scope: 'origin' });\n    logEvent('coverage', `${groupName}: endereço recusado por área fora de rota.`, { groupId: msg.from, areaType: excludedArea.type, areaName: excludedArea.name, scope: 'origin' });\n    return true;\n  }\n\n  if (isExplicitlyOutOfCoverage(targetAddress)) {",
)

replace_once(
    worker,
    "    const operationalContext = await currentOperationalContext(msg.from, groupName, readableText);\n    const runtimeIntent = operationalContext.intent;\n\n    if (shouldStaySilent(runtimeIntent, groupName)) {",
    "    const operationalContext = await currentOperationalContext(msg.from, groupName, readableText);\n    const runtimeIntent = operationalContext.intent;\n\n    const canBeRejectedByArea = ['availability','quote','dispatch','authorization','formal_dispatch','scheduled_dispatch'].includes(runtimeIntent);\n    if (canBeRejectedByArea) {\n      const excludedArea = await findConfiguredExcludedArea({\n        groupId: msg.from, readableText, facts: operationalContext.facts, incomingLocation, settings,\n      });\n      if (excludedArea) {\n        await replyAndRemember(msg, groupName, readableText, outOfRouteReply(settings), {\n          intent: 'out-of-route', areaType: excludedArea.type, areaName: excludedArea.name, scope: excludedArea.scope,\n        });\n        logEvent('coverage', `${groupName}: atendimento recusado por área fora de rota.`, {\n          groupId: msg.from, areaType: excludedArea.type, areaName: excludedArea.name, scope: excludedArea.scope,\n        });\n        return;\n      }\n    }\n\n    if (shouldStaySilent(runtimeIntent, groupName)) {",
)

replace_once(
    worker,
    "    aiEnabled: req.body?.aiEnabled !== false,\n    aiModel: typeof req.body?.aiModel === 'string' ? req.body.aiModel.slice(0, 80) : undefined,\n    aiInstructions: typeof req.body?.aiInstructions === 'string' ? req.body.aiInstructions.slice(0, 8000) : undefined,\n    replyEveryMessage: req.body?.replyEveryMessage !== false,\n    humanTakeover: Boolean(req.body?.humanTakeover),",
    "    aiEnabled: typeof req.body?.aiEnabled === 'boolean' ? req.body.aiEnabled : undefined,\n    aiModel: typeof req.body?.aiModel === 'string' ? req.body.aiModel.slice(0, 80) : undefined,\n    aiInstructions: typeof req.body?.aiInstructions === 'string' ? req.body.aiInstructions.slice(0, 8000) : undefined,\n    replyEveryMessage: typeof req.body?.replyEveryMessage === 'boolean' ? req.body.replyEveryMessage : undefined,\n    humanTakeover: typeof req.body?.humanTakeover === 'boolean' ? req.body.humanTakeover : undefined,",
)

replace_once(
    worker,
    "    priorityCities: Array.isArray(req.body?.priorityCities) ? req.body.priorityCities.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 80) : undefined,\n  };",
    "    priorityCities: Array.isArray(req.body?.priorityCities) ? req.body.priorityCities.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 80) : undefined,\n    excludedAreas: Array.isArray(req.body?.excludedAreas) ? sanitizeExcludedAreas(req.body.excludedAreas) : undefined,\n    outOfRouteReply: typeof req.body?.outOfRouteReply === 'string' ? req.body.outOfRouteReply.trim().slice(0, 300) || 'Motorista fora de rota.' : undefined,\n  };",
)

reload = 'api/worker/reload.js'
replace_once(
    reload,
    "  'tools/operational-knowledge.mjs',\n];",
    "  'tools/operational-knowledge.mjs',\n  'tools/excluded-areas.mjs',\n];",
)

new_automations = '''<section id="automations" class="page"><div class="head"><div><h2>Automações</h2><p>Regras operacionais e financeiras.</p></div></div><div class="grid2"><div class="card"><h3>Automações ativas</h3><div id="automationList" class="section"></div></div><div class="card"><h3>Empresa</h3><p class="muted">Dados usados no controle interno.</p><button class="btn secondary section" id="companyBtn">Editar dados da empresa</button></div></div><div class="card section"><div class="head"><div><h3>Áreas fora de rota</h3><p>Cadastre cidades e bairros que o motorista não deve aceitar. A configuração é exclusiva desta empresa.</p></div></div><div class="notice warn section">Quando a origem ou o destino coincidir com uma regra cadastrada, o bot recusa antes de confirmar o atendimento.</div><div class="form-grid section"><div class="field"><label>Tipo</label><select id="excludedAreaType"><option value="city">Cidade</option><option value="neighborhood">Bairro</option></select></div><div class="field"><label>Nome</label><input id="excludedAreaName" placeholder="Ex.: Juatuba ou Citrolândia"></div><div class="field"><label>Cidade do bairro</label><input id="excludedAreaCity" placeholder="Ex.: Betim (opcional)"></div><div class="field"><label>Aplicar em</label><select id="excludedAreaScope"><option value="origin">Origem</option><option value="destination">Destino</option><option value="both">Origem e destino</option></select></div></div><button class="btn secondary small" id="addExcludedArea">+ Adicionar área</button><div id="excludedAreaList" class="events section"><div class="empty">Nenhuma área cadastrada.</div></div><div class="form-grid section"><div class="field"><label>Resposta automática</label><input id="outOfRouteReply" value="Motorista fora de rota."></div></div><div class="actions"><button class="btn" id="saveExcludedAreas">Salvar áreas fora de rota</button></div><div id="excludedAreaNotice" class="notice good section" style="display:none"></div></div></section>'''
for html in ['index.html', 'public/index.html']:
    regex_replace_once(
        html,
        r'<section id="automations" class="page">.*?</section>\n<section id="whatsapp"',
        new_automations + '\n<section id="whatsapp"',
    )

coverage_js = r'''
let excludedAreasDraft=[];
function renderExcludedAreas(){
  const box=$('excludedAreaList');if(!box)return;
  if(!excludedAreasDraft.length){box.innerHTML='<div class="empty">Nenhuma área cadastrada.</div>';return;}
  const typeName={city:'Cidade',neighborhood:'Bairro'},scopeName={origin:'Origem',destination:'Destino',both:'Origem e destino'};
  box.innerHTML=excludedAreasDraft.map((a,i)=>`<div class="event"><div><b>${esc(typeName[a.type]||a.type)}: ${esc(a.name)}</b><small>${a.type==='neighborhood'&&a.city?esc(a.city)+' · ':''}${esc(scopeName[a.scope]||'Origem')}</small></div><button class="btn small ghost" onclick="removeExcludedArea(${i})">Remover</button></div>`).join('');
}
function syncExcludedAreaFields(){const isCity=$('excludedAreaType')?.value==='city';if($('excludedAreaCity')){$('excludedAreaCity').disabled=isCity;if(isCity)$('excludedAreaCity').value='';}}
async function loadExcludedAreas(){try{const d=await api('/api/worker/settings');excludedAreasDraft=Array.isArray(d.excludedAreas)?d.excludedAreas.map(x=>({...x})):[];if($('outOfRouteReply'))$('outOfRouteReply').value=d.outOfRouteReply||'Motorista fora de rota.';renderExcludedAreas();syncExcludedAreaFields()}catch(e){if($('excludedAreaList'))$('excludedAreaList').innerHTML=`<div class="empty">${esc(e.message)}</div>`}}
window.removeExcludedArea=i=>{excludedAreasDraft.splice(i,1);renderExcludedAreas()};
$('excludedAreaType')?.addEventListener('change',syncExcludedAreaFields);
$('addExcludedArea')?.addEventListener('click',()=>{const type=$('excludedAreaType').value,name=$('excludedAreaName').value.trim(),city=$('excludedAreaCity').value.trim(),scope=$('excludedAreaScope').value;if(!name){$('excludedAreaNotice').style.display='block';$('excludedAreaNotice').className='notice bad section';$('excludedAreaNotice').textContent='Informe o nome da cidade ou do bairro.';return}excludedAreasDraft.push({type,name,city:type==='neighborhood'?city:'',scope});$('excludedAreaName').value='';$('excludedAreaCity').value='';renderExcludedAreas();$('excludedAreaNotice').style.display='none'});
$('saveExcludedAreas')?.addEventListener('click',async()=>{try{const reply=$('outOfRouteReply').value.trim()||'Motorista fora de rota.';const d=await api('/api/worker/settings',{method:'POST',body:JSON.stringify({excludedAreas:excludedAreasDraft,outOfRouteReply:reply})});excludedAreasDraft=Array.isArray(d.settings?.excludedAreas)?d.settings.excludedAreas:excludedAreasDraft;renderExcludedAreas();$('excludedAreaNotice').style.display='block';$('excludedAreaNotice').className='notice good section';$('excludedAreaNotice').textContent='Áreas fora de rota salvas para esta empresa.'}catch(e){$('excludedAreaNotice').style.display='block';$('excludedAreaNotice').className='notice bad section';$('excludedAreaNotice').textContent=e.message}});

'''
for js in ['app.js', 'public/app.js']:
    replace_once(
        js,
        "if(['dashboard','operations','calls','clients','finance','fleet','automations'].includes(name))loadManagement();",
        "if(['dashboard','operations','calls','clients','finance','fleet','automations'].includes(name))loadManagement();if(name==='automations')loadExcludedAreas();",
    )
    replace_once(js, "async function loadGroups(){", coverage_js + "async function loadGroups(){")

for sw in ['sw.js', 'public/sw.js']:
    p = Path(sw)
    s = p.read_text()
    s = re.sub(r"bot-guincho-pwa-v\d+", "bot-guincho-pwa-v7", s, count=1)
    p.write_text(s)

print('excluded areas patch applied')
