const express = require('express');
const dotenv = require('dotenv');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const path = require('node:path');
const fs = require('node:fs');

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;
const NVIDIA_BASE_URL = (process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1').replace(/\/+$/, '');
const NVIDIA_MODEL = process.env.NVIDIA_MODEL || 'moonshotai/kimi-k3';
const REQUEST_TIMEOUT_MS = 45000;
const API_CALLS_PER_MINUTE = Number(process.env.API_CALLS_PER_MINUTE || 10);
const PRIVACY_CONTACT_EMAIL = process.env.PRIVACY_CONTACT_EMAIL || '';

if (process.env.TRUST_PROXY === '1') {
  app.set('trust proxy', 1);
}

app.disable('x-powered-by');
app.use(helmet());
app.use(express.json({ limit: '32kb' }));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'CodeChef Copilot backend',
    nvidiaConfigured: Boolean(NVIDIA_API_KEY),
    model: NVIDIA_MODEL
  });
});

app.get('/privacy', (_req, res) => {
  const escapeHtml = (value) => value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
  const contactParagraph = PRIVACY_CONTACT_EMAIL
    ? `<p>For privacy questions or deletion requests, contact the publisher at <a href="mailto:${escapeHtml(PRIVACY_CONTACT_EMAIL)}">${escapeHtml(PRIVACY_CONTACT_EMAIL)}</a>.</p>`
    : '<p>For privacy questions, please contact the publisher through the extension store listing.</p>';
  const page = fs.readFileSync(path.join(__dirname, 'privacy.html'), 'utf8')
    .replace('<!-- PRIVACY_CONTACT -->', contactParagraph);
  res.type('html').send(page);
});

const solveRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: Number.isInteger(API_CALLS_PER_MINUTE) && API_CALLS_PER_MINUTE > 0 ? API_CALLS_PER_MINUTE : 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: {
    ok: false,
    error: 'Rate limit reached. Please wait a minute and try again.'
  }
});

function validatePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return 'Request body must be an object.';
  }
  if (payload.type === 'MCQ') {
    if (typeof payload.question !== 'string' || !payload.question.trim() || payload.question.length > 1500) {
      return 'MCQ question is required and must be at most 1500 characters.';
    }
    if (!Array.isArray(payload.options) || payload.options.length < 2 || payload.options.length > 8) {
      return 'MCQ must contain between 2 and 8 options.';
    }
    if (payload.options.some((option) => !option || typeof option.id !== 'string' || typeof option.text !== 'string' || !option.text.trim() || option.text.length > 1000)) {
      return 'Each MCQ option must have a string id and non-empty text of at most 1000 characters.';
    }
    return null;
  }
  if (payload.type === 'PROGRAMMING') {
    if (typeof payload.problem !== 'string' || !payload.problem.trim() || payload.problem.length > 12000) {
      return 'Programming problem statement is required and must be at most 12000 characters.';
    }
    for (const field of ['question', 'constraints', 'currentCode', 'error']) {
      if (payload[field] !== undefined && (typeof payload[field] !== 'string' || payload[field].length > 12000)) {
        return `${field} must be a string of at most 12000 characters.`;
      }
    }
    return null;
  }
  return 'type must be MCQ or PROGRAMMING.';
}

function buildPrompts(payload) {
  if (payload.type === 'MCQ') {
    return {
      system: [
        'Answer this multiple-choice learning question using only the supplied question and options.',
        'Do not invent option identifiers. If the question is ambiguous, still return the most defensible option and reduce confidence.',
        'Return one JSON object only: {"type":"MCQ","selectedOption":"<exact option id>","confidence":0.0,"reasoning":"brief explanation"}'
      ].join(' '),
      user: JSON.stringify({
        question: payload.question,
        options: payload.options.map(({ id, text }) => ({ id, text }))
      })
    };
  }

  return {
    system: [
      'Solve the supplied programming problem in C. Use only the supplied statement, constraints, examples, and feedback.',
      'Do not assume the task is summing two numbers. Produce a complete replacement C program.',
      'Return one JSON object only: {"type":"PROGRAMMING","language":"C","solution":"...","confidence":0.0,"reasoning":"brief explanation"}'
    ].join(' '),
    user: JSON.stringify({
      question: payload.question || '',
      problem: payload.problem,
      constraints: payload.constraints || '',
      examples: Array.isArray(payload.examples) ? payload.examples : [],
      currentCode: payload.currentCode || '',
      error: payload.error || ''
    })
  };
}

