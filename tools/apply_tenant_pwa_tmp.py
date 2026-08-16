from pathlib import Path
for name in ['app.js','public/app.js']:
    p=Path(name); s=p.read_text()
    old="const $=id=>document.getElementById(id);const $$=q=>[...document.querySelectorAll(q)];"
    new="const $=id=>document.getElementById(id);const $$=q=>[...document.querySelectorAll(q)];const queryCompany=new URLSearchParams(location.search).get('companyId');if(queryCompany)localStorage.setItem('bg-company-id',queryCompany);const activeCompanyId=(queryCompany||localStorage.getItem('bg-company-id')||'cliente-teste').toLowerCase().replace(/[^a-z0-9-]/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'').slice(0,42)||'cliente-teste';"
    if old not in s: raise SystemExit(f'bootstrap anchor missing {name}')
    s=s.replace(old,new,1)
    oldapi="async function api(url,opt={}){const r=await fetch(url,{cache:'no-store',headers:{'content-type':'application/json',...(opt.headers||{})},...opt});"
    newapi="async function api(url,opt={}){const u=new URL(url,location.origin);u.searchParams.set('companyId',activeCompanyId);const r=await fetch(u.pathname+u.search,{cache:'no-store',headers:{'content-type':'application/json','x-botguincho-company-id':activeCompanyId,...(opt.headers||{})},...opt});"
    if oldapi not in s: raise SystemExit(f'api anchor missing {name}')
    s=s.replace(oldapi,newapi,1)
    p.write_text(s)
for name in ['sw.js','public/sw.js']:
    p=Path(name); s=p.read_text().replace('bot-guincho-pwa-v4','bot-guincho-pwa-v5').replace('bot-guincho-pwa-v3','bot-guincho-pwa-v5').replace('bot-guincho-pwa-v2','bot-guincho-pwa-v5').replace('bot-guincho-pwa-v1','bot-guincho-pwa-v5'); p.write_text(s)
print('tenant pwa applied')