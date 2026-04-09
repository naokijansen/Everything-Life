/**
 * OpenClaw Dashboard — Backend API
 * Express server that persists dashboard state to state.json
 *
 * Endpoints:
 *   GET  /api/state          → read full state
 *   POST /api/state          → overwrite full state
 *   POST /api/archive        → archive done → history (called by cron)
 *   GET  /api/backups        → list available backup files
 *   GET  /health             → liveness check (no auth)
 *
 * Auth: every /api/* route requires header   x-api-key: <OPENCLAW_KEY>
 *
 * Backups:
 *   Written to ./backups/state-YYYY-MM-DD.json on every /api/archive call
 *   and once daily on the first /api/state POST of each day.
 *   Kept for BACKUP_RETAIN_DAYS (default 30). Older files are pruned automatically.
 */

const express = require('express');
const fs      = require('fs');
const path    = require('path');
const cors    = require('cors');

const app  = express();
const PORT = 3001;

// ── Config ──────────────────────────────────────────────────────────────────
const STATE_FILE       = path.join(__dirname, 'state.json');
const BACKUP_DIR       = path.join(__dirname, 'backups');
const BACKUP_RETAIN_DAYS = 30;
const API_KEY          = process.env.OPENCLAW_KEY;

if (!API_KEY) {
  console.error('ERROR: Set the OPENCLAW_KEY environment variable before starting.');
  process.exit(1);
}

// Ensure backup directory exists
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

// ── Default state (used only when state.json doesn't exist yet) ─────────────
const DEFAULT_STATE = {
  tasks: {
    red:    [],
    green:  [],
    yellow: [],
    blue:   [],
  },
  done:      [],
  history:   {},
  calendar:  {},
  nextId:    20,
  calNextId: 1,
};

// ── Helpers ──────────────────────────────────────────────────────────────────
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
    // calendar & calNextId are optional — added by migration in the frontend
  );
}

// ── Backup helpers ────────────────────────────────────────────────────────────
let lastBackupDay = null; // tracks which day we last wrote a daily backup

/**
 * Write a dated backup of state to ./backups/state-YYYY-MM-DD.json.
 * Only one backup per day is written (subsequent calls on the same day are
 * skipped unless force=true, e.g. on /api/archive where we always want a
 * snapshot before mutating).
 */
function writeBackup(s, force = false) {
  const day = todayKey();
  if (!force && lastBackupDay === day) return; // already backed up today

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

/** Delete backup files older than BACKUP_RETAIN_DAYS. */
function pruneBackups() {
  try {
    const cutoff = Date.now() - BACKUP_RETAIN_DAYS * 86_400_000;
    const files  = fs.readdirSync(BACKUP_DIR);
    for (const f of files) {
      if (!/^state-\d{4}-\d{2}-\d{2}\.json$/.test(f)) continue;
      const full = path.join(BACKUP_DIR, f);
      const { mtimeMs } = fs.statSync(full);
      if (mtimeMs < cutoff) {
        fs.unlinkSync(full);
        console.log(`[${new Date().toISOString()}] Pruned old backup: ${f}`);
      }
    }
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Prune FAILED: ${err.message}`);
  }
}

// ── Middleware ────────────────────────────────────────────────────────────────
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

// ── Routes ────────────────────────────────────────────────────────────────────

// Liveness — no auth, used by monitoring / Cloudflare health checks
app.get('/health', (_req, res) => res.json({ ok: true }));

// Read state
app.get('/api/state', auth, (req, res) => {
  res.json(readState());
});

// Overwrite state (frontend calls this after every mutation)
// Also writes a daily backup on the first save of each day.
app.post('/api/state', auth, (req, res) => {
  const s = req.body;
  if (!validateState(s)) {
    return res.status(400).json({ error: 'Invalid state shape' });
  }
  // Daily backup: snapshot the *current* state before overwriting
  writeBackup(readState(), false);
  writeState(s);
  res.json({ ok: true });
});

// Archive: move done[] → history[today] and clear done[]
// Called by: midnight cron  AND  the "archive →" button in the UI
// Always writes a forced backup first so archived data is never lost.
app.post('/api/archive', auth, (req, res) => {
  const s = readState();

  // Snapshot before any mutation — always forced so it captures the done[] tasks
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
app.get('/api/backups', auth, (req, res) => {
  try {
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => /^state-\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .sort()
      .reverse()
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
