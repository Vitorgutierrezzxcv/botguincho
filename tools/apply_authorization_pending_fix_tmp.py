from pathlib import Path

worker = Path('tools/vercel-whatsapp-worker.mjs')
s = worker.read_text()

old = "import { ensureInsurerForGroup, sanitizeInsurer, upsertInsurer, buildQuoteFunnel, quoteTrackingPatch, isOwnerFinalizedCall, releaseNextQueuedCall } from './business-orchestration.mjs';"
new = "import { ensureInsurerForGroup, sanitizeInsurer, upsertInsurer, buildQuoteFunnel, quoteTrackingPatch, isOwnerFinalizedCall, releaseNextQueuedCall, pendingAuthorizationCallForGroup } from './business-orchestration.mjs';"
if s.count(old) != 1:
    raise SystemExit(f'worker import: esperado 1, encontrado {s.count(old)}')
s = s.replace(old, new, 1)

old = """async function handleAuthorizationRuntime(msg, groupName, readableText, incomingLocation, context) {
  const call = context.recentCall;
  if (call && isFlowActiveCall(call)) {
"""
new = """async function handleAuthorizationRuntime(msg, groupName, readableText, incomingLocation, context) {
  // AUTORIZACAO_DA_COTACAO_PENDENTE: leituras do rastreador atualizam `updatedAt`
  // de corridas antigas. Isso nao pode fazer um novo \"pode seguir\" cair na corrida
  // antiga. Uma oportunidade ainda aguardando decisao sempre tem prioridade.
  const pendingCall = pendingAuthorizationCallForGroup(context.management?.calls || [], msg.from);
  const call = pendingCall || context.recentCall;
  if (call && isFlowActiveCall(call)) {
"""
if s.count(old) != 1:
    raise SystemExit(f'authorization handler: esperado 1, encontrado {s.count(old)}')
s = s.replace(old, new, 1)
worker.write_text(s)

business = Path('tools/business-orchestration.mjs')
b = business.read_text()
anchor = "const WON_STATUSES = new Set(['autorizado','a_caminho','em_atendimento','aguardando_fechamento','concluido']);\n"
helper = """const PENDING_AUTHORIZATION_STATUSES = new Set(['cotacao','aguardando_dados','aguardando_aprovacao','agendado']);

export function pendingAuthorizationCallForGroup(calls = [], groupId = '') {
  const id = String(groupId || '');
  return (Array.isArray(calls) ? calls : [])
    .filter((call) => call?.sourceGroupId === id && PENDING_AUTHORIZATION_STATUSES.has(String(call?.status || '')))
    .sort((a, b) => {
      // quoteRequestedAt/createdAt representam a oportunidade. updatedAt pode mudar
      // por telemetria e nao deve definir qual cotacao recebeu a autorizacao humana.
      const aTime = new Date(a?.quoteRequestedAt || a?.createdAt || a?.updatedAt || 0).getTime();
      const bTime = new Date(b?.quoteRequestedAt || b?.createdAt || b?.updatedAt || 0).getTime();
      return bTime - aTime;
    })[0] || null;
}
"""
if b.count(anchor) != 1:
    raise SystemExit(f'business anchor: esperado 1, encontrado {b.count(anchor)}')
b = b.replace(anchor, anchor + helper, 1)
business.write_text(b)

# Alinha a definicao de cotacao da interface com a regra canonica do backend.
for filename in ['owner-dashboard.js', 'public/owner-dashboard.js']:
    p = Path(filename)
    t = p.read_text()
    old = """  function isQuote(call) {
    return call.manualQuote === true
      || call.quoteOutcome === 'open' || call.quoteOutcome === 'won' || call.quoteOutcome === 'lost'
      || ['cotacao', 'aguardando_aprovacao'].includes(call.status)
      || timelineHas(call, 'consulta_registrada');
  }
"""
    new = """  function isQuote(call) {
    const quoteTimelineTypes = ['consulta_registrada','consulta_disponibilidade','cotacao','solicitacao_recebida','dados_incompletos','dados_do_atendimento','aguardando_autorizacao'];
    return call.manualQuote === true
      || call.quoteTracked === true
      || call.quoteOutcome === 'open' || call.quoteOutcome === 'won' || call.quoteOutcome === 'lost'
      || ['cotacao', 'aguardando_dados', 'aguardando_aprovacao', 'agendado'].includes(call.status)
      || quoteTimelineTypes.some((type) => timelineHas(call, type));
  }
"""
    if t.count(old) != 1:
        raise SystemExit(f'{filename} isQuote: esperado 1, encontrado {t.count(old)}')
    p.write_text(t.replace(old, new, 1))

