export default function handler(_req, res) {
  res.setHeader('cache-control', 'no-store');
  res.status(200).json({ ok: true, service: 'botguincho-vercel' });
}
