from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
path = ROOT / 'tools/learning-engine.mjs'
text = path.read_text(encoding='utf-8')

old = """export function createLearningStore({ knowledgeFile, historyFile, indexFile }) {
  const readJson = async (file, fallback) => {
    try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch (error) { if (error?.code === 'ENOENT') return fallback; throw error; }
  };
  const writeJson = async (file, value) => fs.writeFile(file, JSON.stringify(value, null, 2), { mode: 0o600 });
"""

new = r"""export function createLearningStore({ knowledgeFile, historyFile, indexFile }) {
  let writeQueue = Promise.resolve();

  function extractTopLevelJsonObjects(raw = '') {
    const docs = [];
    let start = -1;
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = 0; i < raw.length; i += 1) {
      const ch = raw[i];
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
      if (ch === '{') {
        if (depth === 0) start = i;
        depth += 1;
      } else if (ch === '}' && depth > 0) {
        depth -= 1;
        if (depth === 0 && start >= 0) {
          docs.push(raw.slice(start, i + 1));
          start = -1;
        }
      }
    }
    return docs;
  }

  const atomicWriteJson = async (file, value) => {
    const temp = `${file}.${process.pid}.${Date.now()}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
    await fs.rename(temp, file);
  };

  const writeJson = async (file, value) => {
    const operation = writeQueue.then(() => atomicWriteJson(file, value));
    writeQueue = operation.catch(() => undefined);
    return operation;
  };

  const readJson = async (file, fallback) => {
    let raw;
    try {
      raw = await fs.readFile(file, 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') return fallback;
      throw error;
    }

    try {
      return JSON.parse(raw);
    } catch (parseError) {
      // Recupera o caso real observado em produção: dois snapshots JSON completos
      // acabaram colados no mesmo arquivo após gravações concorrentes. Mantemos um
      // backup byte-a-byte antes de qualquer reparo e mesclamos os objetos válidos.
      const recoveredDocs = extractTopLevelJsonObjects(raw)
        .map((doc) => {
          try { return JSON.parse(doc); } catch { return null; }
        })
        .filter((doc) => doc && typeof doc === 'object' && !Array.isArray(doc));

      if (!recoveredDocs.length) throw parseError;

      const recovered = Object.assign({}, ...recoveredDocs);
      const backup = `${file}.corrupt-${Date.now()}.bak`;
      await fs.writeFile(backup, raw, { mode: 0o600 }).catch(() => undefined);
      await writeJson(file, recovered);
      return recovered;
    }
  };
"""

if old not in text:
    raise SystemExit('learning-engine createLearningStore block not found or already patched')

path.write_text(text.replace(old, new, 1), encoding='utf-8')
print('Learning JSON recovery and atomic persistence patch applied.')

# Trigger workflow after the workflow file exists.
