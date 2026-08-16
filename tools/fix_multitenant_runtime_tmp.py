from pathlib import Path
p=Path('lib/sandbox-runtime.js'); s=p.read_text()
s=s.replace('Boolean(latestCredential)', 'Boolean(tenantCredential(id))')
s=s.replace('await startWorkerDetached(sandbox, id);\n      return req.method === \'GET\'', 'await startWorkerDetached(sandbox, tenant);\n      return req.method === \'GET\'')
s=s.replace('res.status(200).json(placeholder(internalPath))', 'res.status(200).json({ ...placeholder(internalPath, tenant), companyId: tenant })')
s=s.replace('await syncCredential(sandbox, tenantCredential(tenant), tenant);', 'await syncCredential(sandbox, tenantCredential(id), id);')
if 'latestCredential' in s: raise SystemExit('stale latestCredential remains')
# sanity: proxy must not use undefined id
proxy=s.split('export async function proxyWorker',1)[1].split('export async function sandboxDiagnostics',1)[0]
if 'startWorkerDetached(sandbox, id)' in proxy: raise SystemExit('undefined id remains in proxy')
p.write_text(s)

# Status endpoint: legacy quick recovery only for current customer; tenant-aware status for every tenant.
p=Path('api/worker/status.js'); s=p.read_text()
s=s.replace("import { getWorkerStatus, requestCredential } from '../../lib/sandbox-runtime.js';", "import { getWorkerStatus, requestCredential, requestTenant } from '../../lib/sandbox-runtime.js';")
s=s.replace("  const credential = requestCredential(req);\n\n  try {\n    await quickRecover(credential);\n  } catch (error) {\n    console.error('Recuperação rápida do worker falhou:', error);\n  }\n\n  const status = await getWorkerStatus(credential);", "  const tenant = requestTenant(req);\n  const credential = requestCredential(req, tenant);\n\n  if (tenant === 'cliente-teste') {\n    try {\n      await quickRecover(credential);\n    } catch (error) {\n      console.error('Recuperação rápida do worker legado falhou:', error);\n    }\n  }\n\n  const status = await getWorkerStatus(credential, tenant);")
p.write_text(s)

p=Path('api/worker/maintain.js'); s=p.read_text()
s=s.replace("import { maintainWorker, requestCredential } from '../../lib/sandbox-runtime.js';", "import { maintainWorker, requestCredential, requestTenant } from '../../lib/sandbox-runtime.js';")
s=s.replace("    const result = await maintainWorker(requestCredential(req));", "    const tenant = requestTenant(req);\n    const result = await maintainWorker(requestCredential(req, tenant), tenant);")
p.write_text(s)
print('multitenant runtime fixed')