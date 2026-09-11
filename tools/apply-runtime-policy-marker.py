from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
worker = ROOT / 'tools/vercel-whatsapp-worker.mjs'
w = worker.read_text(encoding='utf-8')

marker = """app.get('/api/runtime-policy', (_req, res) => {
  res.json({ ok: true, policy: 'post-acceptance-quiet-v1' });
});

"""
anchor = "app.get('/api/activity', (_req, res) => {"

if "post-acceptance-quiet-v1" not in w:
    if anchor not in w:
        raise SystemExit('runtime policy anchor not found')
    w = w.replace(anchor, marker + anchor, 1)
    worker.write_text(w, encoding='utf-8')
    print('Runtime policy marker applied.')
else:
    print('Runtime policy marker already present.')
