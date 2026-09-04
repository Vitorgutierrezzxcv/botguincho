(()=>{
  const company=(new URLSearchParams(location.search).get('companyId')||localStorage.getItem('bg-company-id')||'').toLowerCase().replace(/[^a-z0-9-]/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'').slice(0,42);
  let token=localStorage.getItem('bg-access-token')||localStorage.getItem('bg-master-token')||'';
  const refresh=localStorage.getItem('bg-refresh-token')||'';
  const guard=document.getElementById('accountAuthGuard');
  const unlock=()=>{if(guard)guard.remove()};
  const clear=()=>['bg-access-token','bg-refresh-token','bg-access-expires-at','bg-company-id'].forEach(k=>localStorage.removeItem(k));
  const login=()=>{clear();location.replace(`/login.html${company?`?companyId=${encodeURIComponent(company)}`:''}`)};
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
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
  async function companyAccess(companyId){
    const r=await fetch(`/api/control/companies?action=access&companyId=${encodeURIComponent(companyId)}`,{headers:{authorization:`Bearer ${token}`},cache:'no-store'});
    const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Não foi possível carregar os usuários.');return d.users||[];
  }
  async function inviteUser(companyId,email,role){
    const r=await fetch('/api/control/companies',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({action:'invite_user',companyId,email,role})});
    const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Não foi possível convidar o usuário.');return d;
  }
  function userModal(companyId,companyName){
    let overlay=document.getElementById('companyUsersOverlay');if(overlay)overlay.remove();
    overlay=document.createElement('div');overlay.id='companyUsersOverlay';overlay.style.cssText='position:fixed;inset:0;z-index:10000;background:rgba(15,23,42,.45);display:grid;place-items:center;padding:18px;font-family:inherit';
    overlay.innerHTML=`<section style="width:min(620px,100%);max-height:88dvh;overflow:auto;background:white;border-radius:20px;padding:22px;box-shadow:0 24px 80px rgba(0,0,0,.2)"><div style="display:flex;justify-content:space-between;gap:12px;align-items:start"><div><h2 style="margin:0;font-size:22px">Usuários da empresa</h2><p style="margin:5px 0 0;color:#778399;font-size:13px">${esc(companyName)} · cada pessoa entra com a própria conta.</p></div><button id="usersClose" style="border:0;background:#f1f4f8;border-radius:9px;width:34px;height:34px;font-size:20px;cursor:pointer">×</button></div><div style="display:grid;grid-template-columns:1fr 145px auto;gap:8px;margin-top:18px"><input id="inviteEmail" type="email" placeholder="email@empresa.com" style="min-width:0;border:1px solid #dfe5ee;border-radius:10px;padding:11px;font:inherit"><select id="inviteRole" style="border:1px solid #dfe5ee;border-radius:10px;padding:11px;background:white;font:inherit"><option value="operator">Operador</option><option value="owner">Proprietário</option></select><button id="inviteSend" style="border:0;border-radius:10px;background:#0877F9;color:#fff;padding:0 15px;font:inherit;font-weight:750;cursor:pointer">Convidar</button></div><div id="usersNotice" style="display:none;margin-top:10px;padding:10px;border-radius:10px;font-size:12px"></div><div id="usersList" style="display:grid;gap:8px;margin-top:16px"><div style="color:#8994a6;font-size:13px">Carregando...</div></div><p style="font-size:11px;line-height:1.45;color:#8b95a5;margin:16px 0 0">O convite fica associado ao e-mail. Quando essa pessoa criar a conta ou entrar com esse mesmo e-mail, o acesso à empresa é reconhecido automaticamente.</p></section>`;
    document.body.appendChild(overlay);overlay.onclick=e=>{if(e.target===overlay)overlay.remove()};document.getElementById('usersClose').onclick=()=>overlay.remove();
    const notice=(msg,ok=false)=>{const el=document.getElementById('usersNotice');el.style.display='block';el.textContent=msg;el.style.background=ok?'#ecf9f1':'#fff1f1';el.style.color=ok?'#17633b':'#8b2d2d'};
    const load=async()=>{try{const rows=await companyAccess(companyId);const list=document.getElementById('usersList');list.innerHTML=rows.length?rows.map(x=>`<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;border:1px solid #e6eaf0;border-radius:11px;padding:11px 12px"><div style="min-width:0"><b style="display:block;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(x.email||'Usuário')}</b><small style="color:#8490a2">${x.kind==='invite'?'Convite pendente':'Conta ativa'}</small></div><span style="font-size:11px;font-weight:750;background:#f1f5fa;border-radius:999px;padding:6px 9px">${x.role==='owner'?'Proprietário':'Operador'}</span></div>`).join(''):'<div style="color:#8994a6;font-size:13px">Nenhum usuário encontrado.</div>'}catch(e){notice(e.message)}};
    document.getElementById('inviteSend').onclick=async()=>{const btn=document.getElementById('inviteSend'),email=document.getElementById('inviteEmail').value.trim(),role=document.getElementById('inviteRole').value;if(!email.includes('@'))return notice('Informe um e-mail válido.');btn.disabled=true;btn.textContent='Enviando...';try{await inviteUser(companyId,email,role);document.getElementById('inviteEmail').value='';notice('Acesso criado. O usuário deve entrar ou criar a conta usando esse e-mail.',true);await load()}catch(e){notice(e.message)}finally{btn.disabled=false;btn.textContent='Convidar'}};load();
  }
  function inject(me,membership){
    const sidebar=document.querySelector('.sidebar');if(!sidebar)return;
    const old=document.getElementById('accountBox');if(old)old.remove();
    const box=document.createElement('div');box.id='accountBox';box.style.cssText='margin-top:auto;padding:14px 12px;border-top:1px solid #e5eaf1;font-size:12px;color:#69758a';
    const display=me.user?.name||me.user?.email?.split('@')[0]||'Usuário';
    const role=me.master?'Master':membership?.role==='owner'?'Proprietário':'Operador';
    const companyName=membership?.companies?.name||'Acionador.ai';
    const canManage=membership?.role==='owner'&&membership?.companies?.id;
    box.innerHTML=`<div style="display:flex;align-items:center;gap:9px"><div style="width:34px;height:34px;border-radius:10px;background:#eef5ff;color:#0877F9;display:grid;place-items:center;font-weight:800">${esc(display.slice(0,1).toUpperCase())}</div><div style="min-width:0;flex:1"><b style="display:block;color:#263249;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(display)}</b><span>${esc(role)} · ${esc(companyName)}</span></div></div><div id="accountCompanies" style="margin-top:9px"></div>${canManage?'<button id="accountUsers" type="button" style="width:100%;margin-top:8px;border:1px solid #dce6f4;background:#f8fbff;border-radius:9px;padding:8px;color:#2460a5;font:inherit;font-weight:700;cursor:pointer">Usuários e acessos</button>':''}<button id="accountLogout" type="button" style="width:100%;margin-top:8px;border:1px solid #e1e7ef;background:white;border-radius:9px;padding:8px;color:#536177;font:inherit;font-weight:700;cursor:pointer">Sair</button>`;
    sidebar.appendChild(box);
    const memberships=(me.memberships||[]).filter(m=>m?.companies?.slug);
    if(memberships.length>1){
      const select=document.createElement('select');select.style.cssText='width:100%;border:1px solid #e1e7ef;border-radius:9px;padding:8px;background:white;color:#38465c;font:inherit';
      memberships.forEach(m=>{const o=document.createElement('option');o.value=m.companies.slug;o.textContent=m.companies.name||m.companies.slug;o.selected=m.companies.slug===company;select.appendChild(o)});
      select.onchange=()=>{localStorage.setItem('bg-company-id',select.value);location.href=`/?companyId=${encodeURIComponent(select.value)}`};document.getElementById('accountCompanies').appendChild(select);
    }
    if(canManage)document.getElementById('accountUsers').onclick=()=>userModal(membership.companies.id,companyName);
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
