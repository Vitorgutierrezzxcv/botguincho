from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORKER = ROOT / 'tools/vercel-whatsapp-worker.mjs'

s = WORKER.read_text(encoding='utf-8')

old = """async function readJson(file, fallback) {\n  try {\n    return JSON.parse(await fs.readFile(file, 'utf8'));\n  } catch (error) {\n    if (error?.code === 'ENOENT') return fallback;\n    throw error;\n  }\n}\n\nasync function writeJson(file, value, mode) {\n  await ensureDir();\n  await fs.writeFile(file, JSON.stringify(value, null, 2), mode ? { mode } : undefined);\n  if (mode) await fs.chmod(file, mode).catch(() => undefined);\n}\n"""

new = r"""const jsonWriteQueues = new Map();

function extractTopLevelJsonValues(raw = '') {
  const values = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (start < 0) {
      if (/\s/.test(ch)) continue;
      if (ch !== '{' && ch !== '[') continue;
      start = i;
      depth = 1;
      inString = false;
      escaped = false;
      continue;
    }
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{' || ch === '[') depth += 1;
    else if (ch === '}' || ch === ']') depth -= 1;
    if (depth === 0) {
      const chunk = raw.slice(start, i + 1);
      try { values.push(JSON.parse(chunk)); } catch {}
      start = -1;
    }
  }
  return values;
}

async function repairCorruptedJson(file, raw, fallback, originalError) {
  const candidates = extractTopLevelJsonValues(raw);
  if (!candidates.length) throw originalError;
  // Em corrupção por duas gravações concorrentes, o último documento completo
  // representa o estado mais novo. Preserva o original antes de reparar.
  const recovered = candidates[candidates.length - 1];
  const backup = `${file}.corrupt-${Date.now()}.bak`;
  await fs.copyFile(file, backup).catch(() => undefined);
  logEvent('recovery', 'JSON persistente recuperado automaticamente.', {
    file: path.basename(file),
    backup: path.basename(backup),
    documentsFound: candidates.length,
    originalError: String(originalError),
  });
  await writeJson(file, recovered).catch(() => undefined);
  return recovered ?? fallback;
}

async function readJson(file, fallback) {
  let raw = '';
  try {
    raw = await fs.readFile(file, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback;
    if (raw && error instanceof SyntaxError) {
      return repairCorruptedJson(file, raw, fallback, error);
    }
    throw error;
  }
}

async function writeJson(file, value, mode) {
  await ensureDir();
  const key = path.resolve(file);
  const previous = jsonWriteQueues.get(key) || Promise.resolve();
  const next = previous.catch(() => undefined).then(async () => {
    const temp = `${file}.tmp-${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const payload = JSON.stringify(value, null, 2);
    try {
      await fs.writeFile(temp, payload, mode ? { mode } : undefined);
      if (mode) await fs.chmod(temp, mode).catch(() => undefined);
      await fs.rename(temp, file);
      if (mode) await fs.chmod(file, mode).catch(() => undefined);
    } finally {
      await fs.unlink(temp).catch(() => undefined);
    }
  });
  jsonWriteQueues.set(key, next);
  try {
    await next;
  } finally {
    if (jsonWriteQueues.get(key) === next) jsonWriteQueues.delete(key);
  }
}
"""

if old not in s:
    raise SystemExit('readJson/writeJson block not found')

s = s.replace(old, new, 1)
WORKER.write_text(s, encoding='utf-8')
print('Persistent JSON recovery + atomic serialized writes applied.')
