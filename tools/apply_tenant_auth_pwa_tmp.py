from pathlib import Path
for f in ['public/app.js','app.js']:
    p=Path(f)
    if not p.exists(): continue
    s=p.read_text()
    old="const $=id=>document.getElementById(id);const $$=q=>[...document.querySelectorAll(q)];const queryCompany=new URLSearchParams(location.search).get('companyId');if(queryCompany)localStorage.setItem('bg-company-id',queryCompany);const activeCompanyId=(queryCompany||localStorage.getItem('bg-company-id')||'cliente-teste').toLowerCase().replace(/[^a-z0-9-]/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'').slice(0,42)||'cliente-teste';"
    new=old+"const tenantAccessToken=localStorage.getItem('bg-access-token')||localStorage.getItem('bg-master-token')||'';if(activeCompanyId!=='cliente-teste'&&!tenantAccessToken){location.replace('/login.html?companyId='+encodeURIComponent(activeCompanyId));}"
    if old in s and 'tenantAccessToken=' not in s:
        s=s.replace(old,new,1)
    oldapi="async function api(url,opt={}){const u=new URL(url,location.origin);u.searchParams.set('companyId',activeCompanyId);const r=await fetch(u.pathname+u.search,{cache:'no-store',headers:{'content-type':'application/json','x-botguincho-company-id':activeCompanyId,...(opt.headers||{})},...opt});"
    newapi="async function api(url,opt={}){const u=new URL(url,location.origin);u.searchParams.set('companyId',activeCompanyId);const r=await fetch(u.pathname+u.search,{cache:'no-store',headers:{'content-type':'application/json','x-botguincho-company-id':activeCompanyId,...(tenantAccessToken?{authorization:`Bearer ${tenantAccessToken}`}:{}) ,...(opt.headers||{})},...opt});"
    if oldapi not in s:
        raise SystemExit(f'api needle missing in {f}')
    s=s.replace(oldapi,newapi,1)
    p.write_text(s)
print('tenant auth applied')
