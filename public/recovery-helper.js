(()=>{
  const SUPABASE_URL='https://pribndywguacekafhuyk.supabase.co';
  const SUPABASE_ANON_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYXNlIiwicmVmIjoicHJpYm5keXdndWFjZWthZmh1eWsiLCJyb2xlIjoiYW5vbiIsImlhdCI6MTc4Njg5NjQ5NCwiZXhwIjoyMTAyNDcyNDk0fQ.xHIYFkWzymWQl4iJYBOSGc5SVB0ce44Eh72m5c0C7bM';
  const btn=document.getElementById('forgotPassword');
  const emailInput=document.getElementById('email');
  const notice=document.getElementById('notice');
  if(!btn||!emailInput||!notice)return;

  let timer=null;
  const show=(msg,type='bad')=>{
    notice.style.display='block';
    notice.className=`notice ${type}`;
    notice.textContent=msg;
  };
  const secondsFrom=(msg='')=>{
    const m=String(msg).match(/after\s+(\d+)\s+seconds?/i)||String(msg).match(/(\d+)\s+seconds?/i);
    return m?Math.max(1,Number(m[1])):60;
  };
  const cooldown=(seconds,email)=>{
    clearInterval(timer);
    let left=seconds;
    btn.disabled=true;
    const paint=()=>{
      btn.textContent=left>0?`Reenviando em ${left}s...`:'Enviando...';
      show(left>0?`Aguarde ${left} segundos. O link será enviado automaticamente.`:'Enviando o link de recuperação...','good');
    };
    paint();
    timer=setInterval(async()=>{
      left-=1;paint();
      if(left<=0){
        clearInterval(timer);
        await request(email,true);
      }
    },1000);
  };
  async function request(email,automatic=false){
    if(!email.includes('@')){
      btn.disabled=false;btn.textContent='Esqueci minha senha';
      return show('Informe seu e-mail primeiro.','bad');
    }
    btn.disabled=true;
    btn.textContent=automatic?'Enviando...':'Aguarde...';
    try{
      const r=await fetch(`${SUPABASE_URL}/auth/v1/recover`,{
        method:'POST',
        headers:{apikey:SUPABASE_ANON_KEY,'content-type':'application/json'},
        body:JSON.stringify({email,redirect_to:`${location.origin}/login.html?recovery=1`}),
        cache:'no-store'
      });
      let d={};try{d=await r.json()}catch{}
      if(!r.ok){
        const msg=d?.msg||d?.message||d?.error_description||d?.error||`HTTP ${r.status}`;
        if(/only request this after|rate limit|too many/i.test(msg)){
          return cooldown(secondsFrom(msg)+1,email);
        }
        throw new Error(msg);
      }
      btn.textContent='Link enviado';
      show('Link enviado para o e-mail. Abra a mensagem e defina a senha uma única vez. Depois o acesso será só e-mail/telefone + senha.','good');
      setTimeout(()=>{btn.disabled=false;btn.textContent='Esqueci minha senha'},15000);
    }catch(e){
      btn.disabled=false;btn.textContent='Esqueci minha senha';
      show(e?.message||'Não foi possível enviar o link agora.','bad');
    }
  }
  btn.onclick=()=>request(emailInput.value.trim().toLowerCase());
})();