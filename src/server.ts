import express from 'express';
import { z } from 'zod';
import { parseServiceRequest } from './domain/parser.js';
import { decideRequest } from './domain/decision.js';

const app = express();
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'botguincho' });
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

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`botguincho listening on port ${port}`);
});
