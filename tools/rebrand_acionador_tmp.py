from pathlib import Path
import json

ROOT = Path('.')

SVG = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="Acionador.ai">
  <rect width="512" height="512" rx="118" fill="#0877F9"/>
  <!-- flatbed truck -->
  <g fill="#fff">
    <path d="M63 309h264V212c0-8 6-14 14-14h58c19 0 34 8 45 24l29 43c7 10 10 22 10 34v63c0 13-10 23-23 23H339c-4 0-7-3-7-7v-42H137v42c0 4-3 7-7 7H76c-12 0-22-10-22-22v-28c0-17 4-28 9-30z"/>
    <path d="M49 322h289v24H49c-8 0-14-5-14-12 0-6 6-12 14-12z"/>
    <path d="M49 322l-34 35c-5 5-5 12 0 16 5 4 12 3 16-1l43-43z"/>
    <rect x="354" y="184" width="48" height="20" rx="10"/>
    <!-- car on the bed -->
    <path d="M112 273c4-17 15-31 32-39 13-7 31-10 55-10h46c24 0 42 5 55 15l29 22c8 6 13 15 13 25v13H103v-11c0-7 3-12 9-15zm40-20c-8 4-14 10-17 18h72v-29h-17c-16 0-28 4-38 11zm73-11v29h78l-21-16c-11-9-25-13-42-13h-15z"/>
  </g>
  <g fill="#0877F9">
    <circle cx="124" cy="385" r="30"/><circle cx="398" cy="385" r="30"/>
    <circle cx="154" cy="299" r="20"/><circle cx="291" cy="299" r="20"/>
  </g>
  <g fill="#fff">
    <circle cx="124" cy="385" r="15"/><circle cx="398" cy="385" r="15"/>
    <circle cx="154" cy="299" r="10"/><circle cx="291" cy="299" r="10"/>
  </g>
  <path fill="#0877F9" d="M369 227h27c12 0 21 5 28 15l22 33h-77z"/>
</svg>'''

for p in [Path('icon.svg'), Path('public/icon.svg')]:
    p.write_text(SVG, encoding='utf-8')

# Rebrand user-facing copy while keeping internal API/header names intact.
html_files = [Path('index.html'), Path('qr.html')] + list(Path('public').glob('*.html'))
for p in html_files:
    if not p.exists():
        continue
    s = p.read_text(encoding='utf-8')
    s = s.replace('BOT GUINCHO', 'ACIONADOR.AI')
    s = s.replace('Bot Guincho', 'Acionador.ai')
    s = s.replace('BotGuincho', 'Acionador.ai')
    s = s.replace('<div class="brand-mark">BG</div><div><strong id="companyNameDisplay">Central Guincho</strong><small>Gestão operacional</small></div>', '<div class="brand-mark"><img src="/icon.svg" alt="Acionador.ai"></div><div><strong>Acionador.ai</strong><small id="companyNameDisplay">Central operacional</small></div>')
    s = s.replace('<div class="brand-mark">BG</div>', '<div class="brand-mark"><img src="/icon.svg" alt="Acionador.ai"></div>')
    s = s.replace('<span>2. Bot confirma</span>', '<span>2. Acionador confirma</span>')
    # Put the approved symbol on auth/admin surfaces.
    if 'login-card' in s and 'auth-brand-icon' not in s:
        s = s.replace('<div class="card login-card">', '<div class="card login-card"><img class="auth-brand-icon" src="/icon.svg" alt="Acionador.ai">', 1)
    if 'master-brand' in s and 'master-brand-icon' not in s:
        s = s.replace('<div class="master-brand"><div class="eyebrow">', '<div class="master-brand"><img class="master-brand-icon" src="/icon.svg" alt="Acionador.ai"><div class="eyebrow">', 1)
    p.write_text(s, encoding='utf-8')

# Rebrand safe display strings in front-end JS only; do not touch internal protocol keys.
for p in [Path('app.js'), Path('public/app.js'), Path('public/login.js'), Path('public/master.js'), Path('public/onboarding.js'), Path('public/test-mode-visibility.js')]:
    if p.exists():
        s = p.read_text(encoding='utf-8').replace('BOT GUINCHO', 'ACIONADOR.AI').replace('Bot Guincho', 'Acionador.ai')
        p.write_text(s, encoding='utf-8')

# App/PWA metadata.
for p in [Path('manifest.webmanifest'), Path('public/manifest.webmanifest')]:
    if not p.exists():
        continue
    data = json.loads(p.read_text(encoding='utf-8'))
    data['name'] = 'Acionador.ai'
    data['short_name'] = 'Acionador'
    data['description'] = 'Automação inteligente para operações de assistência 24h.'
    data['icons'] = [{'src':'/icon.svg','sizes':'any','type':'image/svg+xml','purpose':'any maskable'}]
    p.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')

# Visual treatment for the approved icon inside the existing dark UI.
css_extra = '''\n/* ACIONADOR_AI_BRAND_V1 */\n.brand-mark{padding:0!important;overflow:hidden;background:transparent!important;box-shadow:none!important}\n.brand-mark img{display:block;width:100%;height:100%;object-fit:cover;border-radius:15px}\n.auth-brand-icon{display:block;width:76px;height:76px;border-radius:22px;margin:0 0 18px;box-shadow:0 14px 40px rgba(8,119,249,.22)}\n.master-brand-icon{display:block;width:58px;height:58px;border-radius:17px;margin-bottom:12px;box-shadow:0 12px 34px rgba(8,119,249,.2)}\n'''
for p in [Path('app.css'), Path('public/app.css')]:
    if p.exists():
        s = p.read_text(encoding='utf-8')
        if 'ACIONADOR_AI_BRAND_V1' not in s:
            s += css_extra
        p.write_text(s, encoding='utf-8')

# README branding only; operational/internal names remain untouched elsewhere.
p = Path('README.md')
if p.exists():
    s = p.read_text(encoding='utf-8').replace('BOT GUINCHO', 'ACIONADOR.AI').replace('Bot Guincho', 'Acionador.ai').replace('BotGuincho', 'Acionador.ai')
    p.write_text(s, encoding='utf-8')

print('Rebrand Acionador.ai aplicado.')
# trigger rebrand workflow
