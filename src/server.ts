import express from 'express';
import { z } from 'zod';
import { parseServiceRequest } from './domain/parser.js';
import { decideRequest } from './domain/decision.js';
import {
  extractIncomingMessages,
  verifyMetaSignature,
} from './integrations/whatsapp-webhook.js';
import { processIncomingWhatsAppMessage } from './services/whatsapp-automation.js';

const app = express();

// Mantemos os bytes originais para validar X-Hub-Signature-256 da Meta.
app.use(
  express.json({
    verify: (req, _res, buffer) => {
      (req as express.Request & { rawBody?: Buffer }).rawBody = Buffer.from(buffer);
    },
  }),
);

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'botguincho',
    whatsappWebhookConfigured: Boolean(process.env.WHATSAPP_VERIFY_TOKEN),
    metaSignatureConfigured: Boolean(process.env.META_APP_SECRET),
    whatsappSendEnabled: process.env.WHATSAPP_SEND_ENABLED === 'true',
  });
});

const parseBodySchema = z.object({
  text: z.string().min(1),
  insurer: z.string().optional(),
});

app.post('/api/requests/parse', (req, res) => {
  const parsedBody = parseBodySchema.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({ error: 'invalid_request', details: parsedBody.error.flatten() });
  }

  const request = parseServiceRequest(parsedBody.data.text, parsedBody.data.insurer);
  const decision = decideRequest(request);

  return res.json({ request, decision });
});

// Validação inicial do webhook durante a configuração no painel da Meta.
app.get('/webhooks/whatsapp', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (
    mode === 'subscribe' &&
    typeof token === 'string' &&
    token === process.env.WHATSAPP_VERIFY_TOKEN &&
    typeof challenge === 'string'
  ) {
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

app.post('/webhooks/whatsapp', async (req, res) => {
  const rawBody = (req as express.Request & { rawBody?: Buffer }).rawBody ?? Buffer.from('');
  const signature = req.header('x-hub-signature-256');

  if (!verifyMetaSignature(rawBody, signature)) {
    return res.status(401).json({ error: 'invalid_meta_signature' });
  }

  // A Meta espera confirmação rápida. Processamos nesta POC antes de responder,
  // mas o próximo passo é mover isso para uma fila persistente.
  const messages = extractIncomingMessages(req.body);
  const results = [];

  for (const message of messages) {
    try {
      results.push(await processIncomingWhatsAppMessage(message));
    } catch (error) {
      console.error('whatsapp_automation_error', {
        messageId: message.messageId,
        error: error instanceof Error ? error.message : String(error),
      });
      results.push({
        messageId: message.messageId,
        error: 'automation_failed',
      });
    }
  }

  console.log('whatsapp_webhook_processed', {
    received: messages.length,
    results,
  });

  return res.status(200).json({ received: messages.length });
});

// Endpoint local/POC para testar um payload de webhook sem depender da Meta.
app.post('/api/poc/whatsapp-webhook', async (req, res) => {
  if (process.env.NODE_ENV === 'production') return res.sendStatus(404);

  const messages = extractIncomingMessages(req.body);
  const results = [];
  for (const message of messages) {
    results.push(await processIncomingWhatsAppMessage(message));
  }

  return res.json({ messages, results });
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`botguincho listening on port ${port}`);
});
