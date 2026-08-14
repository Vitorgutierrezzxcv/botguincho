import { getWorkerStatus } from '../../lib/sandbox-runtime.js';
import { needsBrowserRepair, repairBrowserDeps } from '../../lib/sandbox-repair.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  res.setHeader('cache-control', 'no-store');

  const status = await getWorkerStatus();
  const browserError = status?.whatsapp?.lastError || '';

  if (needsBrowserRepair(browserError)) {
    try {
      await repairBrowserDeps();
      return res.status(200).json({
        ...status,
        whatsapp: {
          ...status.whatsapp,
          status: 'iniciando',
          lastError: null,
        },
        infrastructure: {
          ...(status.infrastructure || {}),
          status: 'repairing',
          message: 'Instalando automaticamente as dependências do Chromium. O WhatsApp será reiniciado em seguida.',
        },
      });
    } catch (error) {
      return res.status(200).json({
        ...status,
        infrastructure: {
          ...(status.infrastructure || {}),
          status: 'error',
          message: `Falha no reparo automático do Chromium: ${error instanceof Error ? error.message : String(error)}`,
        },
      });
    }
  }

  return res.status(200).json(status);
}
