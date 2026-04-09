// ── Login screen ──────────────────────────────────────────────────────────────
function showLogin(errorMsg = '') {
  const loading = document.getElementById("loading");
  loading.innerHTML = `
    <div class="loading-logo">Naoki's Logs</div>
    <form id="login-form" style="display:flex;flex-direction:column;align-items:center;gap:12px;margin-top:24px;">
      <input
        id="login-pwd"
        type="password"
        placeholder="Password"
        autocomplete="current-password"
        style="
          background: #1a1a1a;
          border: 1px solid #2a2a2a;
          border-radius: 6px;
          color: #e8e8e8;
          font-family: inherit;
          font-size: 13px;
          padding: 8px 14px;
          outline: none;
          width: 200px;
          text-align: center;
        "
      />
      <button type="submit" style="
        background: #222;
        border: 1px solid #333;
        border-radius: 6px;
        color: #e8e8e8;
        font-family: inherit;
        font-size: 12px;
        padding: 7px 20px;
        cursor: pointer;
        width: 200px;
      ">Enter</button>
      ${errorMsg ? `<div style="color:#e07070;font-size:11px;">${errorMsg}</div>` : ''}
    </form>`;

  document.getElementById('login-form').addEventListener('submit', async e => {
    e.preventDefault();
    const pwd = document.getElementById('login-pwd').value;
    try {
      await apiLogin(pwd);
      // Success — reload so boot() runs fresh with the new session cookie
      location.reload();
    } catch {
      showLogin('Wrong password.');
    }
  });

  // Auto-focus the password field
  setTimeout(() => document.getElementById('login-pwd')?.focus(), 50);
}

// ── Boot ──────────────────────────────────────────────────────────────────────
async function boot() {
  const loadingMsg = document.getElementById("loading-msg");
  const loading    = document.getElementById("loading");

  try {
    // Check session first — if not authed, show login screen
    loadingMsg.textContent = "Connecting…";
    const authCheck = await fetch(`${API_URL}/api/auth`, { credentials: 'include' });
    const { ok: authed } = await authCheck.json();

    if (!authed) {
      showLogin();
      return;
    }

    loadingMsg.textContent = "Loading state…";
    const saved = await apiGet("/api/state");
    Object.assign(state, saved, { tab: "quadrant", addingIn: null });

    // Restore last active tab from localStorage
    const savedTab = localStorage.getItem("oc-tab");
    if (savedTab && ["quadrant","calendar","heatmap","feed"].includes(savedTab)) {
      state.tab = savedTab;
      document.querySelectorAll(".tab-btn").forEach(b => {
        b.classList.toggle("active", b.dataset.tab === savedTab);
      });
    }

    // Restore last calendar sub-view
    const savedCalView = localStorage.getItem("oc-cal-view");
    if (savedCalView && ["week","month","list"].includes(savedCalView)) {
      calUI.view = savedCalView;
    }

    // Migration: init calendar for existing states
    if (!state.calendar)  state.calendar  = {};
    if (state.calNextId == null) state.calNextId = 1;

    loading.classList.add("gone");
    setTimeout(() => loading.remove(), 350);
    render();

  } catch (err) {
    // If we get a 401 during normal load, session expired — show login
    if (err.status === 401) {
      showLogin();
      return;
    }
    loadingMsg.textContent = "";
    document.getElementById("loading").insertAdjacentHTML("beforeend",
      `<div class="loading-error">Could not reach the API.<br><br>
       Check that the server is running.<br><br>
       <span style="color:var(--text-dim);font-size:11px">${err.message}</span></div>`);
  }
}

// ── Tab nav ───────────────────────────────────────────────────────────────────
document.getElementById("nav").addEventListener("click", e => {
  const btn = e.target.closest(".tab-btn");
  if (!btn) return;
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  state.tab = btn.dataset.tab;
  localStorage.setItem("oc-tab", state.tab);
  render();
});

