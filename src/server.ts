import express from 'express';
import { z } from 'zod';
import { parseServiceRequest } from './domain/parser.js';
import { decideRequest } from './domain/decision.js';
import { GConnectBrowserProvider } from './integrations/gconnectBrowser.js';
import { GoogleRoutesClient, roundEtaToOperationalMinutes } from './integrations/googleRoutes.js';
import { WhatsAppCloudClient } from './integrations/whatsapp.js';

const app = express();
app.use(express.json({ limit: '2mb' }));

const googleRoutes = new GoogleRoutesClient();
const whatsapp = new WhatsAppCloudClient();
const gconnect = new GConnectBrowserProvider();

// A interface antiga que exigia Worker URL + token foi removida.
// A raiz sempre encaminha para o painel novo, que usa /api/worker/*
// e inicializa a infraestrutura automaticamente pela Vercel.
app.get('/', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, max-age=0, must-revalidate');
  return res.redirect(302, '/index.html?botguincho=v2');
});

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'botguincho',
    ui: 'v2',
    manualWorkerConfiguration: false,
    integrations: {
      googleRoutes: googleRoutes.isConfigured(),
      whatsapp: whatsapp.isConfigured(),
      whatsappSendEnabled: whatsapp.isSendEnabled(),
      gconnect: gconnect.isConfigured(),
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
  return res.json({ request, decision: decideRequest(request) });
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
  const parsed = etaTestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_request', details: parsed.error.flatten() });
  }

  try {
    const route = await googleRoutes.computeEta({
      origin: parsed.data.origin,
      destinationAddress: parsed.data.destinationAddress,
    });

    const suggestedMinutes = roundEtaToOperationalMinutes(route.durationSeconds, parsed.data.roundToMinutes);

    return res.json({
      route,
      distanceKm: Number((route.distanceMeters / 1000).toFixed(1)),
      rawEtaMinutes: Number((route.durationSeconds / 60).toFixed(1)),
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

const gconnectTestSchema = z.object({
  vehicleId: z.string().min(1).optional(),
});

app.post('/api/gconnect/position', async (req, res) => {
  const parsed = gconnectTestSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_request', details: parsed.error.flatten() });
  }

  const vehicleId = parsed.data.vehicleId ?? process.env.GCONNECT_DEFAULT_VEHICLE ?? 'GSWOH17';

  try {
    return res.json({ vehicleId, position: await gconnect.getCurrentPosition(vehicleId) });
  } catch (error) {
    return res.status(502).json({
      error: 'gconnect_error',
      message: error instanceof Error ? error.message : 'Erro desconhecido ao consultar GConnect.',
    });
  }
});

const liveEtaSchema = z.object({
  vehicleId: z.string().min(1).optional(),
  destinationAddress: z.string().min(3),
  roundToMinutes: z.number().int().positive().max(60).default(10),
});

app.post('/api/eta/live', async (req, res) => {
  const parsed = liveEtaSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_request', details: parsed.error.flatten() });
  }

  const vehicleId = parsed.data.vehicleId ?? process.env.GCONNECT_DEFAULT_VEHICLE ?? 'GSWOH17';

  try {
    const position = await gconnect.getCurrentPosition(vehicleId);
    const route = await googleRoutes.computeEta({
      origin: position,
      destinationAddress: parsed.data.destinationAddress,
    });

    const suggestedMinutes = roundEtaToOperationalMinutes(route.durationSeconds, parsed.data.roundToMinutes);

    return res.json({
      vehicleId,
      position,
      route,
      distanceKm: Number((route.distanceMeters / 1000).toFixed(1)),
      rawEtaMinutes: Number((route.durationSeconds / 60).toFixed(1)),
      suggestedEtaMinutes: suggestedMinutes,
      suggestedReply: `${suggestedMinutes} minutos ou menos`,
    });
  } catch (error) {
    return res.status(502).json({
      error: 'live_eta_error',
      message: error instanceof Error ? error.message : 'Erro ao consultar posição e ETA.',
    });
  }
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, '0.0.0.0', () => {
  console.log(`botguincho listening on port ${port}`);
});
