from pathlib import Path

# 1) Worker: shutdown gracioso para preservar LocalAuth/Chromium.
wp=Path('tools/vercel-whatsapp-worker.mjs')
s=wp.read_text()
marker="await ensureDir();\nawait getPairCode();"
shutdown=r'''let gracefulShutdownStarted = false;
async function gracefulShutdown(signal = 'shutdown') {
  if (gracefulShutdownStarted) return;
  gracefulShutdownStarted = true;
  logEvent('system', `Encerramento gracioso iniciado (${signal}).`);
  const current = waClient;
  waClient = null;
  if (current) {
    await Promise.race([
      current.destroy().catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, 8000)),
    ]);
  }
  await new Promise((resolve) => setTimeout(resolve, 250));
  process.exit(0);
}
process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => void gracefulShutdown('SIGINT'));

'''
if shutdown not in s:
    if marker not in s: raise SystemExit('worker shutdown marker missing')
    s=s.replace(marker,shutdown+marker,1)
wp.write_text(s)

# 2) HTML: painel de aprendizado dentro de Grupos.
old_groups='<section id="groups" class="page"><div class="head"><div><h2>Grupos</h2><p>O bot só responde onde estiver autorizado.</p></div><div class="actions"><button class="btn secondary" id="syncGroups">Sincronizar</button><button class="btn" id="saveGroups">Salvar</button></div></div><div class="card"><div id="groupList" class="groups"><div class="empty">Carregando...</div></div></div></section>'
new_groups='<section id="groups" class="page"><div class="head"><div><h2>Grupos</h2><p>Autorize os grupos e acompanhe o que o robô aprendeu em cada operação.</p></div><div class="actions"><button class="btn secondary" id="syncGroups">Sincronizar</button><button class="btn" id="saveGroups">Salvar</button></div></div><div class="card"><div id="groupList" class="groups"><div class="empty">Carregando...</div></div></div><div class="card section"><div class="head"><div><h3>Aprendizado e tabela comercial</h3><p>Descrição, histórico, exemplos humanos e regras de preço por grupo.</p></div><button class="btn secondary small" id="refreshKnowledge">Atualizar aprendizado</button></div><div class="notice warn section">Valores só entram automaticamente no Financeiro depois que a tabela comercial do grupo for aprovada. Divergências ficam para conferência.</div><div id="knowledgeList" class="grid2 section"><div class="empty">Carregando conhecimento...</div></div></div></section>'
for file in ['index.html','public/index.html']:
    p=Path(file)
    if not p.exists(): continue
    text=p.read_text()
    if new_groups not in text:
        if old_groups not in text: raise SystemExit(f'groups html marker missing: {file}')
        text=text.replace(old_groups,new_groups,1)
    p.write_text(text)

