import fs from 'node:fs/promises';
import path from 'node:path';
import { Client, LocalAuth, Message } from 'whatsapp-web.js';

export type WhatsAppWebSessionStatus = 'idle' | 'starting' | 'qr' | 'ready' | 'authenticated' | 'disconnected' | 'error';

export type WhatsAppGroup = {
  id: string;
  name: string;
  selected: boolean;
};

type SessionState = {
  client: Client;
  status: WhatsAppWebSessionStatus;
  qr?: string;
  lastError?: string;
};

const clientIdPattern = /^[a-zA-Z0-9_-]{1,64}$/;

export class WhatsAppWebManager {
  private readonly sessions = new Map<string, SessionState>();
  private readonly sessionDir: string;
  private readonly configDir: string;

  constructor() {
    this.sessionDir = process.env.WHATSAPP_WEB_SESSION_DIR ?? '.wwebjs_auth';
    this.configDir = process.env.WHATSAPP_WEB_CONFIG_DIR ?? '.wwebjs_config';
  }

  private assertClientId(clientId: string): void {
    if (!clientIdPattern.test(clientId)) {
      throw new Error('clientId inválido. Use apenas letras, números, hífen e underscore (máx. 64 caracteres).');
    }
  }

  private configPath(clientId: string): string {
    return path.join(this.configDir, `${clientId}.json`);
  }

  private async readAllowedGroups(clientId: string): Promise<Set<string>> {
    try {
      const raw = await fs.readFile(this.configPath(clientId), 'utf8');
      const parsed = JSON.parse(raw) as { allowedGroupIds?: string[] };
      return new Set(parsed.allowedGroupIds ?? []);
    } catch (error: any) {
      if (error?.code === 'ENOENT') return new Set();
      throw error;
    }
  }

  private async writeAllowedGroups(clientId: string, groupIds: string[]): Promise<void> {
    await fs.mkdir(this.configDir, { recursive: true });
    await fs.writeFile(
      this.configPath(clientId),
      JSON.stringify({ allowedGroupIds: [...new Set(groupIds)].sort() }, null, 2),
      'utf8',
    );
  }

  async start(clientId: string): Promise<WhatsAppWebSessionStatus> {
    this.assertClientId(clientId);

    const existing = this.sessions.get(clientId);
    if (existing && existing.status !== 'disconnected' && existing.status !== 'error') {
      return existing.status;
    }

    const client = new Client({
      authStrategy: new LocalAuth({ clientId, dataPath: this.sessionDir }),
      puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      },
    });

    const state: SessionState = { client, status: 'starting' };
    this.sessions.set(clientId, state);

    client.on('qr', (qr) => {
      state.status = 'qr';
      state.qr = qr;
      state.lastError = undefined;
    });

    client.on('authenticated', () => {
      state.status = 'authenticated';
      state.qr = undefined;
    });

    client.on('ready', () => {
      state.status = 'ready';
      state.qr = undefined;
      state.lastError = undefined;
      console.log(`[whatsapp-web:${clientId}] pronto`);
    });

    client.on('auth_failure', (message) => {
      state.status = 'error';
      state.lastError = String(message);
    });

    client.on('disconnected', (reason) => {
      state.status = 'disconnected';
      state.lastError = String(reason);
    });

    client.on('message', (message) => {
      void this.handleMessage(clientId, message);
    });

    void client.initialize().catch((error) => {
      state.status = 'error';
      state.lastError = error instanceof Error ? error.message : String(error);
    });

    return state.status;
  }

  getStatus(clientId: string): { status: WhatsAppWebSessionStatus; qr?: string; lastError?: string } {
    this.assertClientId(clientId);
    const state = this.sessions.get(clientId);
    if (!state) return { status: 'idle' };
    return { status: state.status, qr: state.qr, lastError: state.lastError };
  }

  async listGroups(clientId: string): Promise<WhatsAppGroup[]> {
    this.assertClientId(clientId);
    const state = this.sessions.get(clientId);
    if (!state || state.status !== 'ready') throw new Error('WhatsApp ainda não está pronto para listar grupos.');

    const allowed = await this.readAllowedGroups(clientId);
    const chats = await state.client.getChats();
    return chats
      .filter((chat) => chat.isGroup)
      .map((chat) => ({
        id: chat.id._serialized,
        name: chat.name || chat.id._serialized,
        selected: allowed.has(chat.id._serialized),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }

  async setAllowedGroups(clientId: string, groupIds: string[]): Promise<void> {
    this.assertClientId(clientId);
    const state = this.sessions.get(clientId);
    if (!state || state.status !== 'ready') throw new Error('WhatsApp ainda não está pronto para configurar grupos.');

    const available = new Set((await this.listGroups(clientId)).map((group) => group.id));
    const invalid = groupIds.filter((id) => !available.has(id));
    if (invalid.length > 0) throw new Error(`Há grupos inválidos ou indisponíveis: ${invalid.join(', ')}`);
    await this.writeAllowedGroups(clientId, groupIds);
  }

  private async handleMessage(clientId: string, message: Message): Promise<void> {
    try {
      if (message.from === 'status@broadcast') return;
      if (!message.from.endsWith('@g.us')) return;

      const allowed = await this.readAllowedGroups(clientId);
      if (!allowed.has(message.from)) return;

      const text = message.body?.trim() ?? '';
      console.log(`[whatsapp-web:${clientId}] grupo=${message.from} autor=${message.author ?? 'desconhecido'} texto=${text}`);

      const testCommand = (process.env.WHATSAPP_WEB_TEST_COMMAND ?? '!ping').trim().toLowerCase();
      if (testCommand && text.toLowerCase() === testCommand) {
        const reply = process.env.WHATSAPP_WEB_TEST_REPLY ?? 'PONG - Bot Guincho funcionando!';
        await message.reply(reply);
      }
    } catch (error) {
      console.error(`[whatsapp-web:${clientId}] erro ao processar mensagem`, error);
    }
  }
}
