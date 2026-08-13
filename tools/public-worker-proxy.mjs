import express from 'express';

const app = express();
const port = Number(process.env.BOTGUINCHO_PUBLIC_PORT ?? 3101);
const target = process.env.BOTGUINCHO_INTERNAL_WORKER_URL ?? 'http://127.0.0.1:3001';
const token = process.env.BOTGUINCHO_ADMIN_TOKEN ?? '';

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-BotGuincho-Token');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'botguincho-public-worker' });
});

app.use('/api', express.raw({ type: '*/*', limit: '10mb' }), async (req, res) => {
  if (token && req.get('x-botguincho-token') !== token) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    const destination = new URL(req.originalUrl, target);
    const headers = {};
    const contentType = req.get('content-type');
    if (contentType) headers['content-type'] = contentType;

    const response = await fetch(destination, {
      method: req.method,
      headers,
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : req.body,
      redirect: 'manual',
    });

    const responseType = response.headers.get('content-type');
    if (responseType) res.setHeader('content-type', responseType);
    res.status(response.status).send(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    res.status(502).json({
      error: 'worker_unreachable',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

app.listen(port, '127.0.0.1', () => {
  console.log(`[public-worker] proxy seguro em http://127.0.0.1:${port}`);
});
