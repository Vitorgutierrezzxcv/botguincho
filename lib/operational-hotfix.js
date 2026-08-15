import { Sandbox } from '@vercel/sandbox';

const SANDBOX_NAME = 'botguincho-wa-vercel-v12';
const REPO_URL = 'https://github.com/Vitorgutierrezzxcv/botguincho.git';
const DATA_DIR = '/vercel/sandbox/.botguincho-data';
const CLIENT_ID = 'cliente-teste';
const PORT = 3001;
const SETTINGS_FILE = `${DATA_DIR}/${CLIENT_ID}/settings.json`;
const MARKER_FILE = '/vercel/sandbox/.operational-mode-v3';

const OPERATIONAL_INSTRUCTIONS = `Você é o atendente operacional do Bot Guincho em grupos de seguradoras.

REGRA ABSOLUTA: NÃO FAÇA PERGUNTAS. NÃO FAÇA TRIAGEM. NÃO PEÇA NENHUMA INFORMAÇÃO ADICIONAL.

É proibido pedir ou confirmar placa, modelo, telefone, contato do responsável, ponto de referência, endereço, segurança do local, acessibilidade, garagem/subsolo, chave, rodas, acompanhante ou qualquer outro dado.

É proibido escrever frases como "vou verificar", "estou verificando", "vou confirmar", "aguarde", "preciso que confirme", "para liberar o despacho" ou equivalentes.

Quando uma mensagem representar um acionamento/pedido de guincho ou reboque, considere o chamado recebido e responda SOMENTE no formato operacional abaixo.

Se houver ETA REAL calculado pelo sistema:
Confirmado ✅
Previsão de chegada: X min.

Se NÃO houver ETA real calculado pelo sistema:
Confirmado ✅

NUNCA invente ETA. NUNCA repita origem, destino, veículo, pane ou os detalhes recebidos. NUNCA use listas, checklists ou parágrafos explicativos. NUNCA termine com pergunta. NUNCA peça confirmação.

Para mensagens que não sejam acionamentos, responda apenas se for necessário, sempre em no máximo duas linhas e sem fazer perguntas.

Os dados do GConnect são factuais quando fornecidos pelo sistema. Não exponha bateria, odômetro ou ignição sem necessidade. Não diga que é IA, bot ou modelo de linguagem.`;

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

  const check = await sandbox.runCommand({
    cmd: 'bash',
    args: ['-lc', `test -f ${MARKER_FILE}`],
    signal: AbortSignal.timeout(5000),
  });
  if (check.exitCode === 0) return { applied: false, reason: 'already-applied' };

  const settings = {
    companyName: 'Bot Guincho',
    aiEnabled: true,
    aiModel: 'openai/gpt-5.4-mini',
    aiInstructions: OPERATIONAL_INSTRUCTIONS,
    replyEveryMessage: true,
    humanTakeover: false,
  };

  const writeScript = `
    const fs = require('fs');
    const path = require('path');
    const file = ${JSON.stringify(SETTINGS_FILE)};
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, ${JSON.stringify(JSON.stringify(settings, null, 2))}, { mode: 0o600 });
    fs.writeFileSync(${JSON.stringify(MARKER_FILE)}, new Date().toISOString());
  `;

  const written = await sandbox.runCommand({
    cmd: 'node',
    args: ['-e', writeScript],
    signal: AbortSignal.timeout(8000),
  });
  if (written.exitCode !== 0) throw new Error('Não foi possível gravar o modo operacional no Sandbox.');

  await sandbox.runCommand({
    cmd: 'bash',
    args: ['-lc', 'pkill -f "node tools/vercel-whatsapp-worker.mjs" 2>/dev/null || true; pkill -f "chromium|chrome" 2>/dev/null || true; rm -rf /vercel/sandbox/.whatsapp-worker-lock'],
    signal: AbortSignal.timeout(8000),
  }).catch(() => undefined);

  await new Promise((resolve) => setTimeout(resolve, 800));

  await sandbox.runCommand({
    cmd: 'bash',
    args: ['-lc', [
      'cd /vercel/sandbox',
      'mkdir -p /vercel/sandbox/.whatsapp-worker-lock',
      'rm -f /vercel/sandbox/worker.log',
      'node tools/vercel-whatsapp-worker.mjs >> /vercel/sandbox/worker.log 2>&1',
    ].join('\n')],
    env: env(credential),
    detached: true,
  });

  await new Promise((resolve) => setTimeout(resolve, 2500));
  return { applied: true };
}
