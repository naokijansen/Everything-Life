// ── Config ───────────────────────────────────────────────────────────────────
const API_URL = "https://sankyunao.dev"; // ← your Cloudflare subdomain
// API_KEY is gone — auth uses a session cookie. The key never leaves the server.
// ─────────────────────────────────────────────────────────────────────────────

const Q_META = {
  red:    { label: "Temptations",     sub: "want to · counterproductive", color: "#e07070" },
  green:  { label: "The Work",        sub: "want to · productive",        color: "#60c484" },
  yellow: { label: "Procrastination", sub: "don't want · pointless",      color: "#d4b06a" },
  blue:   { label: "Obligations",     sub: "don't want · need to",        color: "#6aa8e0" },
};

const Q_HEAT_COLORS = {
  red: [
    null,
    "rgba(224,112,112,0.22)",
    "rgba(224,112,112,0.42)",
    "rgba(224,112,112,0.62)",
    "rgba(224,112,112,0.82)",
    "rgba(224,112,112,1.00)",
  ],
  green: [
    null,
    "rgba(96,196,132,0.22)",
    "rgba(96,196,132,0.42)",
    "rgba(96,196,132,0.62)",
    "rgba(96,196,132,0.82)",
    "rgba(96,196,132,1.00)",
  ],
  yellow: [
    null,
    "rgba(212,176,106,0.22)",
    "rgba(212,176,106,0.42)",
    "rgba(212,176,106,0.62)",
    "rgba(212,176,106,0.82)",
    "rgba(212,176,106,1.00)",
  ],
  blue: [
    null,
    "rgba(106,168,224,0.22)",
    "rgba(106,168,224,0.42)",
    "rgba(106,168,224,0.62)",
    "rgba(106,168,224,0.82)",
    "rgba(106,168,224,1.00)",
  ],
};

function heatColor(n, q) {
  const colors = Q_HEAT_COLORS[q];
  if (n === 0) return null;
  if (n === 1) return colors[1];
  if (n <= 3)  return colors[2];
  if (n <= 6)  return colors[3];
  if (n <= 10) return colors[4];
  return colors[5];
}

// ── State (populated from API on load) ───────────────────────────────────────
let state = {
  tasks: { red: [], green: [], yellow: [], blue: [] },
  done: [],
  history: {},
  calendar: {},
  tab: "quadrant",
  addingIn: null,
  nextId: 20,
  calNextId: 1,
};

let drag = { taskId: null, fromQ: null, insertBefore: null };
