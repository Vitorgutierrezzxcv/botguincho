from pathlib import Path
p=Path('lib/sandbox-runtime.js')
s=p.read_text()
s=s.replace("await syncCredential(sandbox, tenantCredential(id), id);", "await syncCredential(sandbox, tenantCredential(tenant), tenant);")
s=s.replace("await startWorkerDetached(sandbox, id);\n      return req.method === 'GET'", "await startWorkerDetached(sandbox, tenant);\n      return req.method === 'GET'")
# ensure no stale latestCredential reference remains
s=s.replace("Boolean(latestCredential)", "Boolean(tenantCredential(id))")
p.write_text(s)
print('runtime v2 fixed')
