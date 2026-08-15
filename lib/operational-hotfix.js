import { Sandbox } from '@vercel/sandbox';

const SANDBOX_NAME = 'botguincho-wa-vercel-v12';
const REPO_URL = 'https://github.com/Vitorgutierrezzxcv/botguincho.git';
const WORKER_RAW_URL = 'https://raw.githubusercontent.com/Vitorgutierrezzxcv/botguincho/main/tools/vercel-whatsapp-worker.mjs';
const DATA_DIR = '/vercel/sandbox/.botguincho-data';
const CLIENT_ID = 'cliente-teste';
const PORT = 3001;
const SETTINGS_FILE = `${DATA_DIR}/${CLIENT_ID}/settings.json`;
const WORKER_FILE = '/vercel/sandbox/tools/vercel-whatsapp-worker.mjs';
const MARKER_FILE = '/vercel/sandbox/.operational-mode-v6-recovery';

const OPERATIONAL_INSTRUCTIONS = `Você é o atendente operacional do Bot Guincho em grupos de seguradoras.

REGRA ABSOLUTA: NÃO FAÇA PERGUNTAS. NÃO FAÇA TRIAGEM. NÃO PEÇA NENHUMA INFORMAÇÃO ADICIONAL.
É proibido pedir ou confirmar placa, modelo, telefone, contato do responsável, ponto de referência, endereço, segurança do local, acessibilidade, garagem/subsolo, chave, rodas, acompanhante ou qualquer outro dado.
É proibido escrever frases como "vou verificar", "estou verificando", "vou confirmar", "aguarde", "preciso que confirme", "para liberar o despacho" ou equivalentes.
Quando uma mensagem representar um acionamento/pedido de guincho ou reboque, responda somente: Confirmado ✅.
Nunca invente ETA. Nunca repita os dados recebidos. Nunca faça listas ou perguntas.`;

function env(credential = '') {
  return {
    BOTGUINCHO_DATA_DIR: DATA_DIR,
    BOTGUINCHO_PLATFORM_PORT: String(PORT),
    WHATSAPP_CLIENT_ID: CLIENT_ID,
    PUPPETEER_SKIP_DOWNLOAD: 'true',
    OPENAI_API_KEY: credential || '',
    OPENAI_BASE_URL: 'https://ai-gateway.vercel.sh/v1',
    OPENAI_MODEL: 'openai/gpt-5.4-mini',
    VERCEL: '1',
  };
}

async function getSandbox() {
  return Sandbox.getOrCreate({
    name: SANDBOX_NAME,
    source: { type: 'git', url: REPO_URL, depth: 1 },
    runtime: 'node22',
    resources: { vcpus: 2 },
    timeout: 40 * 60 * 1000,
    persistent: true,
    snapshotExpiration: 7 * 24 * 60 * 60 * 1000,
    keepLastSnapshots: { count: 1 },
    ports: [PORT],
    networkPolicy: 'allow-all',
    resume: true,
  });
}

export async function applyOperationalHotfix(credential = '') {
  const sandbox = await getSandbox();
  const check = await sandbox.runCommand({ cmd: 'bash', args: ['-lc', `test -f ${MARKER_FILE}`], signal: AbortSignal.timeout(5000) });
  if (check.exitCode === 0) return { applied: false, reason: 'already-applied' };

  const settings = {
    companyName: 'Bot Guincho', aiEnabled: true, aiModel: 'openai/gpt-5.4-mini',
    aiInstructions: OPERATIONAL_INSTRUCTIONS, replyEveryMessage: true, humanTakeover: false,
  };

  const resetScript = `
    const fs = require('fs');
    const path = require('path');
    async function main() {
      const response = await fetch(${JSON.stringify(WORKER_RAW_URL)}, { cache: 'no-store' });
      if (!response.ok) throw new Error('worker download HTTP ' + response.status);
      const worker = await response.text();
      fs.mkdirSync(path.dirname(${JSON.stringify(WORKER_FILE)}), { recursive: true });
      fs.writeFileSync(${JSON.stringify(WORKER_FILE)}, worker);
      const settingsFile = ${JSON.stringify(SETTINGS_FILE)};
      fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
      fs.writeFileSync(settingsFile, ${JSON.stringify(JSON.stringify(settings, null, 2))}, { mode: 0o600 });
    }
    main().catch(e => { console.error(e); process.exit(1); });
  `;
  const reset = await sandbox.runCommand({ cmd: 'node', args: ['-e', resetScript], signal: AbortSignal.timeout(15000) });
  if (reset.exitCode !== 0) throw new Error('Falha ao restaurar worker estável.');

  const patchScript = `
    const fs = require('fs');
    let source = fs.readFileSync(${JSON.stringify(WORKER_FILE)}, 'utf8');
    const needle = "    if (!settings.aiEnabled || !settings.replyEveryMessage) return;\\n    const trackerContext = await fetchTrackerContext(readableText);";
    const replacement = `    if (!settings.aiEnabled || !settings.replyEveryMessage) return;\n\n    // BOTGUINCHO_DIRECT_DISPATCH_V1\n    const isDispatchRequest = /(reboque|guincho|servi[cç]o selecionado)/i.test(readableText) && /(origem\\s*:|destino\\s*:|pane|ve[ií]culo|carro|moto|fiat|ford|chevrolet|volkswagen|vw|renault|toyota|honda|hyundai)/i.test(readableText);\n    if (isDispatchRequest) {\n      const directReply = 'Confirmado ✅';\n      await msg.reply(directReply);\n      remember(msg.from, 'user', readableText);\n      remember(msg.from, 'assistant', directReply);\n      logEvent('reply', \\`${groupName}: \\${directReply} [resposta operacional direta]\\`, { groupId: msg.from });\n      return;\n    }\n\n    const trackerContext = await fetchTrackerContext(readableText);`;
    if (!source.includes(needle)) throw new Error('Trecho estável do worker não encontrado');
    source = source.replace(needle, replacement);
    fs.writeFileSync(${JSON.stringify(WORKER_FILE)}, source);
    fs.writeFileSync(${JSON.stringify(MARKER_FILE)}, new Date().toISOString());
  `;
  const patched = await sandbox.runCommand({ cmd: 'node', args: ['-e', patchScript], signal: AbortSignal.timeout(10000) });
  if (patched.exitCode !== 0) throw new Error('Falha ao aplicar resposta operacional estável.');

  await sandbox.runCommand({
    cmd: 'bash',
    args: ['-lc', 'pkill -f "node tools/vercel-whatsapp-worker.mjs" 2>/dev/null || true; pkill -x chromium 2>/dev/null || true; pkill -x chrome 2>/dev/null || true; rm -rf /vercel/sandbox/.whatsapp-worker-lock'],
    signal: AbortSignal.timeout(8000),
  }).catch(() => undefined);
  await new Promise((resolve) => setTimeout(resolve, 1000));
  await sandbox.runCommand({
    cmd: 'bash',
    args: ['-lc', 'cd /vercel/sandbox; mkdir -p .whatsapp-worker-lock; rm -f worker.log; node tools/vercel-whatsapp-worker.mjs >> worker.log 2>&1'],
    env: env(credential), detached: true,
  });
  await new Promise((resolve) => setTimeout(resolve, 3500));
  return { applied: true };
}
