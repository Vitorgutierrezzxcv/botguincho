import { decideRequest } from '../domain/decision.js';
import { parseServiceRequest } from '../domain/parser.js';
import type { IncomingWhatsAppMessage } from '../integrations/whatsapp-webhook.js';
import { WhatsAppCloudClient } from '../integrations/whatsapp.js';

export type AutomationResult = {
  messageId: string;
  groupId?: string;
  sender?: string;
  ignored: boolean;
  reason?: string;
  request?: ReturnType<typeof parseServiceRequest>;
  decision?: ReturnType<typeof decideRequest>;
  response?: unknown;
};

const whatsapp = new WhatsAppCloudClient();

function looksLikeTowRequest(text: string): boolean {
  return /(dispon[ií]vel|reboque|guincho|origem|destino|ve[ií]culo|pane)/i.test(text);
}

export async function processIncomingWhatsAppMessage(
  message: IncomingWhatsAppMessage,
): Promise<AutomationResult> {
  if (!message.text) {
    return {
      messageId: message.messageId,
      groupId: message.groupId,
      sender: message.from,
      ignored: true,
      reason: `Tipo de mensagem ainda não automatizado: ${message.type}`,
    };
  }

  if (!looksLikeTowRequest(message.text)) {
    return {
      messageId: message.messageId,
      groupId: message.groupId,
      sender: message.from,
      ignored: true,
      reason: 'Mensagem não parece ser uma solicitação de guincho.',
    };
  }

  const request = parseServiceRequest(message.text);
  const decision = decideRequest(request);

  // Nesta POC, a resposta automática real fica restrita a conversas individuais.
  // A Groups API oficial da Meta possui onboarding e ciclo de vida próprios;
  // não tratamos um groupId detectado como um telefone/recipient comum.
  if (message.groupId) {
    return {
      messageId: message.messageId,
      groupId: message.groupId,
      sender: message.from,
      ignored: false,
      request,
      decision,
      response: {
        dryRun: true,
        reason: 'Mensagem de grupo recebida. Envio ao grupo aguarda validação do endpoint/payload oficial da Groups API para a conta habilitada.',
        proposedText: decision.action === 'AUTO_ACCEPT' ? (process.env.AUTO_ACCEPT_TEXT ?? 'Bora') : undefined,
      },
    };
  }

  if (decision.action !== 'AUTO_ACCEPT' || !message.from) {
    return {
      messageId: message.messageId,
      sender: message.from,
      ignored: false,
      request,
      decision,
    };
  }

  const response = await whatsapp.sendText({
    recipientId: message.from,
    text: process.env.AUTO_ACCEPT_TEXT ?? 'Bora',
    replyToMessageId: message.messageId,
  });

  return {
    messageId: message.messageId,
    sender: message.from,
    ignored: false,
    request,
    decision,
    response,
  };
}
