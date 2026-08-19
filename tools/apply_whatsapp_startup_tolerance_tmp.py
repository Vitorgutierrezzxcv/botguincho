from pathlib import Path
p=Path('tools/vercel-whatsapp-worker.mjs')
s=p.read_text()
old="""  waClient = new Client({
    authStrategy: new LocalAuth({ clientId, dataPath: sessionDir }),
    puppeteer: {
      executablePath,
      headless: true,
      args: browserArgs,
      protocolTimeout: 120000,
    },
  });
"""
new="""  waClient = new Client({
    authStrategy: new LocalAuth({ clientId, dataPath: sessionDir }),
    // O WhatsApp Web pode levar mais de 2 minutos para injetar a sessão em Chromium
    // serverless. Mantemos um timeout finito, porém mais tolerante, sem apagar LocalAuth.
    authTimeoutMs: 300000,
    puppeteer: {
      executablePath,
      headless: true,
      args: [...new Set([...browserArgs, '--disable-background-timer-throttling', '--disable-renderer-backgrounding'])],
      protocolTimeout: 300000,
    },
  });
"""
if old not in s:
    if 'protocolTimeout: 300000' in s:
        print('WHATSAPP_STARTUP_TOLERANCE_ALREADY_APPLIED')
        raise SystemExit(0)
    raise SystemExit('client config marker not found')
s=s.replace(old,new,1)
needle="""  waClient.on('qr', async (qr) => {
"""
if "waClient.on('loading_screen'" not in s:
    block="""  waClient.on('loading_screen', (percent, message) => {
    logEvent('whatsapp-loading', `WhatsApp carregando: ${percent ?? '?'}% ${message || ''}`.trim());
  });

"""
    if needle not in s: raise SystemExit('qr marker not found')
    s=s.replace(needle,block+needle,1)
p.write_text(s)
print('WHATSAPP_STARTUP_TOLERANCE_PATCHED')
