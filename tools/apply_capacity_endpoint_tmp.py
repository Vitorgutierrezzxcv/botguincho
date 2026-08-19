from pathlib import Path

p = Path('tools/vercel-whatsapp-worker.mjs')
s = p.read_text()

if "app.get('/api/capacity'" not in s:
    marker = "app.get('/api/health', async (_req, res) => {"
    pos = s.find(marker)
    if pos < 0:
        raise SystemExit('health marker not found')
    block = r'''app.get('/api/capacity', async (_req, res) => {
  try {
    const state = await getManagement();
    const capacity = capacitySnapshot(state);
    return res.json({
      ok: true,
      feature: 'dual-dispatch-v1',
      maxConcurrentCalls: MAX_CONCURRENT_CALLS,
      activeCount: capacity.activeCount,
      slotsAvailable: capacity.slotsAvailable,
      canAccept: capacity.canAccept,
      activeCalls: capacity.activeCalls.map((call) => ({
        id: call.id,
        groupId: call.sourceGroupId || null,
        insurer: call.insurer || call.client || null,
        status: call.status,
        origin: call.origin || null,
        destination: call.destination || null,
        authorizedAt: call.authorizedAt || null,
      })),
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

'''
    s = s[:pos] + block + s[pos:]

old = """  const reading = await getTrackerReading();\n  const pairCode = await getPairCode();\n\n  res.json({\n    clientId,\n"""
new = """  const reading = await getTrackerReading();\n  const pairCode = await getPairCode();\n  const capacity = capacitySnapshot(await getManagement());\n\n  res.json({\n    clientId,\n"""
if "const capacity = capacitySnapshot(await getManagement());" not in s:
    if old not in s:
        raise SystemExit('status prelude marker not found')
    s = s.replace(old, new, 1)

old_tail = """    serviceArea: { state: configuredServiceState, priorityCities: configuredPriorityCities },\n    operatingHours: evaluateOperatingHours(settings),\n  });\n});\n"""
new_tail = """    serviceArea: { state: configuredServiceState, priorityCities: configuredPriorityCities },\n    operatingHours: evaluateOperatingHours(settings),\n    capacity: { feature: 'dual-dispatch-v1', maxConcurrentCalls: MAX_CONCURRENT_CALLS, activeCount: capacity.activeCount, slotsAvailable: capacity.slotsAvailable, canAccept: capacity.canAccept },\n  });\n});\n"""
if "capacity: { feature: 'dual-dispatch-v1'" not in s:
    if old_tail not in s:
        raise SystemExit('status tail marker not found')
    s = s.replace(old_tail, new_tail, 1)

p.write_text(s)
print('CAPACITY_ENDPOINT_PATCHED')
