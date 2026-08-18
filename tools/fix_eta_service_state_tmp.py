from pathlib import Path
p=Path('tools/vercel-whatsapp-worker.mjs')
s=p.read_text()
repls={
"if (explicitState && explicitState !== SERVICE_STATE) {":"if (explicitState && explicitState !== configuredServiceState) {",
"state: explicitState || SERVICE_STATE,":"state: explicitState || configuredServiceState,",
"...(!explicitState && !priorityCity ? RMBH_PRIORITY_CITIES : []),":"...(!explicitState && !priorityCity ? configuredPriorityCities : []),",
}
for old,new in repls.items():
    if old not in s:
        raise SystemExit(f'missing expected fragment: {old}')
    s=s.replace(old,new)
# ensure no obsolete runtime identifiers remain outside declarations/names
if '!== SERVICE_STATE' in s or '|| SERVICE_STATE' in s or 'RMBH_PRIORITY_CITIES' in s:
    raise SystemExit('obsolete service-area runtime reference remains')
p.write_text(s)
print('ETA tenant service-area references fixed')
