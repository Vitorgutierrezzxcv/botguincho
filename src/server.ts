import express from 'express';
import { z } from 'zod';
import { parseServiceRequest } from './domain/parser.js';
import { decideRequest } from './domain/decision.js';
import { GoogleRoutesClient, roundEtaToOperationalMinutes } from './integrations/googleRoutes.js';
import { WhatsAppCloudClient } from './integrations/whatsapp.js';

const app = express();
app.use(express.json());

const googleRoutes = new GoogleRoutesClient();
const whatsapp = new WhatsAppCloudClient();

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'botguincho',
    integrations: {
      googleRoutes: googleRoutes.isConfigured(),
      whatsapp: whatsapp.isConfigured(),
      whatsappSendEnabled: whatsapp.isSendEnabled(),
    },
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

const etaTestSchema = z.object({
  origin: z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
  }),
  destinationAddress: z.string().min(3),
  roundToMinutes: z.number().int().positive().max(60).default(10),
});

app.post('/api/eta/test', async (req, res) => {
  const parsedBody = etaTestSchema.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({ error: 'invalid_request', details: parsedBody.error.flatten() });
  }

  try {
    const route = await googleRoutes.computeEta({
      origin: parsedBody.data.origin,
      destinationAddress: parsedBody.data.destinationAddress,
    });

    const rawMinutes = route.durationSeconds / 60;
    const suggestedMinutes = roundEtaToOperationalMinutes(
      route.durationSeconds,
      parsedBody.data.roundToMinutes,
    );

    return res.json({
      route,
      distanceKm: Number((route.distanceMeters / 1000).toFixed(1)),
      rawEtaMinutes: Number(rawMinutes.toFixed(1)),
      suggestedEtaMinutes: suggestedMinutes,
      suggestedReply: `${suggestedMinutes} minutos ou menos`,
    });
  } catch (error) {
    return res.status(502).json({
      error: 'route_error',
      message: error instanceof Error ? error.message : 'Erro desconhecido ao consultar Google Routes.',
    });
  }
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`botguincho listening on port ${port}`);
});
