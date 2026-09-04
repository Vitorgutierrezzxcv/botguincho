const SUPABASE_URL='https://pribndywguacekafhuyk.supabase.co';
const SUPABASE_ANON_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InByaWJuZHl3Z3VhY2VrYWZodXlrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY4OTY0OTQsImV4cCI6MjEwMjQ3MjQ5NH0.xHIYFkWzymWQl4iJYBOSGc5SVB0ce44Eh72m5c0C7bM';
const $=id=>document.getElementById(id);
const qs=new URLSearchParams(location.search);
const requestedCompany=(qs.get('companyId')||'').toLowerCase().replace(/[^a-z0-9-]/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'').slice(0,42);
let mode='login',method='email',recoveryToken='';

function show(id,msg,type='bad'){
  const el=$(id);if(!el)return;el.style.display='block';el.className=`notice ${type}`;el.textContent=msg;
}
function hide(id){const el=$(id);if(el)el.style.display='none'}
function friendly(error=''){
  const s=String(error||'').toLowerCase();
  if(s.includes('invalid login')||s.includes('invalid_credentials')||s.includes('login_failed'))return'Telefone/e-mail ou senha incorretos.';
  if(s.includes('email not confirmed'))return'Confirme seu e-mail antes de entrar.';
  if(s.includes('user already registered')||s.includes('already been registered'))return'Esta conta já existe. Use Entrar.';
  if(s.includes('password')&&s.includes('short'))return'A senha precisa ter pelo menos 8 caracteres.';
  if(s.includes('invalid_phone'))return'Informe um celular válido com DDD.';
  if(s.includes('phone_not_invited'))return'Telefone ou senha incorretos.';
  if(s.includes('rate limit')||s.includes('too many'))return'Muitas tentativas seguidas. Aguarde alguns minutos e tente novamente.';
  if(s.includes('network')||s.includes('fetch'))return'Não foi possível conectar agora. Tente novamente.';
  return error||'Não foi possível concluir a operação.';
}
function authHeaders(token=''){return{apikey:SUPABASE_ANON_KEY,'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})}}
async function supabase(path,opt={}){
  const r=await fetch(`${SUPABASE_URL}${path}`,{...opt,headers:{...authHeaders(opt.token||''),...(opt.headers||{})},cache:'no-store'});
  let d={};try{d=await r.json()}catch{}
  if(!r.ok)throw new Error(d?.msg||d?.message||d?.error_description||d?.error||d?.hint||`HTTP ${r.status}`);
  return d;
}
function storeSession(d){
  if(d?.access_token)localStorage.setItem('bg-access-token',d.access_token);
  if(d?.refresh_token)localStorage.setItem('bg-refresh-token',d.refresh_token);
  if(d?.expires_at)localStorage.setItem('bg-access-expires-at',String(d.expires_at));
}
function clearSession(){['bg-access-token','bg-refresh-token','bg-access-expires-at','bg-company-id'].forEach(k=>localStorage.removeItem(k))}
function normalizePhone(v=''){
  let digits=String(v).replace(/\D/g,'');
  if(digits.length===10||digits.length===11)digits='55'+digits;
  return digits?`+${digits}`:'';
}
function phoneInternalEmail(phone=''){
  const digits=normalizePhone(phone).replace(/\D/g,'');
  return digits?`${digits}@phone.acionador.local`:'';
}
function slugCompany(m){return m?.companies?.slug||''}
function openCompany(slug){if(!slug)return;localStorage.setItem('bg-company-id',slug);location.replace(`/?companyId=${encodeURIComponent(slug)}`)}
function renderChooser(memberships){
  $('authForm').classList.add('hidden');$('recoveryForm').classList.add('hidden');$('chooser').style.display='block';
  $('companyList').innerHTML=memberships.map(m=>`<button type="button" class="company-option" data-company="${slugCompany(m)}"><span><b>${m.companies?.name||'Empresa'}</b><small>${m.role==='owner'?'Proprietário':'Operador'} · ${slugCompany(m)}</small></span><span>→</span></button>`).join('');
  document.querySelectorAll('[data-company]').forEach(b=>b.onclick=()=>openCompany(b.dataset.company));
}
async function me(token){
  const r=await fetch('/api/control/me',{headers:{authorization:`Bearer ${token}`},cache:'no-store'});let d={};try{d=await r.json()}catch{};if(!r.ok)throw new Error(d.error||'Sessão inválida');return d;
}
async function routeAfterAuth(token){
  try{
    const d=await me(token);const memberships=(d.memberships||[]).filter(m=>m?.companies?.slug&&m?.companies?.status!=='suspended');
    if(requestedCompany){const match=memberships.find(m=>slugCompany(m)===requestedCompany);if(match||d.master)return openCompany(requestedCompany)}
    const last=localStorage.getItem('bg-company-id');if(last&&(d.master||memberships.some(m=>slugCompany(m)===last)))return openCompany(last);
    if(!memberships.length){if(d.master)return location.replace('/master.html');return location.replace('/onboarding.html?self=1')}
    if(memberships.length===1)return openCompany(slugCompany(memberships[0]));renderChooser(memberships);
  }catch(e){clearSession();show('notice',friendly(e.message),'bad')}
}
async function updateProfile(token,fullName,phone=''){
  if(!fullName&&!phone)return;
  await supabase('/rest/v1/rpc/update_my_profile',{method:'POST',token,body:JSON.stringify({p_full_name:fullName||null,p_phone:phone||null})}).catch(()=>{});
}
async function passwordGrant(email,password){
  return supabase('/auth/v1/token?grant_type=password',{method:'POST',body:JSON.stringify({email,password})});
}
async function createPhoneAccount(phone,password,fullName='',invitedOnly=false){
  const rpc=invitedOnly?'activate_invited_phone_password_user':'create_phone_password_user';
  return supabase(`/rest/v1/rpc/${rpc}`,{method:'POST',body:JSON.stringify({p_phone:phone,p_password:password,p_full_name:fullName||null})});
}
function setMode(next){
  mode=next;$('modeLogin').classList.toggle('active',mode==='login');$('modeSignup').classList.toggle('active',mode==='signup');$('nameField').classList.toggle('hidden',mode!=='signup');
  $('authTitle').textContent=mode==='signup'?'Crie sua conta':'Acesse sua conta';
  $('authSubtitle').textContent=mode==='signup'?'Depois você cadastra sua empresa e conecta o WhatsApp.':'Entre para acessar somente a sua empresa.';
  $('forgotPassword').style.visibility=mode==='login'&&method==='email'?'visible':'hidden';updateSubmit();hide('notice');
}
function setMethod(next){
  method=next;$('methodEmail').classList.toggle('active',method==='email');$('methodPhone').classList.toggle('active',method==='phone');
  $('emailFields').classList.toggle('hidden',method!=='email');$('phoneFields').classList.toggle('hidden',method!=='phone');
  $('forgotPassword').style.visibility=mode==='login'&&method==='email'?'visible':'hidden';updateSubmit();hide('notice');
}
function updateSubmit(){$('submitAuth').textContent=mode==='signup'?'Criar conta':'Entrar'}
async function emailSubmit(){
  const email=$('email').value.trim().toLowerCase(),password=$('password').value,fullName=$('fullName').value.trim();
  if(!email.includes('@'))throw new Error('Informe um e-mail válido.');if(password.length<8)throw new Error('A senha precisa ter pelo menos 8 caracteres.');if(mode==='signup'&&!fullName)throw new Error('Informe seu nome.');
  if(mode==='login'){const d=await passwordGrant(email,password);storeSession(d);return routeAfterAuth(d.access_token)}
  const d=await supabase('/auth/v1/signup',{method:'POST',body:JSON.stringify({email,password,data:{full_name:fullName},options:{email_redirect_to:`${location.origin}/login.html`}})});
  if(d.access_token){storeSession(d);await updateProfile(d.access_token,fullName);return routeAfterAuth(d.access_token)}
  setMode('login');show('notice','Conta criada. Confira seu e-mail para confirmar o cadastro e depois entre normalmente.','good');
}
async function phoneSubmit(){
  const phone=normalizePhone($('phone').value),password=$('phonePassword').value,fullName=$('fullName').value.trim(),internalEmail=phoneInternalEmail(phone);
  if(phone.replace(/\D/g,'').length<12)throw new Error('invalid_phone');if(password.length<8)throw new Error('password_too_short');if(mode==='signup'&&!fullName)throw new Error('Informe seu nome.');
  if(mode==='signup'){
    await createPhoneAccount(phone,password,fullName,false);const d=await passwordGrant(internalEmail,password);storeSession(d);await updateProfile(d.access_token,fullName,phone);return routeAfterAuth(d.access_token);
  }
  try{
    const d=await passwordGrant(internalEmail,password);storeSession(d);return routeAfterAuth(d.access_token);
  }catch(firstError){
    try{
      await createPhoneAccount(phone,password,'',true);const d=await passwordGrant(internalEmail,password);storeSession(d);return routeAfterAuth(d.access_token);
    }catch{throw firstError}
  }
}
async function submit(){
  hide('notice');const btn=$('submitAuth');btn.disabled=true;btn.textContent='Aguarde...';
  try{if(method==='email')await emailSubmit();else await phoneSubmit()}catch(e){show('notice',friendly(e.message),'bad')}finally{btn.disabled=false;updateSubmit()}
}
async function forgot(){
  const email=$('email').value.trim().toLowerCase();if(!email.includes('@'))return show('notice','Informe seu e-mail primeiro.','bad');
  try{await supabase('/auth/v1/recover',{method:'POST',body:JSON.stringify({email,redirect_to:`${location.origin}/login.html?recovery=1`})});show('notice','Enviamos um link de recuperação para seu e-mail.','good')}catch(e){show('notice',friendly(e.message),'bad')}
}
async function saveNewPassword(){
  const password=$('newPassword').value;if(password.length<8)return show('recoveryNotice','A senha precisa ter pelo menos 8 caracteres.','bad');
  try{await supabase('/auth/v1/user',{method:'PUT',token:recoveryToken,body:JSON.stringify({password})});localStorage.setItem('bg-access-token',recoveryToken);show('recoveryNotice','Senha atualizada. Entrando...','good');setTimeout(()=>routeAfterAuth(recoveryToken),500)}catch(e){show('recoveryNotice',friendly(e.message),'bad')}
}
function consumeHash(){
  const raw=location.hash.replace(/^#/,'');if(!raw)return false;const p=new URLSearchParams(raw),access=p.get('access_token'),refresh=p.get('refresh_token'),type=p.get('type');
  if(!access)return false;storeSession({access_token:access,refresh_token:refresh,expires_at:p.get('expires_at')});history.replaceState({},'',location.pathname+location.search);
  if(type==='recovery'||qs.get('recovery')==='1'){recoveryToken=access;$('authForm').classList.add('hidden');$('recoveryForm').classList.remove('hidden');return true}
  routeAfterAuth(access);return true;
}
$('modeLogin').onclick=()=>setMode('login');$('modeSignup').onclick=()=>setMode('signup');$('methodEmail').onclick=()=>setMethod('email');$('methodPhone').onclick=()=>setMethod('phone');$('submitAuth').onclick=submit;$('forgotPassword').onclick=forgot;$('saveNewPassword').onclick=saveNewPassword;$('logoutChooser').onclick=()=>{clearSession();location.reload()};
['email','password','phone','phonePassword','fullName'].forEach(id=>$(id)?.addEventListener('keydown',e=>{if(e.key==='Enter')submit()}));
if(!consumeHash()){const existing=localStorage.getItem('bg-access-token');if(existing)routeAfterAuth(existing)}
setMode('login');setMethod('email');