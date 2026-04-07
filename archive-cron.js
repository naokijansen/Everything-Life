/**
 * OpenClaw — Midnight Archive Cron Script
 *
 * Reads state.json, moves state.done[] into state.history[today],
 * clears done[], and writes back.
 *
 * Invoked by system cron at midnight:
 *   0 0 * * * /usr/bin/node /home/ubuntu/openclaw/archive-cron.js >> /home/ubuntu/openclaw/archive.log 2>&1
 */

const fs   = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, 'state.json');

function todayKey() {
  // Runs at midnight, so "today" is the day that just ended
  // We deliberately use the date at script-run time (just past midnight = yesterday's tasks)
  const d = new Date();
  d.setDate(d.getDate() - 1); // yesterday
  return d.toISOString().slice(0, 10);
}

try {
  const raw = fs.readFileSync(STATE_FILE, 'utf8');
  const s   = JSON.parse(raw);

  if (!s.done || s.done.length === 0) {
    console.log(`[${new Date().toISOString()}] Nothing to archive — done[] is empty.`);
    process.exit(0);
  }

  const key = todayKey();
  if (!s.history[key]) s.history[key] = [];

  const archived = s.done.length;
  s.done.forEach(t => s.history[key].push({ text: t.text, q: t.q }));
  s.done = [];

  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2), 'utf8');

  console.log(`[${new Date().toISOString()}] Archived ${archived} task(s) → history["${key}"]`);
  process.exit(0);

} catch (err) {
  console.error(`[${new Date().toISOString()}] Archive FAILED: ${err.message}`);
  process.exit(1);
}