# Ambiente de teste: continua isolado do financeiro oficial, mas mostra o fluxo financeiro simulado.
for filename in ['test-mode-visibility.js', 'public/test-mode-visibility.js']:
    p = Path(filename)
    t = p.read_text()
    old = """  const accepted = new Set(['autorizado','a_caminho','em_atendimento','aguardando_fechamento','concluido']);
  const isQuote = (c) => c?.quoteTracked === true || ['cotacao','aguardando_dados','aguardando_aprovacao'].includes(c?.status) || ['open','won','lost'].includes(c?.quoteOutcome);
  const outcome = (c) => c?.quoteOutcome === 'won' || accepted.has(c?.status) || c?.authorizedAt ? 'Ganha' : c?.quoteOutcome === 'lost' || (c?.status === 'cancelado' && !c?.authorizedAt) ? 'Perdida' : 'Em aberto';
  const stamp = (value) => { try { return new Date(value).toLocaleString('pt-BR'); } catch { return '—'; } };
"""
    new = """  const accepted = new Set(['autorizado','a_caminho','em_atendimento','aguardando_fechamento','concluido']);
  const quoteTimelineTypes = new Set(['consulta_registrada','consulta_disponibilidade','cotacao','solicitacao_recebida','dados_incompletos','dados_do_atendimento','aguardando_autorizacao']);
  const isQuote = (c) => c?.quoteTracked === true || ['cotacao','aguardando_dados','aguardando_aprovacao','agendado'].includes(c?.status) || ['open','won','lost'].includes(c?.quoteOutcome) || (Array.isArray(c?.operationalTimeline) && c.operationalTimeline.some((event) => quoteTimelineTypes.has(event?.type)));
  const outcome = (c) => c?.quoteOutcome === 'won' || accepted.has(c?.status) || c?.authorizedAt ? 'Ganha' : c?.quoteOutcome === 'lost' || (c?.status === 'cancelado' && !c?.authorizedAt) ? 'Perdida' : 'Em aberto';
  const stamp = (value) => { try { return new Date(value).toLocaleString('pt-BR'); } catch { return '—'; } };
  const num = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
  const isAccepted = (c) => accepted.has(c?.status) || Boolean(c?.authorizedAt) || (c?.status === 'cancelado' && c?.cancellationChargeRequired === true);
  const simulatedRevenueForCall = (c) => isAccepted(c) ? num(c?.value || c?.calculatedValue || c?.quoteCalculatedValue) : 0;
  const simulatedDriverForCall = (c) => {
    if (!isAccepted(c)) return 0;
    const km = Math.max(0, num(c?.serviceOutcome === 'deslocamento_sem_reboque'
      ? (c?.displacementBillableKm ?? c?.billableKm)
      : c?.cancellationChargeRequired
        ? (c?.cancellationBillableKm ?? c?.billableKm ?? c?.totalKm)
        : (c?.billableKm ?? c?.totalKm)));
    const route = 40 + Math.max(0, km - 50) * 0.70;
    const worked = c?.workedTimeChargeRequired ? num(c?.workedTimeAmount) : 0;
    return Math.round((route + worked) * 100) / 100;
  };
"""
    if t.count(old) != 1:
        raise SystemExit(f'{filename} header: esperado 1, encontrado {t.count(old)}')
    t = t.replace(old, new, 1)
    t = t.replace(".test-mode-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-top:14px}", ".test-mode-metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(125px,1fr));gap:10px;margin-top:14px}")
    old = """    const open = quotes.filter((c) => outcome(c) === 'Em aberto');
    const dashboard = document.getElementById('dashboard');
"""
    new = """    const open = quotes.filter((c) => outcome(c) === 'Em aberto');
    const acceptedCalls = calls.filter(isAccepted);
    const simulatedRevenue = acceptedCalls.reduce((sum, c) => sum + simulatedRevenueForCall(c), 0);
    const simulatedDriver = acceptedCalls.reduce((sum, c) => sum + simulatedDriverForCall(c), 0);
    const dashboard = document.getElementById('dashboard');
"""
    if t.count(old) != 1:
        raise SystemExit(f'{filename} metrics setup: esperado 1, encontrado {t.count(old)}')
    t = t.replace(old, new, 1)
    old = """<div class=\"test-mode-metrics\"><div class=\"test-mode-metric\"><span>Cotações</span><b>${quotes.length}</b></div><div class=\"test-mode-metric\"><span>Em aberto</span><b>${open.length}</b></div><div class=\"test-mode-metric\"><span>Ganhas</span><b>${won.length}</b></div><div class=\"test-mode-metric\"><span>Perdidas</span><b>${lost.length}</b></div></div>"""
    new = """<div class=\"test-mode-metrics\"><div class=\"test-mode-metric\"><span>Cotações</span><b>${quotes.length}</b></div><div class=\"test-mode-metric\"><span>Em aberto</span><b>${open.length}</b></div><div class=\"test-mode-metric\"><span>Ganhas</span><b>${won.length}</b></div><div class=\"test-mode-metric\"><span>Perdidas</span><b>${lost.length}</b></div><div class=\"test-mode-metric\"><span>Corridas aceitas</span><b>${acceptedCalls.length}</b></div><div class=\"test-mode-metric\"><span>Faturamento simulado</span><b>${money(simulatedRevenue)}</b></div><div class=\"test-mode-metric\"><span>Mauro simulado</span><b>${money(simulatedDriver)}</b></div></div>"""
    if t.count(old) != 1:
        raise SystemExit(f'{filename} dashboard metrics: esperado 1, encontrado {t.count(old)}')
    t = t.replace(old, new, 1)
    marker = """    const callsPage = document.getElementById('calls');
"""
    finance_block = """    const financePage = document.getElementById('finance');
    if (financePage) {
      let financeCard = document.getElementById('testModeFinancePanel');
      if (!financeCard) { financeCard = document.createElement('div'); financeCard.id = 'testModeFinancePanel'; financeCard.className = 'card section test-mode-card'; financePage.prepend(financeCard); }
      financeCard.innerHTML = `<div class=\"test-mode-head\"><div><div class=\"eyebrow\">FINANCEIRO DE TESTE</div><h3>Simulação das corridas do Tests guincho</h3><p>Calculado com as mesmas regras da operação, mas isolado do financeiro oficial.</p></div><span class=\"test-mode-badge\">NÃO É COBRANÇA REAL</span></div><div class=\"test-mode-metrics\"><div class=\"test-mode-metric\"><span>Corridas aceitas</span><b>${acceptedCalls.length}</b></div><div class=\"test-mode-metric\"><span>Faturamento simulado</span><b>${money(simulatedRevenue)}</b></div><div class=\"test-mode-metric\"><span>Pagamento Mauro</span><b>${money(simulatedDriver)}</b></div></div>`;
    }
"""
    if t.count(marker) != 1:
        raise SystemExit(f'{filename} finance marker: esperado 1, encontrado {t.count(marker)}')
    t = t.replace(marker, finance_block + marker, 1)
    p.write_text(t)

