// ── API helpers ───────────────────────────────────────────────────────────────
const syncDot = document.getElementById("sync-dot");

async function apiGet(path) {
  const r = await fetch(`${API_URL}${path}`, {
    headers: { "x-api-key": API_KEY }
  });
  if (!r.ok) throw new Error(`API ${r.status}`);
  return r.json();
}

async function apiPost(path, body) {
  const r = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "x-api-key": API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`API ${r.status}`);
  return r.json();
}

// Debounced save — fires 600 ms after last change
let saveTimer = null;

function saveState() {
  clearTimeout(saveTimer);
  syncDot.className = "sync-dot saving";
  saveTimer = setTimeout(async () => {
    try {
      // Strip UI-only fields before sending
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

// Used by clearDone() to cancel any pending save before archiving
function cancelPendingSave() {
  clearTimeout(saveTimer);
}
