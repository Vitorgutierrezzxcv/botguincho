const CACHE='acionador-pwa-v27';
const ASSETS=['/','/index.html','/app.css','/app.js','/owner-dashboard.css','/owner-dashboard.js','/quote-actions-v1.js','/test-mode-visibility.js','/operation-command-center.js','/tratto-ui.css','/branding.js'];
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).catch(()=>{}))});
self.addEventListener('activate',e=>{e.waitUntil(Promise.all([self.clients.claim(),caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))]))});

async function composeOwnerDashboard(request){
  try{
    const [baseResponse,actionsResponse]=await Promise.all([
      fetch(request,{cache:'no-store'}),
      fetch('/quote-actions-v1.js',{cache:'no-store'})
    ]);
    if(!baseResponse.ok)throw new Error('owner dashboard unavailable');
    const base=await baseResponse.text();
    const actions=actionsResponse.ok?await actionsResponse.text():'';
    return new Response(`${base}\n;\n${actions}`,{status:200,headers:{'content-type':'application/javascript; charset=utf-8','cache-control':'no-store, max-age=0, must-revalidate'}});
  }catch(error){
    const [baseCached,actionsCached]=await Promise.all([caches.match('/owner-dashboard.js'),caches.match('/quote-actions-v1.js')]);
    if(baseCached){
      const base=await baseCached.text();
      const actions=actionsCached?await actionsCached.text():'';
      return new Response(`${base}\n;\n${actions}`,{headers:{'content-type':'application/javascript; charset=utf-8','cache-control':'no-store'}});
    }
    return Response.error();
  }
}

self.addEventListener('fetch',e=>{
  const r=e.request;const u=new URL(r.url);
  if(r.method!=='GET'||u.pathname.startsWith('/api/')||u.pathname==='/manifest.webmanifest'||u.pathname==='/apple-touch-icon.png'||u.pathname==='/favicon.png'||u.pathname.startsWith('/icons/'))return;
  if(u.pathname==='/owner-dashboard.js'){e.respondWith(composeOwnerDashboard(r));return;}
  e.respondWith(fetch(r).then(resp=>{if(resp&&resp.ok){const copy=resp.clone();caches.open(CACHE).then(c=>c.put(r,copy)).catch(()=>{})}return resp}).catch(()=>caches.match(r).then(x=>x||(r.mode==='navigate'?caches.match('/index.html'):Response.error()))));
});
