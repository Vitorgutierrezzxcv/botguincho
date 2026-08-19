from pathlib import Path
p=Path('tools/vercel-whatsapp-worker.mjs')
text=p.read_text()
old="async function recordDispatchInManagement({ groupId, groupName, text, originAddress, destinationAddress, eta, status = 'autorizado', facts = null, commercial = null, estimatedTotalKm = null, evidenceChecklist = null }) {"
new="async function recordDispatchInManagement({ groupId, groupName, text, originAddress, destinationAddress, originCoordinates = null, eta, status = 'autorizado', facts = null, commercial = null, estimatedTotalKm = null, evidenceChecklist = null }) {"
if old not in text: raise SystemExit('SIGNATURE_NOT_FOUND')
text=text.replace(old,new,1)
old="""    if (status === 'autorizado' && routeOrigin && routeDestination) {
      routeSnapshot = await computeFullServiceRoute({ originAddress: routeOrigin, destinationAddress: routeDestination, baseAddressOverride: billingProfile?.baseAddress || '' }).catch((error) => {"""
new="""    if (status === 'autorizado' && (routeOrigin || originCoordinates) && routeDestination) {
      routeSnapshot = await computeFullServiceRoute({ originAddress: routeOrigin || null, originCoordinates, destinationAddress: routeDestination, baseAddressOverride: billingProfile?.baseAddress || '' }).catch((error) => {"""
if old not in text: raise SystemExit('SNAPSHOT_NOT_FOUND')
text=text.replace(old,new,1)
old="""      origin: originAddress || parsed.origin || existing?.origin || '',
      destination: destinationAddress || parsed.destination || existing?.destination || '',"""
new="""      origin: originAddress || parsed.origin || existing?.origin || '',
      originCoordinates: originCoordinates || existing?.originCoordinates || null,
      destination: destinationAddress || parsed.destination || existing?.destination || '',"""
if old not in text: raise SystemExit('ORIGIN_FIELD_NOT_FOUND')
text=text.replace(old,new,1)
# Handle dispatch
old="""    originAddress: state.originAddress,
    destinationAddress: state.destinationAddress,
    eta,"""
new="""    originAddress: state.originAddress,
    originCoordinates: state.originCoordinates,
    destinationAddress: state.destinationAddress,
    eta,"""
if old not in text: raise SystemExit('DISPATCH_CALL_NOT_FOUND')
text=text.replace(old,new,1)
# Availability/quote: both use route object; replace first two occurrences safely.
old="""      originAddress: route.originAddress, destinationAddress: route.destinationAddress,
      eta: route.eta,"""
new="""      originAddress: route.originAddress, originCoordinates: route.originCoordinates, destinationAddress: route.destinationAddress,
      eta: route.eta,"""
count=text.count(old)
if count < 1: raise SystemExit('ROUTE_RECORD_NOT_FOUND')
text=text.replace(old,new)
# Authorization carries stored coordinates.
old="""    originAddress: call?.origin || null, destinationAddress: call?.destination || null,
    eta, status: 'autorizado', facts: context.facts,"""
new="""    originAddress: call?.origin || null, originCoordinates: call?.originCoordinates || null, destinationAddress: call?.destination || null,
    eta, status: 'autorizado', facts: context.facts,"""
if old not in text: raise SystemExit('AUTH_RECORD_NOT_FOUND')
text=text.replace(old,new,1)
p.write_text(text)
print('ROUTE_ORIGIN_COORDINATES_FIXED')
