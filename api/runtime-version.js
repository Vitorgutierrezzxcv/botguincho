export default async function handler(_req, res) {
  res.setHeader('cache-control', 'no-store');
  return res.status(200).json({
    ok: true,
    version: 'simple-dispatch-v1',
    maxConcurrentCalls: 2,
    secondCallEtaCapMinutes: 60,
  });
}