function parseModelJson(content) {
  const normalized = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = normalized.indexOf('{');
  const end = normalized.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new Error('NVIDIA response did not contain a JSON object.');
  }
  return JSON.parse(normalized.slice(start, end + 1));
}

function validateModelResult(payload, result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new Error('NVIDIA response has an invalid shape.');
  }
  if (payload.type === 'MCQ') {
    const option = payload.options.find(({ id }) => id === result.selectedOption);
    if (result.type !== 'MCQ' || !option) {
      throw new Error('NVIDIA response selected an option not present in the request.');
    }
    return {
      type: 'MCQ',
      selectedOption: option.id,
      confidence: Number.isFinite(result.confidence) ? Math.min(1, Math.max(0, result.confidence)) : 0,
      reasoning: typeof result.reasoning === 'string' ? result.reasoning.slice(0, 500) : ''
    };
  }

  if (result.type !== 'PROGRAMMING' || result.language?.toUpperCase() !== 'C' || typeof result.solution !== 'string' || !result.solution.trim() || result.solution.length > 20000) {
    throw new Error('NVIDIA response did not contain a usable complete C solution.');
  }
  return {
    type: 'PROGRAMMING',
    language: 'C',
    solution: result.solution,
    confidence: Number.isFinite(result.confidence) ? Math.min(1, Math.max(0, result.confidence)) : 0,
    reasoning: typeof result.reasoning === 'string' ? result.reasoning.slice(0, 500) : ''
  };
}

async function callNvidia(payload) {
  if (!NVIDIA_API_KEY) {
    const error = new Error('NVIDIA_API_KEY is not configured. Copy .env.example to .env and add your key.');
    error.statusCode = 503;
    throw error;
  }

  const prompts = buildPrompts(payload);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(`${NVIDIA_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${NVIDIA_API_KEY}`
      },
      body: JSON.stringify({
        model: NVIDIA_MODEL,
        messages: [
          { role: 'system', content: prompts.system },
          { role: 'user', content: prompts.user }
        ],
        temperature: 0.2,
        max_tokens: payload.type === 'MCQ' ? 500 : 3500
      }),
      signal: controller.signal
    });
  } catch (error) {
    const networkError = new Error(error.name === 'AbortError' ? 'NVIDIA request timed out.' : 'Could not reach NVIDIA API.');
    networkError.statusCode = 502;
    throw networkError;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const apiError = new Error(`NVIDIA API returned HTTP ${response.status}.`);
    apiError.statusCode = response.status === 429 ? 429 : 502;
    throw apiError;
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    const responseError = new Error('NVIDIA API response did not include message content.');
    responseError.statusCode = 502;
    throw responseError;
  }
  return validateModelResult(payload, parseModelJson(content));
}

app.post('/api/solve', solveRateLimit, async (req, res) => {
  const validationError = validatePayload(req.body);
  if (validationError) {
    return res.status(400).json({ ok: false, error: validationError });
  }
  try {
    const result = await callNvidia(req.body);
    return res.json({ ok: true, result });
  } catch (error) {
    const status = Number.isInteger(error.statusCode) ? error.statusCode : 502;
    return res.status(status).json({ ok: false, error: error.message || 'Unable to obtain a valid model response.' });
  }
});

app.use((error, _req, res, _next) => {
  if (error instanceof SyntaxError && 'body' in error) {
    return res.status(400).json({ ok: false, error: 'Request body contains invalid JSON.' });
  }
  console.error('Unhandled backend error:', error.message);
  return res.status(500).json({ ok: false, error: 'Internal backend error.' });
});

app.listen(PORT, HOST, () => {
  console.log(`CodeChef Copilot backend listening on ${HOST}:${PORT}`);
});