Path('tools/test-authorization-pending-selection.mjs').write_text(r'''import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pendingAuthorizationCallForGroup } from './business-orchestration.mjs';

const groupId = 'tests@g.us';
const oldActive = {
  id: 'old-active', sourceGroupId: groupId, status: 'autorizado',
  createdAt: '2026-08-27T18:00:00.000Z', updatedAt: '2026-08-28T21:12:13.000Z',
};
const pending = {
  id: 'pending-new', sourceGroupId: groupId, status: 'aguardando_aprovacao',
  quoteRequestedAt: '2026-08-28T21:10:41.000Z', createdAt: '2026-08-28T21:10:41.000Z', updatedAt: '2026-08-28T21:10:43.000Z',
};
assert.equal(pendingAuthorizationCallForGroup([oldActive, pending], groupId)?.id, 'pending-new');

const newerPending = {
  id: 'pending-newer', sourceGroupId: groupId, status: 'cotacao',
  quoteRequestedAt: '2026-08-28T21:11:00.000Z', createdAt: '2026-08-28T21:11:00.000Z', updatedAt: '2026-08-28T21:11:00.000Z',
};
assert.equal(pendingAuthorizationCallForGroup([pending, newerPending], groupId)?.id, 'pending-newer');
assert.equal(pendingAuthorizationCallForGroup([oldActive], groupId), null);
assert.equal(pendingAuthorizationCallForGroup([pending], 'other@g.us'), null);

const worker = fs.readFileSync(new URL('./vercel-whatsapp-worker.mjs', import.meta.url), 'utf8');
assert.match(worker, /pendingAuthorizationCallForGroup\(context\.management\?\.calls \|\| \[\], msg\.from\)/);
assert.match(worker, /const call = pendingCall \|\| context\.recentCall/);
console.log('AUTHORIZATION_PENDING_SELECTION_OK');
''')
