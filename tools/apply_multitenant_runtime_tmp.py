from pathlib import Path
p=Path('lib/sandbox-runtime.js')
s=p.read_text()
# constants
s=s.replace("const SANDBOX_NAME = 'botguincho-wa-vercel-v12';", "const LEGACY_SANDBOX_NAME = 'botguincho-wa-vercel-v12';\nconst DEFAULT_CLIENT_ID = 'cliente-teste';")
s=s.replace("const CLIENT_ID = 'cliente-teste';\n", "")
s=s.replace("let inflight = null;\nlet latestCredential = '';", "const inflightByTenant = new Map();\nconst credentialByTenant = new Map();")
# tenant helpers before rememberCredential
needle="function rememberCredential(value) {"
helper="""function sanitizeTenant(value = '') {\n  const normalized = String(value || DEFAULT_CLIENT_ID).toLowerCase().trim().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 42);\n  return normalized || DEFAULT_CLIENT_ID;\n}\n\nfunction tenantSandboxName(tenant) {\n  const id = sanitizeTenant(tenant);\n  return id === DEFAULT_CLIENT_ID ? LEGACY_SANDBOX_NAME : `botguincho-wa-${id}`;\n}\n\nexport function requestTenant(req) {\n  return sanitizeTenant(\n    req?.headers?.['x-botguincho-company-id'] ||\n    req?.query?.companyId ||\n    req?.query?.company_id ||\n    DEFAULT_CLIENT_ID\n  );\n}\n\nfunction tenantCredential(tenant) {\n  return credentialByTenant.get(sanitizeTenant(tenant)) || '';\n}\n\n"""
if helper not in s: s=s.replace(needle, helper+needle)
# credential funcs
s=s.replace("function rememberCredential(value) {\n  const token = Array.isArray(value) ? value[0] : value;\n  if (typeof token === 'string' && token.trim()) latestCredential = token.trim();\n  return latestCredential;\n}", "function rememberCredential(value, tenant = DEFAULT_CLIENT_ID) {\n  const id = sanitizeTenant(tenant);\n  const token = Array.isArray(value) ? value[0] : value;\n  if (typeof token === 'string' && token.trim()) credentialByTenant.set(id, token.trim());\n  return credentialByTenant.get(id) || '';\n}")
s=s.replace("export function requestCredential(req) {\n  return rememberCredential(\n    req?.headers?.['x-vercel-oidc-token'] ||\n    process.env.VERCEL_OIDC_TOKEN ||\n    process.env.AI_GATEWAY_API_KEY ||\n    ''\n  );\n}", "export function requestCredential(req, tenant = requestTenant(req)) {\n  return rememberCredential(\n    req?.headers?.['x-vercel-oidc-token'] ||\n    process.env.VERCEL_OIDC_TOKEN ||\n    process.env.AI_GATEWAY_API_KEY ||\n    '',\n    tenant\n  );\n}")
# worker env
s=s.replace("function workerEnv(credential = '') {", "function workerEnv(tenant = DEFAULT_CLIENT_ID, credential = '') {")
s=s.replace("WHATSAPP_CLIENT_ID: CLIENT_ID,", "WHATSAPP_CLIENT_ID: sanitizeTenant(tenant),")
# start worker signature and env
s=s.replace("async function startWorkerDetached(sandbox) {", "async function startWorkerDetached(sandbox, tenant = DEFAULT_CLIENT_ID) {")
s=s.replace("env: workerEnv(latestCredential),", "env: workerEnv(tenant, tenantCredential(tenant)),")
# oncreate/onresume converted to tenant closures
old="""async function onCreate(sandbox) {\n  await installDependencies(sandbox);\n  await applyWwebjsPatch(sandbox);\n  await configureSessionWindow(sandbox);\n  await startWorkerDetached(sandbox);\n}\n\nasync function onResume(sandbox) {\n  await applyWwebjsPatch(sandbox);\n  await configureSessionWindow(sandbox);\n  await startWorkerDetached(sandbox);\n}\n\nasync function getSandbox() {\n  if (!inflight) {\n    inflight = Sandbox.getOrCreate({\n      name: SANDBOX_NAME,"""
new="""async function onCreate(sandbox, tenant) {\n  await installDependencies(sandbox);\n  await applyWwebjsPatch(sandbox);\n  await configureSessionWindow(sandbox);\n  await startWorkerDetached(sandbox, tenant);\n}\n\nasync function onResume(sandbox, tenant) {\n  await applyWwebjsPatch(sandbox);\n  await configureSessionWindow(sandbox);\n  await startWorkerDetached(sandbox, tenant);\n}\n\nasync function getSandbox(tenant = DEFAULT_CLIENT_ID) {\n  const id = sanitizeTenant(tenant);\n  if (!inflightByTenant.has(id)) {\n    const pending = Sandbox.getOrCreate({\n      name: tenantSandboxName(id),"""
if old not in s: raise SystemExit('getSandbox anchor not found')
s=s.replace(old,new)
s=s.replace("      onCreate,\n      onResume,\n    }).finally(() => {\n      inflight = null;\n    });\n  }\n  return inflight;\n}", "      onCreate: (sandbox) => onCreate(sandbox, id),\n      onResume: (sandbox) => onResume(sandbox, id),\n    }).finally(() => {\n      inflightByTenant.delete(id);\n    });\n    inflightByTenant.set(id, pending);\n  }\n  return inflightByTenant.get(id);\n}")
# sync credential and status
s=s.replace("async function syncCredential(sandbox, credential = '') {\n  const token = rememberCredential(credential);", "async function syncCredential(sandbox, credential = '', tenant = DEFAULT_CLIENT_ID) {\n  const token = rememberCredential(credential, tenant);")
s=s.replace("async function readWorkerStatus(sandbox) {", "async function readWorkerStatus(sandbox, tenant = DEFAULT_CLIENT_ID) {")
s=s.replace("await syncCredential(sandbox, latestCredential);", "await syncCredential(sandbox, tenantCredential(tenant), tenant);")
# maintain/get status signatures and usages
s=s.replace("export async function maintainWorker(credential = '') {\n  rememberCredential(credential);\n  let sandbox = await getSandbox();", "export async function maintainWorker(credential = '', tenant = DEFAULT_CLIENT_ID) {\n  const id = sanitizeTenant(tenant);\n  rememberCredential(credential, id);\n  let sandbox = await getSandbox(id);")
s=s.replace("    inflight = null;\n    await new Promise((resolve) => setTimeout(resolve, 1200));\n    sandbox = await getSandbox();", "    inflightByTenant.delete(id);\n    await new Promise((resolve) => setTimeout(resolve, 1200));\n    sandbox = await getSandbox(id);")
s=s.replace("await startWorkerDetached(sandbox);", "await startWorkerDetached(sandbox, id);")
s=s.replace("const status = await readWorkerStatus(sandbox);", "const status = await readWorkerStatus(sandbox, id);")
s=s.replace("sandbox: SANDBOX_NAME,", "sandbox: tenantSandboxName(id),\n    companyId: id,")
s=s.replace("export async function getWorkerStatus(credential = '') {\n  rememberCredential(credential);\n  try {\n    const sandbox = await getSandbox();", "export async function getWorkerStatus(credential = '', tenant = DEFAULT_CLIENT_ID) {\n  const id = sanitizeTenant(tenant);\n  rememberCredential(credential, id);\n  try {\n    const sandbox = await getSandbox(id);")
s=s.replace("status = await readWorkerStatus(sandbox);", "status = await readWorkerStatus(sandbox, id);")
s=s.replace("clientId: CLIENT_ID,", "clientId: id,")
# remaining sandbox names in status/diagnostics context
s=s.replace("sandbox: SANDBOX_NAME", "sandbox: tenantSandboxName(id)")
# placeholder credential needs tenant
s=s.replace("function placeholder(path) {", "function placeholder(path, tenant = DEFAULT_CLIENT_ID) {")
s=s.replace("apiKeyConfigured: Boolean(latestCredential)", "apiKeyConfigured: Boolean(tenantCredential(tenant))")
# proxy
s=s.replace("  const credential = requestCredential(req);\n\n  try {\n    const sandbox = await getSandbox();", "  const tenant = requestTenant(req);\n  const credential = requestCredential(req, tenant);\n  res.setHeader('x-botguincho-company-id', tenant);\n\n  try {\n    const sandbox = await getSandbox(tenant);")
s=s.replace("await startWorkerDetached(sandbox);\n      return req.method === 'GET'\n        ? res.status(200).json(placeholder(internalPath))", "await startWorkerDetached(sandbox, tenant);\n      return req.method === 'GET'\n        ? res.status(200).json({ ...placeholder(internalPath, tenant), companyId: tenant })")
s=s.replace("await syncCredential(sandbox, credential);", "await syncCredential(sandbox, credential, tenant);")
s=s.replace("return res.status(200).json({ ...placeholder(internalPath), warning: String(error) });", "return res.status(200).json({ ...placeholder(internalPath, tenant), companyId: tenant, warning: String(error) });")
# diagnostics
s=s.replace("export async function sandboxDiagnostics(credential = '') {\n  rememberCredential(credential);\n  try {\n    const sandbox = await getSandbox();", "export async function sandboxDiagnostics(credential = '', tenant = DEFAULT_CLIENT_ID) {\n  const id = sanitizeTenant(tenant);\n  rememberCredential(credential, id);\n  try {\n    const sandbox = await getSandbox(id);")
s=s.replace("else await syncCredential(sandbox, latestCredential);", "else await syncCredential(sandbox, tenantCredential(id), id);")
s=s.replace("aiGatewayConfigured: Boolean(latestCredential)", "aiGatewayConfigured: Boolean(tenantCredential(id))")
# catch fallback diagnostics may lack id replacement already
p.write_text(s)
print('multitenant runtime patch applied')