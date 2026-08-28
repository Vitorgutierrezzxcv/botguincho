from pathlib import Path

worker = Path('tools/vercel-whatsapp-worker.mjs')
s = worker.read_text()
old = """app.get('/api/management', async (req, res) => {
  try {
    const data = await getManagement();
    const calls = (data.calls || []).filter((item) => !isTestCall(item));
    const filters = { from: String(req.query.from || ''), to: String(req.query.to || ''), groupId: String(req.query.groupId || ''), insurerId: String(req.query.insurerId || '') };
    return res.json({ ok: true, data: { ...data, calls }, quoteFunnel: buildQuoteFunnel(calls, data.insurers || [], filters), periodReport: buildPeriodReport({ ...data, calls }, filters) });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});"""
new = """app.get('/api/management', async (req, res) => {
  try {
    const data = await getManagement();
    const allCalls = data.calls || [];
    const calls = allCalls.filter((item) => !isTestCall(item));
    const testCalls = allCalls.filter((item) => isTestCall(item));
    const filters = { from: String(req.query.from || ''), to: String(req.query.to || ''), groupId: String(req.query.groupId || ''), insurerId: String(req.query.insurerId || '') };
    return res.json({
      ok: true,
      data: { ...data, calls, testCalls },
      quoteFunnel: buildQuoteFunnel(calls, data.insurers || [], filters),
      periodReport: buildPeriodReport({ ...data, calls }, filters),
      testSummary: {
        total: testCalls.length,
        quotes: testCalls.filter((item) => item.quoteTracked === true || ['cotacao','aguardando_dados','aguardando_aprovacao'].includes(item.status)).length,
        accepted: testCalls.filter((item) => Boolean(item.authorizedAt) || ['autorizado','a_caminho','em_atendimento','aguardando_fechamento','concluido'].includes(item.status)).length,
      },
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});"""
if s.count(old) != 1:
    raise SystemExit(f'rota management: esperado 1 trecho, encontrado {s.count(old)}')
worker.write_text(s.replace(old, new, 1))

