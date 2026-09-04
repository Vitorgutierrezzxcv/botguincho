(()=>{
  const FALLBACK='/icon.svg';const DEFAULT_NAME='Acionador.ai';let current=null;
  const one=(sel,root=document)=>root.querySelector(sel);const all=(sel,root=document)=>Array.from(root.querySelectorAll(sel));
  function upsertMeta(name,content){let el=one(`meta[name="${name}"]`);if(!el){el=document.createElement('meta');el.name=name;document.head.appendChild(el)}el.content=content}
  function upsertLink(rel,href,id=''){let el=id?document.getElementById(id):null;if(!el)el=one(`link[rel="${rel}"]`);if(!el){el=document.createElement('link');el.rel=rel;document.head.appendChild(el)}if(id)el.id=id;el.href=href;return el}
  function logoContainers(){return all('.brand-mark,.auth-brand-icon,.master-brand-icon').filter(el=>el instanceof HTMLElement)}
  function applyLogo(b){const src=b.has_logo?b.logo_url:'';logoContainers().forEach(container=>{if(container.tagName==='IMG'){container.src=src||b.app_icon_192_url||b.app_icon_url||FALLBACK;return}if(src){let img=one('img',container);if(!img){img=document.createElement('img');container.replaceChildren(img)}img.src=src;img.alt=b.platform_name}else{let img=one('img',container);if(!img){img=document.createElement('img');container.replaceChildren(img)}img.src=b.app_icon_192_url||b.app_icon_url||FALLBACK;img.alt=b.platform_name}})}
  function applyText(b){const name=b.platform_name||DEFAULT_NAME;document.title=name;upsertMeta('application-name',name);upsertMeta('apple-mobile-web-app-title',name);upsertMeta('theme-color',b.primary_color||'#0877F9');upsertMeta('mobile-web-app-capable','yes');upsertMeta('apple-mobile-web-app-capable','yes');document.documentElement.style.setProperty('--brand',b.primary_color||'#0877F9');document.documentElement.style.setProperty('--primary',b.primary_color||'#0877F9');all('.brand strong').forEach(el=>el.textContent=name);all('.auth-brand-icon,.master-brand-icon').forEach(el=>el.alt=name);all('.eyebrow').filter(el=>/ACIONADOR\.AI|BOT GUINCHO/i.test(el.textContent||'')).forEach(el=>{el.textContent=(el.textContent||'').replace(/ACIONADOR\.AI|BOT GUINCHO/ig,name.toUpperCase())})}
  function applyLinks(b){const icon192=b.app_icon_192_url||b.app_icon_url||FALLBACK;const apple=b.apple_icon_url||icon192;const favicon=b.favicon_url||icon192;const fav=upsertLink('icon',favicon,'platformFavicon');if(!favicon.endsWith('.svg'))fav.type='image/png';const appleLink=upsertLink('apple-touch-icon',apple,'platformAppleTouchIcon');appleLink.setAttribute('sizes','180x180');const manifest=upsertLink('manifest',b.manifest_url||'/manifest.webmanifest','platformManifest');manifest.removeAttribute('crossorigin')}
  function isStandalone(){return window.matchMedia?.('(display-mode: standalone)')?.matches===true||window.navigator.standalone===true}
  function isIOS(){return /iphone|ipad|ipod/i.test(navigator.userAgent||'')}
  function showInstallHelp(message){const text=String(message||'');if(typeof window.openModal==='function'){try{window.openModal('Instalar Acionador.ai',`<div class="notice good">${text.replace(/\n/g,'<br>')}</div>`,()=>{});return}catch{}}alert(text)}
  async function handleInstallClick(){
    if(isStandalone()){showInstallHelp('O Acionador.ai já está instalado neste aparelho.');return}
    try{
      if(typeof deferredPrompt!=='undefined'&&deferredPrompt){
        deferredPrompt.prompt();const choice=await deferredPrompt.userChoice;deferredPrompt=null;
        if(choice?.outcome!=='accepted')showInstallHelp('A instalação foi cancelada. Você pode tentar novamente pelo menu do navegador.');
        return;
      }
    }catch{}
    if(isIOS()){
      showInstallHelp('No iPhone/iPad a instalação não abre por um botão do site.\n\n1. Abra o Acionador.ai no Safari.\n2. Toque em Compartilhar (quadrado com seta para cima).\n3. Toque em “Adicionar à Tela de Início”.\n4. Confirme “Acionador.ai” e toque em Adicionar.');
      return;
    }
    showInstallHelp('No Android/Chrome, abra o menu ⋮ do navegador e toque em “Instalar app” ou “Adicionar à tela inicial”. Se essa opção não aparecer, atualize a página e tente novamente.');
  }
  function bindInstallUX(){const button=document.getElementById('installBtn');if(!button)return;button.onclick=handleInstallClick;if(isStandalone()){button.textContent='Aplicativo instalado';button.disabled=true}else if(isIOS()){button.textContent='Como instalar no iPhone'}else{button.textContent='Instalar aplicativo'}}
  async function load(){try{const response=await fetch('/api/worker/branding',{cache:'no-store'});if(!response.ok)return null;return await response.json()}catch{return null}}
  async function refresh(){const b=await load();if(!b)return current;current=b;applyText(b);applyLogo(b);applyLinks(b);bindInstallUX();window.dispatchEvent(new CustomEvent('platform-branding',{detail:b}));return b}

  function markTestCalls(){
    document.querySelectorAll('.op-card').forEach(card=>{
      const testBadge=[...card.querySelectorAll('.op-badge')].find(el=>(el.textContent||'').trim()==='TESTE');
      if(!testBadge||card.querySelector('.test-finance-warning'))return;
      const note=document.createElement('div');
      note.className='test-finance-warning';
      note.style.cssText='margin-top:10px;padding:9px 11px;border-radius:10px;background:#f5f3ff;border:1px solid #ddd6fe;color:#6d28d9;font-size:12px;font-weight:700';
      note.textContent='TESTE — não altera Financeiro, Dashboard nem pagamento real do motorista.';
      const route=card.querySelector('.op-route');
      (route||card).insertAdjacentElement(route?'beforebegin':'beforeend',note);
    });
  }

  async function syncOperationalViews(){
    if(document.hidden)return;
    try{
      if(typeof window.refreshOwner==='function')await window.refreshOwner();
      else if(typeof window.loadManagement==='function')await window.loadManagement();
      if(typeof window.refreshBillingOnly==='function')await window.refreshBillingOnly();
      markTestCalls();
      const status=document.getElementById('topStatus');
      const dot=document.getElementById('topDot');
      if(status&&status.textContent==='Erro de conexão'){
        try{
          const companyId=localStorage.getItem('bg-company-id')||'cliente-teste';
          const token=localStorage.getItem('bg-access-token')||localStorage.getItem('bg-master-token')||'';
          const response=await fetch(`/api/worker/health?companyId=${encodeURIComponent(companyId)}`,{cache:'no-store',headers:{'x-botguincho-company-id':companyId,...(token?{authorization:`Bearer ${token}`}:{})}});
          if(response.ok){status.textContent='Operação online';if(dot)dot.className='dot ok'}
        }catch{}
      }
    }catch{}
  }

  window.refreshPlatformBranding=refresh;window.getPlatformBranding=()=>current;
  window.addEventListener('appinstalled',()=>{const b=document.getElementById('installBtn');if(b){b.textContent='Aplicativo instalado';b.disabled=true}});
  window.addEventListener('focus',()=>{void syncOperationalViews()});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)void syncOperationalViews()});
  setInterval(()=>{void syncOperationalViews()},10000);
  const observer=new MutationObserver(markTestCalls);observer.observe(document.documentElement,{subtree:true,childList:true});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{refresh();setTimeout(()=>void syncOperationalViews(),1200)},{once:true});else{refresh();setTimeout(()=>void syncOperationalViews(),1200)}
})();