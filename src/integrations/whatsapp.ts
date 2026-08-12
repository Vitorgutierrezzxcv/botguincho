type SendTextInput = {
  recipientId: string;
  text: string;
  replyToMessageId?: string;
};

type WhatsAppSendResult = {
  ok: boolean;
  status: number;
  body: unknown;
};

export class WhatsAppCloudClient {
  private readonly token?: string;
  private readonly phoneNumberId?: string;
  private readonly graphVersion?: string;
  private readonly sendEnabled: boolean;

  constructor() {
    this.token = process.env.WHATSAPP_ACCESS_TOKEN;
    this.phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    this.graphVersion = process.env.WHATSAPP_GRAPH_VERSION;
    this.sendEnabled = process.env.WHATSAPP_SEND_ENABLED === 'true';
  }

  isConfigured(): boolean {
    return Boolean(this.token && this.phoneNumberId && this.graphVersion);
  }

  isSendEnabled(): boolean {
    return this.sendEnabled;
  }

  async sendText(input: SendTextInput): Promise<WhatsAppSendResult> {
    if (!this.sendEnabled) {
      return {
        ok: true,
        status: 200,
        body: {
          dryRun: true,
          recipientId: input.recipientId,
          text: input.text,
          replyToMessageId: input.replyToMessageId,
        },
      };
    }

    if (!this.token || !this.phoneNumberId || !this.graphVersion) {
      throw new Error(
        'WhatsApp Cloud API não configurada. Defina WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID e WHATSAPP_GRAPH_VERSION.',
      );
    }

    const payload: Record<string, unknown> = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: input.recipientId,
      type: 'text',
      text: { preview_url: false, body: input.text },
    };

    if (input.replyToMessageId) {
      payload.context = { message_id: input.replyToMessageId };
    }

    const response = await fetch(
      `https://graph.facebook.com/${this.graphVersion}/${this.phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      },
    );

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = await response.text();
    }

    return { ok: response.ok, status: response.status, body };
  }
}