# 3) JS: carregar/mostrar/aprovar conhecimento e novos estados.
new_group_js=r'''async function loadGroups(){try{const d=await api('/api/worker/groups');$('groupList').innerHTML=(d.groups||[]).map(g=>`<label class="group"><input type="checkbox" value="${esc(g.id)}" ${g.selected?'checked':''}><div><b>${esc(g.name||'Grupo')}</b><div class="small">${esc(g.id)}</div></div></label>`).join('')||'<div class="empty">Nenhum grupo.</div>'}catch(e){$('groupList').innerHTML=`<div class="empty">${esc(e.message)}</div>`}}
function commercialRuleHtml(k){const r=(k.commercialStatus==='approved'?k.approvedCommercialRules:k.draftCommercialRules)||{};const entries=Object.entries(r.services||{}).filter(([,x])=>Number(x?.basePrice)>0);const lines=entries.map(([name,x])=>`<div class="kpi-line"><span>${esc(name.replaceAll('_',' '))}</span><b>${money(x.basePrice)} até ${esc(x.includedKm??'—')} km · ${money(x.pricePerKm)}/km</b></div>`).join('');const extras=[r.workedHour?`Hora trabalhada ${money(r.workedHour)}`:'',r.stoppedHour?`Hora parada ${money(r.stoppedHour)}`:'',r.invoiceFee?`NF ${money(r.invoiceFee)}`:'',r.tollAllowed?'Pedágio separado':''].filter(Boolean).join(' · ');return `${lines||'<div class="muted">Nenhuma tabela estruturada detectada.</div>'}${extras?`<div class="small section">${esc(extras)}</div>`:''}`}
async function loadKnowledge(){if(!$('knowledgeList'))return;try{const [gd,kd]=await Promise.all([api('/api/worker/groups'),api('/api/worker/group-knowledge')]);const selected=new Set((gd.groups||[]).filter(g=>g.selected).map(g=>g.id));const items=(kd.groups||[]).filter(k=>selected.has(k.groupId));$('knowledgeList').innerHTML=items.length?items.map(k=>{const approved=k.commercialStatus==='approved',review=k.commercialStatus==='review_required',detected=!!k.draftCommercialRules?.detected;const status=approved?'Tabela aprovada':review?'Revisar tabela':detected?'Tabela detectada':'Sem tabela detectada';const statusClass=approved?'green':review?'yellow':'yellow';const versions=(k.commercialVersions||[]).length;return `<div class="card"><div class="head"><div><h3>${esc(k.name||'Grupo')}</h3><p>${esc((k.description||'Sem descrição').slice(0,180))}</p></div><span class="tag ${statusClass}">${status}</span></div>${commercialRuleHtml(k)}<div class="kpi-line section"><span>Exemplos humanos aprendidos</span><b>${(k.examples||[]).length}</b></div><div class="kpi-line"><span>Versões comerciais preservadas</span><b>${versions}</b></div><div class="actions section"><button class="btn secondary small" onclick="importGroupHistory('${esc(k.groupId)}')">Importar histórico</button><button class="btn secondary small" onclick="refreshGroupKnowledge('${esc(k.groupId)}')">Ler descrição</button>${detected&&!approved?`<button class="btn small" onclick="approveGroupCommercial('${esc(k.groupId)}','${esc(k.name||'grupo')}')">Aprovar tabela</button>`:''}</div></div>`}).join(''):'<div class="empty">Selecione e salve ao menos um grupo autorizado para iniciar o aprendizado.</div>'}catch(e){$('knowledgeList').innerHTML=`<div class="empty">${esc(e.message)}</div>`}}
window.refreshGroupKnowledge=async id=>{await api('/api/worker/group-knowledge',{method:'POST',body:JSON.stringify({groupId:id,action:'refresh'})});await loadKnowledge()};
window.importGroupHistory=async id=>{if(!confirm('Importar até 1.000 mensagens disponíveis deste grupo para aprendizado? O robô não responderá mensagens antigas.'))return;const d=await api('/api/worker/learning-import',{method:'POST',body:JSON.stringify({groupId:id,limit:1000})});alert(`${d.imported||0} mensagens novas importadas.`);await loadKnowledge()};
window.approveGroupCommercial=async(id,name)=>{if(!confirm(`Aprovar a tabela comercial atualmente detectada em ${name}? Ela poderá ser usada em cotações e conferências financeiras.`))return;await api('/api/worker/group-knowledge',{method:'POST',body:JSON.stringify({groupId:id,action:'approve-commercial'})});await loadKnowledge()};
$('saveGroups').onclick=async()=>{const ids=$$('#groupList input:checked').map(x=>x.value);await api('/api/worker/groups',{method:'POST',body:JSON.stringify({groupIds:ids})});await loadStatus();await loadKnowledge();alert('Grupos salvos')};$('syncGroups').onclick=async()=>{await loadGroups();await loadKnowledge()};if($('refreshKnowledge'))$('refreshKnowledge').onclick=loadKnowledge;
'''
for file in ['app.js','public/app.js']:
    p=Path(file)
    if not p.exists(): continue
    text=p.read_text()
    text=text.replace("if(name==='groups')loadGroups();","if(name==='groups'){loadGroups();loadKnowledge();}")
    start=text.find('async function loadGroups()')
    end=text.find('async function loadTracker()',start)
    if start<0 or end<0: raise SystemExit(f'loadGroups JS marker missing: {file}')
    text=text[:start]+new_group_js+text[end:]
    text=text.replace("['novo','a_caminho','em_atendimento','concluido','cancelado']","['novo','cotacao','aguardando_aprovacao','autorizado','agendado','a_caminho','em_atendimento','concluido','cancelado']")
    old="<td>${money(c.value)}</td><td><button class=\"btn small ghost\" onclick=\"editItem('calls','${c.id}')\">Editar</button></td>"
    new="<td>${money(c.value)}${c.financeReviewRequired?'<br><span class=\"tag red\">Conferir financeiro</span>':c.estimatedTotalKm?`<br><span class=\"small\">Estimativa ${esc(c.estimatedTotalKm)} km</span>`:''}</td><td><button class=\"btn small ghost\" onclick=\"editItem('calls','${c.id}')\">Editar</button></td>"
    if old in text: text=text.replace(old,new,1)
    p.write_text(text)

print('LEARNING_UI_AND_SHUTDOWN_PATCH_OK')
