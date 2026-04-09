/**
 * OpenClaw Dashboard — Backend API
 *
 * Endpoints:
 *   GET  /health             → liveness (no auth)
 *   GET  /api/auth           → session check (no auth)
 *   POST /api/login          → create session (no auth)
 *   POST /api/logout         → destroy session
 *   GET  /api/state          → read state          [session]
 *   POST /api/state          → overwrite state     [session]
 *   POST /api/archive        → archive done[]      [session]
 *   GET  /api/backups        → list backups        [session]
 *   GET  /api/openclaw       → read feed           [session]
 *   POST /api/openclaw       → push feed item      [x-api-key — OpenClaw bot only]
 *
 * Env vars required:
 *   OPENCLAW_KEY       — used by OpenClaw bot to push feed items (never sent to browser)
 *   SESSION_SECRET     — signs the session cookie  (openssl rand -hex 32)
 *   DASHBOARD_PASSWORD — the password you type on the login screen
 */

const express = require('express');
const session = require('express-session');
const fs      = require('fs');
const path    = require('path');
const cors    = require('cors');

const app  = express();
const PORT = 3001;

// ── Config ───────────────────────────────────────────────────────────────────
const STATE_FILE         = path.join(__dirname, 'state.json');
const BACKUP_DIR         = path.join(__dirname, 'backups');
const FEED_FILE          = path.join(__dirname, 'openclaw.json');
const BACKUP_RETAIN_DAYS = 30;
const FEED_MAX           = 200;

const OPENCLAW_KEY       = process.env.OPENCLAW_KEY;
const SESSION_SECRET     = process.env.SESSION_SECRET;
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD;

if (!OPENCLAW_KEY || !SESSION_SECRET || !DASHBOARD_PASSWORD) {
  console.error('ERROR: Set OPENCLAW_KEY, SESSION_SECRET, and DASHBOARD_PASSWORD before starting.');
  process.exit(1);
}

if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

// ── Default state ────────────────────────────────────────────────────────────
const DEFAULT_STATE = {
  tasks: { red: [], green: [], yellow: [], blue: [] },
  done: [],
  history: {},
  calendar: {},
  nextId: 20,
  calNextId: 1,
};

// ── State helpers ────────────────────────────────────────────────────────────
function readState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch { return structuredClone(DEFAULT_STATE); }
}

function writeState(s) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2), 'utf8');
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function validateState(s) {
  return (
    s && typeof s === 'object' && s.tasks &&
    ['red', 'green', 'yellow', 'blue'].every(q => Array.isArray(s.tasks[q])) &&
    Array.isArray(s.done) &&
    typeof s.history === 'object' &&
    typeof s.nextId  === 'number'
  );
}

// ── Backup helpers ────────────────────────────────────────────────────────────
let lastBackupDay = null;

function writeBackup(s, force = false) {
  const day = todayKey();
  if (!force && lastBackupDay === day) return;
  const file = path.join(BACKUP_DIR, `state-${day}.json`);
  try {
    fs.writeFileSync(file, JSON.stringify(s, null, 2), 'utf8');
    lastBackupDay = day;
    console.log(`[${new Date().toISOString()}] Backup written → backups/state-${day}.json`);
    pruneBackups();
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Backup FAILED: ${err.message}`);
  }
}

function pruneBackups() {
  try {
    const cutoff = Date.now() - BACKUP_RETAIN_DAYS * 86_400_000;
    for (const f of fs.readdirSync(BACKUP_DIR)) {
      if (!/^state-\d{4}-\d{2}-\d{2}\.json$/.test(f)) continue;
      const full = path.join(BACKUP_DIR, f);
      if (fs.statSync(full).mtimeMs < cutoff) {
        fs.unlinkSync(full);
        console.log(`[${new Date().toISOString()}] Pruned old backup: ${f}`);
      }
    }
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Prune FAILED: ${err.message}`);
  }
}

// ── Feed helpers ──────────────────────────────────────────────────────────────
const VALID_FEED_TYPES = new Set(['event', 'news', 'alert', 'note']);

function readFeed() {
  try { return JSON.parse(fs.readFileSync(FEED_FILE, 'utf8')); }
  catch { return []; }
}

function writeFeed(items) {
  fs.writeFileSync(FEED_FILE, JSON.stringify(items, null, 2), 'utf8');
}

// ── Middleware ────────────────────────────────────────────────────────────────
app.set('trust proxy', 1);

app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'] }));
app.use(express.json({ limit: '1mb' }));

app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
}));

app.use(express.static(path.join(__dirname, 'public')));

// Session auth — for browser requests
function auth(req, res, next) {
  if (!req.session?.authed) return res.status(401).json({ error: 'Unauthorised' });
  next();
}

// API key auth — for OpenClaw bot only
function botAuth(req, res, next) {
  if (req.headers['x-api-key'] !== OPENCLAW_KEY) {
    return res.status(401).json({ error: 'Unauthorised' });
  }
  next();
}

// ── Routes ────────────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => res.json({ ok: true }));

app.get('/api/auth', (req, res) => {
  res.json({ ok: !!req.session?.authed });
});

app.post('/api/login', (req, res) => {
  if (req.body.password === DASHBOARD_PASSWORD) {
    req.session.authed = true;
    return res.json({ ok: true });
  }
  setTimeout(() => res.status(401).json({ error: 'Wrong password' }), 400);
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.clearCookie('connect.sid').json({ ok: true }));
});

app.get('/api/state', auth, (_req, res) => {
  res.json(readState());
});

app.post('/api/state', auth, (req, res) => {
  const s = req.body;
  if (!validateState(s)) return res.status(400).json({ error: 'Invalid state shape' });
  writeBackup(readState(), false);
  writeState(s);
  res.json({ ok: true });
});

app.post('/api/archive', auth, (req, res) => {
  const s = readState();
  writeBackup(s, true);
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

app.get('/api/backups', auth, (_req, res) => {
  try {
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => /^state-\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .sort().reverse()
      .map(f => ({
        filename: f,
        date: f.slice(6, 16),
        sizeKb: Math.round(fs.statSync(path.join(BACKUP_DIR, f)).size / 1024 * 10) / 10,
      }));
    res.json({ backups: files });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Read feed — session auth (browser)
app.get('/api/openclaw', auth, (_req, res) => {
  res.json({ items: readFeed() });
});

// Push feed item — bot auth only
app.post('/api/openclaw', botAuth, (req, res) => {
  const { type, content, title } = req.body || {};
  if (!VALID_FEED_TYPES.has(type)) {
    return res.status(400).json({ error: `Invalid type. Must be one of: ${[...VALID_FEED_TYPES].join(', ')}` });
  }
  if (!content || typeof content !== 'string' || !content.trim()) {
    return res.status(400).json({ error: 'content must be a non-empty string' });
  }
  const item = {
    id:      Date.now(),
    type,
    title:   (title && title.trim()) || null,
    content: content.trim(),
    ts:      new Date().toISOString(),
  };
  const items = [item, ...readFeed()].slice(0, FEED_MAX);
  writeFeed(items);
  console.log(`[${new Date().toISOString()}] /api/openclaw ← [${type}] ${content.slice(0, 80)}`);
  res.json({ ok: true, id: item.id });
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, '127.0.0.1', () => {
  console.log(`[${new Date().toISOString()}] OpenClaw API listening on 127.0.0.1:${PORT}`);
});
