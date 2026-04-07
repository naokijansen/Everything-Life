/**
 * OpenClaw Dashboard — Backend API
 * Express server that persists dashboard state to state.json
 *
 * Endpoints:
 *   GET  /api/state          → read full state
 *   POST /api/state          → overwrite full state
 *   POST /api/archive        → archive done → history (called by cron)
 *   GET  /health             → liveness check (no auth)
 *
 * Auth: every /api/* route requires header   x-api-key: <OPENCLAW_KEY>
 */

const express = require('express');
const fs      = require('fs');
const path    = require('path');
const cors    = require('cors');

const app  = express();
const PORT = 3001;

// ── Config ─────────────────────────────────────────────────────────────────
const STATE_FILE = path.join(__dirname, 'state.json');
const API_KEY    = process.env.OPENCLAW_KEY;

if (!API_KEY) {
  console.error('ERROR: Set the OPENCLAW_KEY environment variable before starting.');
  process.exit(1);
}

// ── Default state (used only when state.json doesn't exist yet) ─────────────
const DEFAULT_STATE = {
  tasks: {
    red:    [],
    green:  [],
    yellow: [],
    blue:   [],
  },
  done:    [],
  history: {},
  nextId:  20,
};

// ── Helpers ─────────────────────────────────────────────────────────────────
function readState() {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return structuredClone(DEFAULT_STATE);
  }
}

function writeState(s) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2), 'utf8');
}

function todayKey() {
  return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
}

function validateState(s) {
  return (
    s &&
    typeof s === 'object' &&
    s.tasks &&
    ['red', 'green', 'yellow', 'blue'].every(q => Array.isArray(s.tasks[q])) &&
    Array.isArray(s.done) &&
    typeof s.history === 'object' &&
    typeof s.nextId  === 'number'
  );
}

// ── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'] }));
app.use(express.json({ limit: '1mb' }));

// Serve the frontend from /public (index.html)
app.use(express.static(path.join(__dirname, 'public')));

function auth(req, res, next) {
  if (req.headers['x-api-key'] !== API_KEY) {
    return res.status(401).json({ error: 'Unauthorised' });
  }
  next();
}

// ── Routes ───────────────────────────────────────────────────────────────────

// Liveness — no auth, used by monitoring / Cloudflare health checks
app.get('/health', (_req, res) => res.json({ ok: true }));

// Read state
app.get('/api/state', auth, (req, res) => {
  res.json(readState());
});

// Overwrite state (frontend calls this after every mutation)
app.post('/api/state', auth, (req, res) => {
  const s = req.body;
  if (!validateState(s)) {
    return res.status(400).json({ error: 'Invalid state shape' });
  }
  writeState(s);
  res.json({ ok: true });
});

// Archive: move done[] → history[today] and clear done[]
// Called by: midnight cron  AND  the "archive →" button in the UI
app.post('/api/archive', auth, (req, res) => {
  const s = readState();
  const count = s.done.length;

  if (count > 0) {
    const key = todayKey();
    if (!s.history[key]) s.history[key] = [];
    s.done.forEach(t => s.history[key].push({ text: t.text, q: t.q }));
    s.done = [];
    writeState(s);
  }

  console.log(`[${new Date().toISOString()}] /api/archive — moved ${count} task(s)`);
  res.json({ ok: true, archived: count });
});

// ── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, '127.0.0.1', () => {
  console.log(`[${new Date().toISOString()}] OpenClaw API listening on 127.0.0.1:${PORT}`);
});
