import crypto from 'node:crypto';

export type IncomingWhatsAppMessage = {
  messageId: string;
  from?: string;
  groupId?: string;
  text?: string;
  type: string;
  timestamp?: string;
  raw: unknown;
};

export function verifyMetaSignature(rawBody: Buffer, signatureHeader?: string): boolean {
  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret) return process.env.NODE_ENV !== 'production';
  if (!signatureHeader?.startsWith('sha256=')) return false;

  const received = signatureHeader.slice('sha256='.length);
  const expected = crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');

  if (received.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected));
}

function textFromMessage(message: any): string | undefined {
  if (message?.type === 'text') return message?.text?.body;
  if (message?.type === 'button') return message?.button?.text;
  if (message?.type === 'interactive') {
    return message?.interactive?.button_reply?.title ?? message?.interactive?.list_reply?.title;
  }
  return undefined;
}

function groupIdFrom(message: any, value: any): string | undefined {
  return (
    message?.group_id ??
    message?.context?.group_id ??
    message?.conversation?.group_id ??
    value?.group_id ??
    value?.metadata?.group_id
  );
}

export function extractIncomingMessages(payload: any): IncomingWhatsAppMessage[] {
  const result: IncomingWhatsAppMessage[] = [];

  for (const entry of payload?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      const value = change?.value;
      for (const message of value?.messages ?? []) {
        result.push({
          messageId: message?.id ?? crypto.randomUUID(),
          from: message?.from,
          groupId: groupIdFrom(message, value),
          text: textFromMessage(message),
          type: message?.type ?? 'unknown',
          timestamp: message?.timestamp,
          raw: message,
        });
      }
    }
  }

  return result;
}
