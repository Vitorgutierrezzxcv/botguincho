from pathlib import Path
p=Path('tools/vercel-whatsapp-worker.mjs')
text=p.read_text()
old="""    const state = await getManagement();\n    const parsed = facts || extractOperationalFacts(text);\n    const routeOrigin = originAddress || parsed.origin || '';\n    const routeDestination = destinationAddress || parsed.destination || '';\n    let routeSnapshot = null;\n    if (status === 'autorizado' && routeOrigin && routeDestination) {\n      routeSnapshot = await computeFullServiceRoute({ originAddress: routeOrigin, destinationAddress: routeDestination }).catch((error) => {"""
new="""    const state = await getManagement();\n    const parsed = facts || extractOperationalFacts(text);\n    const billingProfile = ensureBillingProfile(state, groupId, groupName);\n    const routeOrigin = originAddress || parsed.origin || '';\n    const routeDestination = destinationAddress || parsed.destination || '';\n    let routeSnapshot = null;\n    if (status === 'autorizado' && routeOrigin && routeDestination) {\n      routeSnapshot = await computeFullServiceRoute({ originAddress: routeOrigin, destinationAddress: routeDestination, baseAddressOverride: billingProfile?.baseAddress || '' }).catch((error) => {"""
if old not in text: raise SystemExit('ROUTE_PROFILE_PATTERN_NOT_FOUND')
text=text.replace(old,new,1)
old2="""    let value = Number(existing?.value || 0);\n    if (status === 'concluido' && commercial?.status === 'ok' && Number(commercial.calculatedAmount) > 0) value = Number(commercial.calculatedAmount);"""
new2="""    const autoBillableKm = billingProfile?.routeBasis === 'origin_destination'\n      ? (routeSnapshot?.serviceLeg?.km ?? existing?.routeBreakdown?.serviceLeg?.km ?? estimatedTotalKm ?? null)\n      : billingProfile?.routeBasis === 'insurer_reported'\n        ? (parsed.totalKm ?? existing?.totalKm ?? null)\n        : billingProfile?.routeBasis === 'manual'\n          ? null\n          : (routeSnapshot?.totalKm ?? existing?.billableKm ?? estimatedTotalKm ?? null);\n\n    let value = Number(existing?.value || 0);\n    if (status === 'concluido' && commercial?.status === 'ok' && Number(commercial.calculatedAmount) > 0) value = Number(commercial.calculatedAmount);"""
if old2 not in text: raise SystemExit('BILLABLE_CALC_PATTERN_NOT_FOUND')
text=text.replace(old2,new2,1)
old3="""      billableKm: routeSnapshot?.totalKm ?? existing?.billableKm ?? estimatedTotalKm ?? null,"""
new3="""      billableKm: autoBillableKm,"""
if old3 not in text: raise SystemExit('BILLABLE_FIELD_PATTERN_NOT_FOUND')
text=text.replace(old3,new3,1)
old4="""async function currentOperationalContext(groupId, groupName, text) {\n  const management = await getManagement();\n  const recentCall = recentManagementCall(management, groupId);\n  const knowledge = await getGroupKnowledgeEntry(groupId);\n  const approvedRules = knowledge?.commercialStatus === 'approved' ? knowledge.approvedCommercialRules : null;\n  const facts = extractOperationalFacts(text);\n  const intent = classifyRuntimeIntent(text, groupName, recentCall);\n  return { management, recentCall, knowledge, approvedRules, facts, intent, profile: resolveGroupProfile(groupName) };\n}"""
new4="""async function currentOperationalContext(groupId, groupName, text) {\n  const management = await getManagement();\n  const recentCall = recentManagementCall(management, groupId);\n  const knowledge = await getGroupKnowledgeEntry(groupId);\n  const approvedRules = knowledge?.commercialStatus === 'approved' ? knowledge.approvedCommercialRules : null;\n  const billingProfile = ensureBillingProfile(management, groupId, groupName);\n  const facts = extractOperationalFacts(text);\n  const intent = classifyRuntimeIntent(text, groupName, recentCall);\n  return { management, recentCall, knowledge, approvedRules, billingProfile, facts, intent, profile: resolveGroupProfile(groupName) };\n}"""
if old4 not in text: raise SystemExit('CONTEXT_BILLING_PATTERN_NOT_FOUND')
text=text.replace(old4,new4,1)
old5="""  const commercial = reconcileCommercial({ approvedRules: context.approvedRules, facts: context.facts, estimatedTotalKm: route.estimatedTotalKm });"""
new5="""  const pricingKm = context.billingProfile?.routeBasis === 'origin_destination'\n    ? (route.secondLeg?.distanceKm ?? null)\n    : context.billingProfile?.routeBasis === 'insurer_reported'\n      ? (context.facts.totalKm ?? null)\n      : context.billingProfile?.routeBasis === 'manual'\n        ? null\n        : route.estimatedTotalKm;\n  const commercial = reconcileCommercial({ approvedRules: context.approvedRules, facts: { ...context.facts, totalKm: pricingKm ?? context.facts.totalKm }, estimatedTotalKm: pricingKm });"""
if old5 not in text: raise SystemExit('QUOTE_COMMERCIAL_PATTERN_NOT_FOUND')
text=text.replace(old5,new5,1)
p.write_text(text)
print('ROUTE_BASIS_FIXED')
