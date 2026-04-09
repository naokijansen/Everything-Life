/**
 * OpenClaw Dashboard — Backend API
 * Express server that persists dashboard state to state.json
 *
 * Endpoints:
 *   GET  /api/auth           → check session validity (no auth required)
 *   POST /api/login          → create session (no auth required)
 *   POST /api/logout         → destroy session
 *   GET  /api/state          → read full state
 *   POST /api/state          → overwrite full state
 *   POST /api/archive        → archive done → history (called by cron)
 *   GET  /api/backups        → list available backup files
 *   GET  /health             → liveness check (no auth required)
 *
 * Auth: session cookie (httpOnly, secure, sameSite=strict).
 *       OPENCLAW_KEY never leaves the server — it is not sent to the browser.
 *
 * Env vars required:
 *   OPENCLAW_KEY       — internal integrity token (rotate freely, never exposed)
 *   SESSION_SECRET     — signs the session cookie  (openssl rand -hex 32)
 *   DASHBOARD_PASSWORD — the password you type on the login screen
 *
 * Backups:
 *   Written to ./backups/state-YYYY-MM-DD.json on every /api/archive call
 *   and once daily on the first /api/state POST of each day.
 *   Kept for BACKUP_RETAIN_DAYS (default 30). Older files are pruned automatically.
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
const BACKUP_RETAIN_DAYS = 30;
const API_KEY            = process.env.OPENCLAW_KEY;
const SESSION_SECRET     = process.env.SESSION_SECRET;
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD;

if (!API_KEY || !SESSION_SECRET || !DASHBOARD_PASSWORD) {
  console.error(
    'ERROR: OPENCLAW_KEY, SESSION_SECRET, and DASHBOARD_PASSWORD must all be set.'
  );
  process.exit(1);
}

if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

// ── Default state ─────────────────────────────────────────────────────────────
const DEFAULT_STATE = {
  tasks: { red: [], green: [], yellow: [], blue: [] },
  done:      [],
  history:   {},
  calendar:  {},
  nextId:    20,
  calNextId: 1,
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
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

// ── Middleware ────────────────────────────────────────────────────────────────
// Tell Express it's behind a trusted reverse proxy (Nginx/Cloudflare).
// Required for secure cookies to work correctly when the app itself runs on HTTP.
app.set('trust proxy', 1);

app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'] }));
app.use(express.json({ limit: '1mb' }));

app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,             // JS in the browser cannot read this cookie at all
    secure: true,               // only transmitted over HTTPS
    sameSite: 'strict',         // never sent on cross-origin requests (CSRF protection)
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  },
}));

app.use(express.static(path.join(__dirname, 'public')));

// Session-based auth guard — replaces the old x-api-key header check
function auth(req, res, next) {
  if (!req.session?.authed) return res.status(401).json({ error: 'Unauthorised' });
  next();
}

// ── Routes ────────────────────────────────────────────────────────────────────

// Liveness probe — no auth
app.get('/health', (_req, res) => res.json({ ok: true }));

// Session check — frontend calls this on boot to decide whether to show the login screen
app.get('/api/auth', (req, res) => {
  res.json({ ok: !!req.session?.authed });
});

// Login — validates DASHBOARD_PASSWORD and creates a session
app.post('/api/login', (req, res) => {
  if (req.body.password === DASHBOARD_PASSWORD) {
    req.session.authed = true;
    return res.json({ ok: true });
  }
  // Short delay makes brute-force slightly harder
  setTimeout(() => res.status(401).json({ error: 'Wrong password' }), 400);
});

// Logout — destroys the session and clears the cookie
app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.clearCookie('connect.sid').json({ ok: true }));
});

// Read state
app.get('/api/state', auth, (_req, res) => {
  res.json(readState());
});

// Overwrite state (frontend calls this after every mutation)
app.post('/api/state', auth, (req, res) => {
  const s = req.body;
  if (!validateState(s)) return res.status(400).json({ error: 'Invalid state shape' });
  writeBackup(readState(), false);
  writeState(s);
  res.json({ ok: true });
});

// Archive: move done[] → history[today] and clear done[]
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

// List available backups (newest first)
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

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, '127.0.0.1', () => {
  console.log(`[${new Date().toISOString()}] OpenClaw API listening on 127.0.0.1:${PORT}`);
});
