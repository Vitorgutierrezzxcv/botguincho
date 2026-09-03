const CACHE='acionador-pwa-v22';
const ASSETS=['/','/index.html','/app.css','/app.js','/owner-dashboard.css','/owner-dashboard.js','/test-mode-visibility.js','/operation-command-center.js','/tratto-ui.css','/manifest.webmanifest','/icon.svg','/branding.js'];
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).catch(()=>{}))});
self.addEventListener('activate',e=>{e.waitUntil(Promise.all([self.clients.claim(),caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))]))});
self.addEventListener('fetch',e=>{const r=e.request;const u=new URL(r.url);if(r.method!=='GET'||u.pathname.startsWith('/api/'))return;e.respondWith(fetch(r).then(resp=>{if(resp&&resp.ok){const copy=resp.clone();caches.open(CACHE).then(c=>c.put(r,copy)).catch(()=>{})}return resp}).catch(()=>caches.match(r).then(x=>x||(r.mode==='navigate'?caches.match('/index.html'):Response.error()))))});
