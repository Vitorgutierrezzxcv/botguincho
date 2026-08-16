from pathlib import Path
p=Path('lib/sandbox-runtime.js')
s=p.read_text()
if "authorizeTenantRequest" not in s.splitlines()[1:5]:
    s=s.replace("import { Sandbox } from '@vercel/sandbox';", "import { Sandbox } from '@vercel/sandbox';\nimport { authorizeTenantRequest } from './control-plane.js';")
needle="""export async function proxyWorker(req, res, internalPath) {
  res.setHeader('cache-control', 'no-store');
  const tenant = requestTenant(req);
  const credential = requestCredential(req, tenant);
  res.setHeader('x-botguincho-company-id', tenant);

  try {"""
repl="""export async function proxyWorker(req, res, internalPath) {
  res.setHeader('cache-control', 'no-store');
  const tenant = requestTenant(req);
  const credential = requestCredential(req, tenant);
  res.setHeader('x-botguincho-company-id', tenant);

  try {
    await authorizeTenantRequest(req, tenant);"""
if needle not in s:
    raise SystemExit('proxy needle not found')
s=s.replace(needle,repl)
p.write_text(s)
print('tenant access protection applied')
