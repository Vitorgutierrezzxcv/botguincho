from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORKER = ROOT / 'tools/vercel-whatsapp-worker.mjs'
TEST_CENTER = ROOT / 'tools/test-center.mjs'
BUSINESS = ROOT / 'tools/business-orchestration.mjs'
OP = ROOT / 'public/operation-command-center.js'
OWNER = ROOT / 'public/owner-dashboard.js'
ROOT_OP = ROOT / 'operation-command-center.js'
ROOT_OWNER = ROOT / 'owner-dashboard.js'


def replace_once(path, old, new, label):
    s = path.read_text(encoding='utf-8')
    if old not in s:
        raise SystemExit(f'{label}: trecho não encontrado em {path}')
    path.write_text(s.replace(old, new, 1), encoding='utf-8')

# 1) Um grupo chamado "Tests guincho" não é mais automaticamente financeiro de teste.
# Apenas execuções iniciadas pela Central de Testes, que recebem testMode=true, ficam isoladas.
replace_once(
    TEST_CENTER,
    "export function isTestCall(call = {}) {\n  return call?.testMode === true || isTestGroupName(call?.insurer || call?.client || call?.groupName || '');\n}\n",
    "export function isTestCall(call = {}) {\n  return call?.testMode === true;\n}\n",
    'isTestCall'
)

# 2) O worker só marca como teste quando a Central de Testes está de fato executando um run.
s = WORKER.read_text(encoding='utf-8')
old = "testMode: existing?.testMode === true || isTestGroupName(groupName) || (testCenterRuntime.currentRun?.status === 'running' && testCenterRuntime.targetGroupId === groupId),"
new = "testMode: Boolean(existing?.testRunId || (testCenterRuntime.currentRun?.status === 'running' && testCenterRuntime.targetGroupId === groupId)),"
if old not in s:
    raise SystemExit('worker testMode assignment não encontrado')
s = s.replace(old, new)

# Migra corridas antigas criadas manualmente no grupo Tests guincho: se não têm testRunId,
# deixam de ser teste e passam a alimentar Dashboard/Financeiro/Motorista.
anchor = "  let dirty = false;\n"
migration = "  let dirty = false;\n  for (const call of state.calls || []) {\n    if (call?.testMode === true && !call?.testRunId && isTestGroupName(call?.groupName || call?.insurer || call?.client || '')) {\n      call.testMode = false;\n      dirty = true;\n    }\n  }\n"
if migration not in s:
    if anchor not in s:
        raise SystemExit('migration anchor não encontrado')
    s = s.replace(anchor, migration, 1)
WORKER.write_text(s, encoding='utf-8')

# 3) "pode seguir" não fica preso a quatro status apenas. Se a cotação válida do grupo
# estiver em um status intermediário, há um fallback para a última oportunidade completa.
old_pending = """export function pendingAuthorizationCallForGroup(calls = [], groupId = '') {\n  const id = String(groupId || '');\n  return (Array.isArray(calls) ? calls : [])\n    .filter((call) => call?.sourceGroupId === id && PENDING_AUTHORIZATION_STATUSES.has(String(call?.status || '')))\n    .sort((a, b) => {\n      // quoteRequestedAt/createdAt representam a oportunidade. updatedAt pode mudar\n      // por telemetria e nao deve definir qual cotacao recebeu a autorizacao humana.\n      const aTime = new Date(a?.quoteRequestedAt || a?.createdAt || a?.updatedAt || 0).getTime();\n      const bTime = new Date(b?.quoteRequestedAt || b?.createdAt || b?.updatedAt || 0).getTime();\n      return bTime - aTime;\n    })[0] || null;\n}\n"""
new_pending = """export function pendingAuthorizationCallForGroup(calls = [], groupId = '') {\n  const id = String(groupId || '');\n  const all = (Array.isArray(calls) ? calls : []).filter((call) => call?.sourceGroupId === id && !call?.deletedAt && call?.status !== 'excluido');\n  const byTime = (a, b) => {\n    const aTime = new Date(a?.quoteRequestedAt || a?.createdAt || a?.updatedAt || 0).getTime();\n    const bTime = new Date(b?.quoteRequestedAt || b?.createdAt || b?.updatedAt || 0).getTime();\n    return bTime - aTime;\n  };\n  const primary = all.filter((call) => PENDING_AUTHORIZATION_STATUSES.has(String(call?.status || ''))).sort(byTime)[0];\n  if (primary) return primary;\n  // Fallback de segurança: uma ficha/cotação completa do mesmo grupo não pode ser perdida\n  // só porque uma atualização intermediária deixou o status fora da lista principal.\n  return all.filter((call) =>\n    !call?.authorizedAt\n    && !['autorizado','a_caminho','em_atendimento','aguardando_fechamento','concluido','cancelado'].includes(String(call?.status || ''))\n    && Boolean(call?.origin) && Boolean(call?.destination)\n    && Boolean(call?.vehicle || call?.vehicleType || call?.plate)\n    && (call?.quoteTracked === true || Boolean(call?.quoteRequestedAt) || Number(call?.quoteCalculatedValue || call?.calculatedValue || 0) > 0)\n  ).sort(byTime)[0] || null;\n}\n"""
replace_once(BUSINESS, old_pending, new_pending, 'pendingAuthorizationCallForGroup')

# 4) UI: o nome do grupo não gera selo TESTE. Apenas chamadas realmente do Test Center.
for path in [OP, ROOT_OP]:
    if not path.exists():
        continue
    s = path.read_text(encoding='utf-8')
    s = s.replace("const isTestCall = (call) => call?.testMode === true || String(call?.groupName || '').toLowerCase().includes('tests guincho');", "const isTestCall = (call) => call?.testMode === true;")
    path.write_text(s, encoding='utf-8')

for path in [OWNER, ROOT_OWNER]:
    if not path.exists():
        continue
    s = path.read_text(encoding='utf-8')
    s = s.replace("const testClosure = call?.testMode === true || /^tests?\\s+guincho$/i.test(String(call.insurer || call.client || call.groupName || '').trim());", "const testClosure = call?.testMode === true;")
    path.write_text(s, encoding='utf-8')

print('Tests guincho manual agora é fluxo real; Test Center automático continua isolado; autorização recebeu fallback robusto.')