js = r'''(() => {
  'use strict';
  const statusLabel = { cotacao:'Cotação aberta', aguardando_dados:'Aguardando dados', aguardando_aprovacao:'Aguardando aprovação', autorizado:'Aceita', agendado:'Agendada', a_caminho:'A caminho', em_atendimento:'Em atendimento', aguardando_fechamento:'Aguardando fechamento', concluido:'Concluída', cancelado:'Cancelada' };
  const accepted = new Set(['autorizado','a_caminho','em_atendimento','aguardando_fechamento','concluido']);
  const isQuote = (c) => c?.quoteTracked === true || ['cotacao','aguardando_dados','aguardando_aprovacao'].includes(c?.status) || ['open','won','lost'].includes(c?.quoteOutcome);
  const outcome = (c) => c?.quoteOutcome === 'won' || accepted.has(c?.status) || c?.authorizedAt ? 'Ganha' : c?.quoteOutcome === 'lost' || (c?.status === 'cancelado' && !c?.authorizedAt) ? 'Perdida' : 'Em aberto';
  const stamp = (value) => { try { return new Date(value).toLocaleString('pt-BR'); } catch { return '—'; } };

  function styles() {
    if (document.getElementById('testModeStyles')) return;
    const style = document.createElement('style');
    style.id = 'testModeStyles';
    style.textContent = `
      .test-mode-card{border:1px solid #93c5fd;background:linear-gradient(135deg,#eff6ff,#f8fbff);box-shadow:0 10px 30px rgba(37,99,235,.08)}
      .test-mode-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}
      .test-mode-badge{display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border-radius:999px;background:#dbeafe;color:#1d4ed8;font-size:12px;font-weight:800;letter-spacing:.04em}
      .test-mode-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-top:14px}
      .test-mode-metric{background:#fff;border:1px solid #dbeafe;border-radius:14px;padding:12px}.test-mode-metric span{display:block;color:#64748b;font-size:12px}.test-mode-metric b{display:block;color:#0f172a;font-size:24px;margin-top:4px}
      .test-mode-list{display:grid;gap:8px;margin-top:14px}.test-mode-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;background:#fff;border:1px solid #dbeafe;border-radius:14px;padding:12px}.test-mode-row small{display:block;color:#64748b;margin-top:5px}.test-mode-status{align-self:start;padding:5px 8px;border-radius:999px;background:#eff6ff;color:#1d4ed8;font-size:11px;font-weight:800}.test-mode-route{margin-top:5px;font-size:13px;color:#334155}
      @media(max-width:720px){.test-mode-metrics{grid-template-columns:1fr 1fr}.test-mode-head{display:block}.test-mode-badge{margin-top:10px}.test-mode-row{grid-template-columns:1fr}.test-mode-status{justify-self:start}}
    `;
    document.head.appendChild(style);
  }

  function renderTestMode() {
    styles();
    const calls = Array.isArray(mgmt?.testCalls) ? mgmt.testCalls : [];
    const quotes = calls.filter(isQuote);
    const won = quotes.filter((c) => outcome(c) === 'Ganha');
    const lost = quotes.filter((c) => outcome(c) === 'Perdida');
    const open = quotes.filter((c) => outcome(c) === 'Em aberto');
    const dashboard = document.getElementById('dashboard');
    if (dashboard) {
      let card = document.getElementById('testModeDashboard');
      if (!card) {
        card = document.createElement('div'); card.id = 'testModeDashboard'; card.className = 'card section test-mode-card';
        const anchor = dashboard.querySelector('.owner-kpis') || dashboard.firstElementChild;
        if (anchor?.parentNode) anchor.parentNode.insertBefore(card, anchor); else dashboard.prepend(card);
      }
      card.innerHTML = `<div class="test-mode-head"><div><div class="eyebrow">AMBIENTE DE TESTE</div><h3>Testes do WhatsApp</h3><p>Estes dados servem só para validação. Não entram em faturamento, recebíveis ou pagamento real do motorista.</p></div><span class="test-mode-badge">TESTE · ${calls.length} registro(s)</span></div><div class="test-mode-metrics"><div class="test-mode-metric"><span>Cotações</span><b>${quotes.length}</b></div><div class="test-mode-metric"><span>Em aberto</span><b>${open.length}</b></div><div class="test-mode-metric"><span>Ganhas</span><b>${won.length}</b></div><div class="test-mode-metric"><span>Perdidas</span><b>${lost.length}</b></div></div><div class="test-mode-list">${calls.length ? [...calls].sort((a,b)=>new Date(b.updatedAt||0)-new Date(a.updatedAt||0)).slice(0,5).map(c=>`<div class="test-mode-row"><div><b>${esc(c.vehicle||'Cotação de teste')}</b><small>${esc(c.groupName||c.insurer||'Tests guincho')} · ${stamp(c.updatedAt||c.createdAt)}</small><div class="test-mode-route">${esc(c.origin||'Origem não informada')} → ${esc(c.destination||'Destino não informado')}</div></div><span class="test-mode-status">${esc(statusLabel[c.status]||c.status||'Teste')}</span></div>`).join('') : '<div class="empty">Nenhum teste registrado ainda.</div>'}</div>`;
    }
    const callsPage = document.getElementById('calls');
    if (callsPage) {
      let panel = document.getElementById('testModeCallsPanel');
      if (!panel) { panel = document.createElement('div'); panel.id = 'testModeCallsPanel'; panel.className = 'card section test-mode-card'; callsPage.prepend(panel); }
      panel.innerHTML = `<div class="test-mode-head"><div><div class="eyebrow">MODO DE TESTE</div><h3>Cotações e corridas do Tests guincho</h3><p>Visíveis para conferência, isoladas dos números oficiais.</p></div><span class="test-mode-badge">${calls.length} registro(s)</span></div><div class="test-mode-list">${calls.length ? [...calls].sort((a,b)=>new Date(b.updatedAt||0)-new Date(a.updatedAt||0)).map(c=>`<div class="test-mode-row"><div><b>${esc(c.vehicle||'Atendimento de teste')}</b><small>${esc(outcome(c))} · ${stamp(c.updatedAt||c.createdAt)}</small><div class="test-mode-route">${esc(c.origin||'Origem não informada')} → ${esc(c.destination||'Destino não informado')}</div>${c.lastOperationalText?`<small>“${esc(c.lastOperationalText).slice(0,150)}”</small>`:''}</div><span class="test-mode-status">${esc(statusLabel[c.status]||c.status||'Teste')}</span></div>`).join('') : '<div class="empty">Nenhum atendimento de teste registrado.</div>'}</div>`;
    }
  }
  const previousRenderManagement = renderManagement;
  renderManagement = function(){ previousRenderManagement(); renderTestMode(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', renderTestMode); else renderTestMode();
})();
'''
Path('test-mode-visibility.js').write_text(js)
Path('public/test-mode-visibility.js').write_text(js)

for name in ['index.html','public/index.html']:
    p = Path(name)
    html = p.read_text()
    old_script = '<script src="/app.js" defer></script><script src="/owner-dashboard.js" defer></script>'
    new_script = '<script src="/app.js" defer></script><script src="/owner-dashboard.js" defer></script><script src="/test-mode-visibility.js" defer></script>'
    if html.count(old_script) != 1:
        raise SystemExit(f'{name}: scripts esperados {html.count(old_script)}')
    p.write_text(html.replace(old_script,new_script,1))
