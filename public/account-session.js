(()=>{
  const company=(new URLSearchParams(location.search).get('companyId')||localStorage.getItem('bg-company-id')||'').toLowerCase().replace(/[^a-z0-9-]/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'').slice(0,42);
  let token=localStorage.getItem('bg-access-token')||localStorage.getItem('bg-master-token')||'';
  const refresh=localStorage.getItem('bg-refresh-token')||'';
  const guard=document.getElementById('accountAuthGuard');
  const unlock=()=>{if(guard)guard.remove()};
  const clear=()=>['bg-access-token','bg-refresh-token','bg-access-expires-at','bg-company-id'].forEach(k=>localStorage.removeItem(k));
  const login=()=>{clear();location.replace(`/login.html${company?`?companyId=${encodeURIComponent(company)}`:''}`)};
  async function refreshToken(){
    if(!refresh)return'';
    try{
      const r=await fetch('https://pribndywguacekafhuyk.supabase.co/auth/v1/token?grant_type=refresh_token',{method:'POST',headers:{apikey:'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InByaWJuZHl3Z3VhY2VrYWZodXlrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY4OTY0OTQsImV4cCI6MjEwMjQ3MjQ5NH0.xHIYFkWzymWQl4iJYBOSGc5SVB0ce44Eh72m5c0C7bM','content-type':'application/json'},body:JSON.stringify({refresh_token:refresh}),cache:'no-store'});
      const d=await r.json();if(!r.ok||!d.access_token)return'';token=d.access_token;localStorage.setItem('bg-access-token',d.access_token);if(d.refresh_token)localStorage.setItem('bg-refresh-token',d.refresh_token);return token;
    }catch{return''}
  }
  async function readMe(){
    if(!token)return null;
    let r=await fetch('/api/control/me',{headers:{authorization:`Bearer ${token}`},cache:'no-store'});
    if(r.status===401&&(await refreshToken()))r=await fetch('/api/control/me',{headers:{authorization:`Bearer ${token}`},cache:'no-store'});
    if(!r.ok)return null;return r.json();
  }
  function inject(me,membership){
    const sidebar=document.querySelector('.sidebar');if(!sidebar)return;
    const old=document.getElementById('accountBox');if(old)old.remove();
    const box=document.createElement('div');box.id='accountBox';box.style.cssText='margin-top:auto;padding:14px 12px;border-top:1px solid #e5eaf1;font-size:12px;color:#69758a';
    const display=me.user?.name||me.user?.email?.split('@')[0]||'Usuário';
    const role=me.master?'Master':membership?.role==='owner'?'Proprietário':'Operador';
    const companyName=membership?.companies?.name||'Acionador.ai';
    box.innerHTML=`<div style="display:flex;align-items:center;gap:9px"><div style="width:34px;height:34px;border-radius:10px;background:#eef5ff;color:#0877F9;display:grid;place-items:center;font-weight:800">${display.slice(0,1).toUpperCase()}</div><div style="min-width:0;flex:1"><b style="display:block;color:#263249;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${display}</b><span>${role} · ${companyName}</span></div></div><div id="accountCompanies" style="margin-top:9px"></div><button id="accountLogout" type="button" style="width:100%;margin-top:8px;border:1px solid #e1e7ef;background:white;border-radius:9px;padding:8px;color:#536177;font:inherit;font-weight:700;cursor:pointer">Sair</button>`;
    sidebar.appendChild(box);
    const memberships=(me.memberships||[]).filter(m=>m?.companies?.slug);
    if(memberships.length>1){
      const select=document.createElement('select');select.style.cssText='width:100%;border:1px solid #e1e7ef;border-radius:9px;padding:8px;background:white;color:#38465c;font:inherit';
      memberships.forEach(m=>{const o=document.createElement('option');o.value=m.companies.slug;o.textContent=m.companies.name||m.companies.slug;o.selected=m.companies.slug===company;select.appendChild(o)});
      select.onchange=()=>{localStorage.setItem('bg-company-id',select.value);location.href=`/?companyId=${encodeURIComponent(select.value)}`};document.getElementById('accountCompanies').appendChild(select);
    }
    document.getElementById('accountLogout').onclick=login;
  }
  async function boot(){
    if(!token)return login();
    const me=await readMe();if(!me)return login();
    const membership=(me.memberships||[]).find(m=>m?.companies?.slug===company);
    if(!me.master&&!membership){
      if(!(me.memberships||[]).length)return location.replace('/onboarding.html?self=1');
      const first=me.memberships.find(m=>m?.companies?.slug)?.companies?.slug;if(first){localStorage.setItem('bg-company-id',first);return location.replace(`/?companyId=${encodeURIComponent(first)}`)}
      return login();
    }
    if(membership?.companies?.status==='suspended')return login();
    if(company)localStorage.setItem('bg-company-id',company);
    unlock();
    const ready=()=>{inject(me,membership);if(new URLSearchParams(location.search).get('first')==='1'){setTimeout(()=>{const b=document.querySelector('[data-page="whatsapp"]');if(b)b.click()},500)}};
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ready,{once:true});else ready();
  }
  boot().catch(login);
})();
