from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace(path, old, new):
    p = ROOT / path
    text = p.read_text(encoding='utf-8')
    if old not in text:
        raise SystemExit(f'Pattern not found in {path}: {old[:100]!r}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')


# 1) Management reads must accept either wrapped {data: ...} or direct worker state.
for path in ['app.js', 'public/app.js']:
    replace(
        path,
        "async function loadManagement(){try{const d=await api('/api/worker/management');mgmt=d.data||mgmt;renderManagement();renderOperationalHistory()}catch(e){console.error(e)}}",
        "async function loadManagement(){try{const d=await api('/api/worker/management');const next=d?.data&&typeof d.data==='object'?d.data:d;if(next&&Array.isArray(next.calls))mgmt={...mgmt,...next};renderManagement();renderOperationalHistory();return mgmt}catch(e){console.error(e);return mgmt}}",
    )

# 2) Driver payroll must fall back to management state and billing responses must be unwrapped.
for path in ['owner-dashboard.js', 'public/owner-dashboard.js']:
    replace(
        path,
        "  function currentPayroll() {\n    const payrolls = ownerState.billing.driverPayrolls || [];\n    return payrolls.find((p) => p.status !== 'paid') || payrolls[0] || null;\n  }",
        "  function currentPayroll() {\n    const billingPayrolls = Array.isArray(ownerState.billing?.driverPayrolls) ? ownerState.billing.driverPayrolls : [];\n    const payrolls = billingPayrolls.length ? billingPayrolls : (Array.isArray(mgmt.driverPayrolls) ? mgmt.driverPayrolls : []);\n    return payrolls.find((p) => p.status !== 'paid') || payrolls[0] || null;\n  }",
    )
    replace(
        path,
        "  async function refreshBillingOnly() {\n    try { ownerState.billing = await api('/api/worker/billing'); billingCache = ownerState.billing; } catch (error) { console.error('owner billing', error); }\n  }\n\n  async function refreshOwner() {\n    try { const [, , groups] = await Promise.all([loadManagement(), refreshBillingOnly(), api('/api/worker/groups').catch(()=>({groups:[]}))]); ownerState.groups = groups?.groups || []; renderOwnerViews(); } catch (error) { console.error('owner dashboard', error); }\n  }",
        "  async function refreshBillingOnly() {\n    try {\n      const response = await api('/api/worker/billing');\n      const next = response?.data && typeof response.data === 'object' ? response.data : response;\n      if (next && typeof next === 'object') ownerState.billing = next;\n      billingCache = ownerState.billing;\n      return ownerState.billing;\n    } catch (error) { console.error('owner billing', error); return ownerState.billing; }\n  }\n\n  async function refreshOwner() {\n    try {\n      const [, , groups] = await Promise.all([loadManagement(), refreshBillingOnly(), api('/api/worker/groups').catch(()=>({groups:[]}))]);\n      ownerState.groups = (groups?.data || groups)?.groups || [];\n      renderOwnerViews();\n      return { management: mgmt, billing: ownerState.billing };\n    } catch (error) { console.error('owner dashboard', error); return null; }\n  }\n\n  window.refreshBillingOnly = refreshBillingOnly;\n  window.refreshOwner = refreshOwner;",
    )

# 3) Closing from Operations immediately adopts the returned state and then refreshes every owner view.
for path in ['operation-command-center.js', 'public/operation-command-center.js']:
    replace(
        path,
        "      await loadManagement();\n      if (typeof refreshBillingOnly === 'function') await refreshBillingOnly();\n      renderManagement();",
        "      const closedState = response?.data && typeof response.data === 'object' ? response.data : response;\n      if (closedState && Array.isArray(closedState.calls)) mgmt = { ...mgmt, ...closedState };\n      if (typeof window.refreshOwner === 'function') await window.refreshOwner();\n      else {\n        await loadManagement();\n        if (typeof window.refreshBillingOnly === 'function') await window.refreshBillingOnly();\n        renderManagement();\n      }",
    )

# 4) Backend self-healing: whenever management is read, rebuild final finance + driver payroll
#    from owner-closed calls. This repairs any already-closed run whose derived records were stale.
worker = ROOT / 'tools/vercel-whatsapp-worker.mjs'
text = worker.read_text(encoding='utf-8')
old = """  const mainTruck = (state.fleet || []).find((item) => item?.id === 'fleet-gsw0h17' || String(item?.plate || '').toUpperCase() === 'GSW0H17');
  if (mainTruck && !String(mainTruck.driver || '').trim()) {
    mainTruck.driver = 'Mauro';
    dirty = true;
  }

  return dirty ? saveManagement(state) : state;
}"""
new = """  const mainTruck = (state.fleet || []).find((item) => item?.id === 'fleet-gsw0h17' || String(item?.plate || '').toUpperCase() === 'GSW0H17');
  if (mainTruck && !String(mainTruck.driver || '').trim()) {
    mainTruck.driver = 'Mauro';
    dirty = true;
  }

  // Derived-state reconciliation. A corrida fechada pelo dono é a fonte da verdade;
  // Financeiro, lotes e repasse do motorista são reconstruídos a partir dela.
  // Além de manter os módulos sincronizados, isso repara fechamentos antigos feitos
  // por uma versão do worker que não tenha persistido todos os derivados.
  const derivedBefore = JSON.stringify({
    finance: state.finance,
    billingBatches: state.billingBatches,
    driverPayrolls: state.driverPayrolls,
  });
  for (const call of state.calls) {
    if (!call || call.deletedAt || call.status === 'excluido') continue;
    const finalized = isOwnerFinalizedCall(call);
    const billableCancellation = call.status === 'cancelado' && call.cancellationChargeRequired === true;
    if (!finalized || !(isConfirmedCall(call) || billableCancellation)) continue;
    if (isTestCall(call)) ensureTestFinanceTracking(state, call, { finalized: true });
    else ensureConfirmedFinanceTracking(state, call, { finalized: true });
  }
  syncDriverPayrolls(state);
  const derivedAfter = JSON.stringify({
    finance: state.finance,
    billingBatches: state.billingBatches,
    driverPayrolls: state.driverPayrolls,
  });
  if (derivedBefore !== derivedAfter) dirty = true;

  return dirty ? saveManagement(state) : state;
}"""
if old not in text:
    raise SystemExit('Worker getManagement pattern not found')
worker.write_text(text.replace(old, new, 1), encoding='utf-8')

print('Operation/finance/driver synchronization patch applied.')
