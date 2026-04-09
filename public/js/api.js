// ── API helpers ───────────────────────────────────────────────────────────────
// Auth is handled by the session cookie — the browser sends it automatically.
// No API key is ever present in this file or sent over the network.
const syncDot = document.getElementById("sync-dot");

async function apiGet(path) {
  const r = await fetch(`${API_URL}${path}`, {
    credentials: 'include',
  });
  if (!r.ok) throw Object.assign(new Error(`API ${r.status}`), { status: r.status });
  return r.json();
}

async function apiPost(path, body) {
  const r = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw Object.assign(new Error(`API ${r.status}`), { status: r.status });
  return r.json();
}

// Called by the login screen
async function apiLogin(password) {
  const r = await fetch(`${API_URL}/api/login`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  if (!r.ok) throw new Error('Wrong password');
  return r.json();
}

// Debounced save — fires 600 ms after last change
let saveTimer = null;

function saveState() {
  clearTimeout(saveTimer);
  syncDot.className = "sync-dot saving";
  saveTimer = setTimeout(async () => {
    try {
      const { tab, addingIn, ...persistable } = state;
      await apiPost("/api/state", persistable);
      syncDot.className = "sync-dot saved";
      setTimeout(() => { syncDot.className = "sync-dot"; }, 2000);
    } catch (err) {
      console.error("Save failed:", err);
      syncDot.className = "sync-dot error";
    }
  }, 600);
}

function cancelPendingSave() {
  clearTimeout(saveTimer);
}