// ── Global event listeners ────────────────────────────────────────────────────
document.addEventListener("click", () => { closeCtx(); closePopup(); closeTaskCtx(); });
document.addEventListener("keydown", e => {
  if (e.key === "Escape") { closeCtx(); closePopup(); closeCalModal(); closeTaskCtx(); }
  if ((e.metaKey||e.ctrlKey) && e.key==="z" && state.tab==="calendar" && !document.getElementById("cal-modal")) {
    e.preventDefault(); calUndoLast();
  }
  if (state.tab === "calendar" && !document.getElementById("cal-modal") && !e.target.closest("input, textarea, select")) {
    if (e.key === "ArrowLeft")  { e.preventDefault(); calNav(-1); }
    if (e.key === "ArrowRight") { e.preventDefault(); calNav(1); }
    if (e.key === "ArrowUp"   && calHoveredId) { e.preventDefault(); calArrowNudge(-1); }
    if (e.key === "ArrowDown" && calHoveredId) { e.preventDefault(); calArrowNudge(1); }
  }
});

// ── Main render ───────────────────────────────────────────────────────────────
function render() {
  if (typeof stopFeedPoll === 'function') stopFeedPoll();

  const main = document.getElementById("main");
  if (state.tab === "quadrant") {
    main.innerHTML = `
      <div class="quadrant-wrap">
        <div class="axis-x">WANT TO DO</div>
        <div class="middle-row">
          <div class="axis-y left">Counterproductive</div>
          <div class="grid">
            ${renderPanel("red")}${renderPanel("green")}${renderPanel("yellow")}${renderPanel("blue")}
          </div>
          <div class="axis-y right">Productive</div>
        </div>
        <div class="axis-x">DON'T WANT TO DO</div>
      </div>
      ${renderDone()}`;
    initDragDrop();
    if (state.addingIn) setTimeout(() => { const i = document.getElementById("task-input"); if (i) i.focus(); }, 20);
  } else if (state.tab === "heatmap") {
    main.innerHTML = renderHeatmap();
    setTimeout(() => {
      document.querySelectorAll(".heatmap-body").forEach(el => { el.scrollLeft = el.scrollWidth; });
    }, 50);
  } else if (state.tab === "calendar") {
    main.innerHTML = renderCalendar();
    setTimeout(() => {
      if (calUI.view === "week") { scrollCalToNow(); startCalTimeInterval(); }
      else if (calUI.view === "list") { initAgendaEvents(); }
    }, 0);
  } else if (state.tab === "feed") {
    main.innerHTML = renderFeed();
  } else {
    main.innerHTML = `<div class="placeholder">Unknown tab</div>`;
  }
}

// ── Long-press → context menu on touch screens ────────────────────────────────
(function initLongPress() {
  let _lpTimer = null;
  let _lpFired = false;

  document.addEventListener("touchstart", e => {
    clearTimeout(_lpTimer);
    _lpFired = false;
    const touch = e.touches[0];
    const x = touch.clientX, y = touch.clientY;
    const fakeEv = {
      clientX: x, clientY: y,
      preventDefault: () => {}, stopPropagation: () => {}
    };

    const taskEl = e.target.closest(".task-item[data-id]");
    if (taskEl) {
      const panel = taskEl.closest(".qpanel");
      const q = panel?.dataset.q;
      const id = parseInt(taskEl.dataset.id);
      if (q && id) {
        _lpTimer = setTimeout(() => {
          _lpFired = true;
          navigator.vibrate?.(30);
          showTaskCtx(fakeEv, q, id);
        }, 480);
      }
    }

    const doneEl = e.target.closest(".done-item");
    if (doneEl) {
      const list = doneEl.closest(".done-list");
      const i = list ? [...list.querySelectorAll(".done-item")].indexOf(doneEl) : -1;
      if (i >= 0) {
        _lpTimer = setTimeout(() => {
          _lpFired = true;
          navigator.vibrate?.(30);
          showCtxMenu(fakeEv, i);
        }, 480);
      }
    }
  }, { passive: true });

  document.addEventListener("touchend",  () => clearTimeout(_lpTimer), { passive: true });
  document.addEventListener("touchmove", () => clearTimeout(_lpTimer), { passive: true });
})();

// ── Go ────────────────────────────────────────────────────────────────────────
boot();
