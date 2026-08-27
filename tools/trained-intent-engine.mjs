import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TRAINING_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../training');
const EXPORTS_DIR = path.join(TRAINING_DIR, 'exports');
const PATTERNS_FILE = path.join(TRAINING_DIR, 'operational-patterns-v4-final.json');

const INTENT_BY_PATTERN_KEY = new Map([
  ['availability', 'availability'],
  ['eta', 'eta'],
  ['authorization', 'authorization'],
  ['quote', 'quote'],
  ['scheduled', 'scheduled_dispatch'],
  ['scheduledDispatch', 'scheduled_dispatch'],
  ['cancellation', 'cancellation'],
  ['cancellationOrAbort', 'cancellation'],
  ['cancellationOrDecline', 'cancellation'],
  ['completion', 'closure'],
  ['closure', 'closure'],
]);

const STOPWORDS = new Set([
  'a','o','as','os','um','uma','uns','umas','de','da','do','das','dos','e','ou','em','no','na','nos','nas',
  'para','pra','pro','por','com','sem','ao','aos','que','se','ja','mais','esse','essa','isso','este','esta','aqui','ai',
]);

const META_TEXT = /\b(exemplo|historico|histórica|histórico|normalmente|geralmente|padr[aã]o|deve|precisa|ap[oó]s|antes|quando|pedido|prestador tamb[eé]m|assist[eê]ncia pergunta|serve apenas|n[aã]o valor|pode chegar|pode ocorrer|pode ser|deve ser|vem ap[oó]s|seguida de)\b/i;

function normalize(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(?:[a-z]\s+){2,}[a-z]\b/g, (match) => match.replace(/\s+/g, ''))
    .replace(/[^a-z0-9?]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(value = '') {
  return normalize(value)
    .replace(/\?/g, '')
    .split(' ')
    .filter((token) => token.length >= 2 && !STOPWORDS.has(token));
}

function safeJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function quotedUtterances(value = '') {
  const out = [];
  const text = String(value || '');
  const pattern = /["'“”‘’]([^"'“”‘’]{2,100})["'“”‘’]/g;
  for (const match of text.matchAll(pattern)) {
    const candidate = String(match[1] || '').trim();
    if (candidate) out.push(candidate);
  }
  return out;
}

function looksLikeDirectUtterance(value = '') {
  const text = String(value || '').trim();
  if (!text || text.length > 100 || META_TEXT.test(text)) return false;
  if (/[+=><]/.test(text)) return false;
  if (/\b(ficha completa|origem\/destino|localiza[cç][aã]o\/rota|dados do servi[cç]o|canal externo|revis[aã]o humana)\b/i.test(text)) return false;
  return true;
}

const learnedPatterns = [];
const patternKeys = new Set();
const sourceGroups = new Set();
let sourceMessages = 0;
let sourceScreenshots = 0;

function register(intent, phrase, source) {
  const normalized = normalize(phrase);
  if (!intent || !normalized || normalized.length < 2) return;
  const meaningful = tokens(normalized);
  if (!meaningful.length && !/^\d{2,3}\?$/.test(normalized)) return;
  const key = `${intent}|${normalized}`;
  if (patternKeys.has(key)) return;
  patternKeys.add(key);
  learnedPatterns.push({
    intent,
    phrase: String(phrase).trim(),
    normalized,
    tokens: meaningful,
    source,
  });
}

function loadTraining() {
  const consolidated = safeJson(PATTERNS_FILE);
  if (consolidated?.source) {
    sourceMessages = Number(consolidated.source.cataloguedMessages || 0);
    sourceScreenshots = Number(consolidated.source.screenshots || 0);
  }
  for (const fixture of consolidated?.intentFixtures || []) {
    const intent = fixture?.intent === 'authorization_or_formal_dispatch' ? null : fixture?.intent;
    if (intent) register(intent, fixture.text, 'operational-patterns-v4-final');
  }

  let files = [];
  try {
    files = fs.readdirSync(EXPORTS_DIR).filter((name) => name.endsWith('.json')).sort();
  } catch {
    return;
  }

  for (const name of files) {
    const data = safeJson(path.join(EXPORTS_DIR, name));
    if (!data) continue;
    if (data.group) sourceGroups.add(String(data.group));
    const count = Number(data.messageCount || data.parsedMessageCount || 0);
    // O total consolidado e preferido; esta soma serve de fallback para bases futuras.
    if (!sourceMessages && Number.isFinite(count)) sourceMessages += count;

    for (const [patternKey, rawExamples] of Object.entries(data.conversationPatterns || {})) {
      const intent = INTENT_BY_PATTERN_KEY.get(patternKey);
      if (!intent || !Array.isArray(rawExamples)) continue;
      for (const raw of rawExamples) {
        const extracted = quotedUtterances(raw);
        for (const phrase of extracted) register(intent, phrase, name);
        if (!extracted.length && looksLikeDirectUtterance(raw)) register(intent, raw, name);
      }
    }
  }
}

loadTraining();

function overlapScore(inputTokens, patternTokens) {
  if (patternTokens.length < 3 || inputTokens.length < 3) return 0;
  const input = new Set(inputTokens);
  const pattern = new Set(patternTokens);
  let shared = 0;
  for (const token of pattern) if (input.has(token)) shared += 1;
  if (shared < 3) return 0;
  const patternCoverage = shared / pattern.size;
  const inputCoverage = shared / input.size;
  if (patternCoverage < 0.9 || inputCoverage < 0.55) return 0;
  return 0.78 + Math.min(0.17, (patternCoverage + inputCoverage - 1.45) * 0.2);
}

export function inferTrainedIntent(text = '') {
  const input = normalize(text);
  if (!input || !learnedPatterns.length) return null;
  const inputTokens = tokens(input);
  let best = null;
  let tiedIntent = null;

  for (const pattern of learnedPatterns) {
    let score = 0;
    if (input === pattern.normalized) {
      score = 1;
    } else if (pattern.tokens.length >= 2 && pattern.normalized.length >= 8 && input.includes(pattern.normalized)) {
      score = 0.96;
    } else {
      score = overlapScore(inputTokens, pattern.tokens);
    }
    if (score < 0.82) continue;

    if (!best || score > best.score + 0.0001) {
      best = { ...pattern, score };
      tiedIntent = null;
    } else if (Math.abs(score - best.score) <= 0.0001 && pattern.intent !== best.intent) {
      tiedIntent = pattern.intent;
    }
  }

  // Em empate entre intenções, falha fechado: o runtime atual continua decidindo.
  if (!best || tiedIntent) return null;
  return best.intent;
}

export function trainedRuntimeStats() {
  return {
    loaded: learnedPatterns.length > 0,
    patterns: learnedPatterns.length,
    groups: sourceGroups.size,
    cataloguedMessages: sourceMessages,
    screenshots: sourceScreenshots,
    trainingDir: TRAINING_DIR,
  };
}
