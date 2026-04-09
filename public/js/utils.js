// ── Shared utilities ──────────────────────────────────────────────────────────

function esc(s) { return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
function nowTime() { return new Date().toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" }); }
function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function formatDay(str) {
  return new Date(str + "T12:00:00").toLocaleDateString(undefined, { weekday:"long", month:"long", day:"numeric", year:"numeric" });
}
function isMobile() { return window.innerWidth <= 640; }

function place(el, e) {
  el.style.left = (e.clientX + 10) + "px";
  el.style.top  = (e.clientY + 10) + "px";
  requestAnimationFrame(() => {
    const r = el.getBoundingClientRect();
    if (r.right  > window.innerWidth  - 10) el.style.left = (e.clientX - r.width  - 10) + "px";
    if (r.bottom > window.innerHeight - 10) el.style.top  = (e.clientY - r.height - 10) + "px";
  });
}
