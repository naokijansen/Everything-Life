// ── Login screen ──────────────────────────────────────────────────────────────
function showLoginScreen(onSuccess) {
  // Inject minimal styles for the login overlay
  const style = document.createElement('style');
  style.textContent = `
    #login-overlay {
      position: fixed; inset: 0; z-index: 9999;
      display: flex; align-items: center; justify-content: center;
      background: var(--bg, #111);
    }
    .login-box {
      display: flex; flex-direction: column; gap: 12px;
      padding: 36px 32px; border-radius: 10px;
      background: var(--panel, #1a1a1a);
      border: 1px solid var(--border, #333);
      min-width: 280px;
    }
    .login-box h2 {
      margin: 0 0 4px; font-size: 16px; font-weight: 600;
      color: var(--text, #eee); letter-spacing: 0.03em;
    }
    #login-pw {
      padding: 9px 12px; border-radius: 6px; font-size: 14px;
      border: 1px solid var(--border, #333);
      background: var(--input-bg, #222); color: var(--text, #eee);
      outline: none;
    }
    #login-pw:focus { border-color: var(--accent, #6aa8e0); }
    #login-btn {
      padding: 9px; border-radius: 6px; font-size: 14px;
      font-weight: 600; cursor: pointer; border: none;
      background: var(--accent, #6aa8e0); color: #111;
      transition: opacity 0.15s;
    }
    #login-btn:disabled { opacity: 0.5; cursor: default; }
    #login-err { margin: 0; font-size: 13px; color: var(--red, #e07070); }
  `;
  document.head.appendChild(style);

  const overlay = document.createElement('div');
  overlay.id = 'login-overlay';
  overlay.innerHTML = `
    <div class="login-box">
      <h2>Naoki's Logs</h2>
      <input type="password" id="login-pw" placeholder="Password"
             autocomplete="current-password" spellcheck="false" />
      <button id="login-btn">Enter</button>
      <p id="login-err" style="display:none">Wrong password — try again.</p>
    </div>
  `;
  document.body.appendChild(overlay);

  const pw  = document.getElementById('login-pw');
  const btn = document.getElementById('login-btn');
  const err = document.getElementById('login-err');

  async function attempt() {
    if (!pw.value.trim()) return;
    btn.disabled = true;
    err.style.display = 'none';
    try {
      await apiLogin(pw.value);
      overlay.remove();
      style.remove();
      onSuccess();
    } catch {
      err.style.display = 'block';
      pw.value = '';
      pw.focus();
    }
    btn.disabled = false;
  }

  btn.addEventListener('click', attempt);
  pw.addEventListener('keydown', e => { if (e.key === 'Enter') attempt(); });
  setTimeout(() => pw.focus(), 50);
}

// ── Boot ──────────────────────────────────────────────────────────────────────
async function boot() {
  const loadingMsg = document.getElementById('loading-msg');
  const loading    = document.getElementById('loading');

  try {
    // 1. Ask the server if there is already a valid session
    loadingMsg.textContent = 'Checking session…';
    const authRes  = await fetch(`${API_URL}/api/auth`, { credentials: 'include' });
    const authData = await authRes.json();

    if (!authData.ok) {
      // No session — show login overlay, then re-run boot() after success
      loading.classList.add('gone');
      showLoginScreen(() => {
        loading.classList.remove('gone');
        loading.style.opacity = '';
        loadingMsg.textContent = '';
        boot();
      });
      return;
    }

    // 2. Session valid — load state
    loadingMsg.textContent = 'Loading state…';
    const saved = await apiGet('/api/state');
    Object.assign(state, saved, { tab: 'quadrant', addingIn: null });

    // Restore last active tab from localStorage
    const savedTab = localStorage.getItem('oc-tab');
    if (savedTab && ['quadrant', 'calendar', 'heatmap'].includes(savedTab)) {
      state.tab = savedTab;
      document.querySelectorAll('.tab-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.tab === savedTab);
      });
    }

    // Restore last calendar sub-view
    const savedCalView = localStorage.getItem('oc-cal-view');
    if (savedCalView && ['week', 'month', 'list'].includes(savedCalView)) {
      calUI.view = savedCalView;
    }

    // Migration: init calendar for existing states that don't have it
    if (!state.calendar)       state.calendar  = {};
    if (state.calNextId == null) state.calNextId = 1;

    loading.classList.add('gone');
    setTimeout(() => loading.remove(), 350);
    render();

  } catch (err) {
    loadingMsg.textContent = '';
    document.getElementById('loading').insertAdjacentHTML('beforeend',
      `<div class="loading-error">Could not reach the server.<br><br>
       Check that the server is running and that SESSION_SECRET / DASHBOARD_PASSWORD
       are set in the environment.<br><br>
       <span style="color:var(--text-dim);font-size:11px">${err.message}</span></div>`);
  }
}

// ── Tab nav ───────────────────────────────────────────────────────────────────
document.getElementById('nav').addEventListener('click', e => {
  const btn = e.target.closest('.tab-btn');
  if (!btn) return;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  state.tab = btn.dataset.tab;
  localStorage.setItem('oc-tab', state.tab);
  render();
});

// ── Global event listeners ────────────────────────────────────────────────────
document.addEventListener('click', () => { closeCtx(); closePopup(); closeTaskCtx(); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeCtx(); closePopup(); closeCalModal(); closeTaskCtx(); }
  if ((e.metaKey || e.ctrlKey) && e.key === 'z' && state.tab === 'calendar' && !document.getElementById('cal-modal')) {
    e.preventDefault(); calUndoLast();
  }
  if (state.tab === 'calendar' && !document.getElementById('cal-modal') && !e.target.closest('input, textarea, select')) {
    if (e.key === 'ArrowLeft')  { e.preventDefault(); calNav(-1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); calNav(1); }
    if (e.key === 'ArrowUp'    && calHoveredId) { e.preventDefault(); calArrowNudge(-1); }
    if (e.key === 'ArrowDown'  && calHoveredId) { e.preventDefault(); calArrowNudge(1); }
  }
});

// ── Main render ───────────────────────────────────────────────────────────────
function render() {
  const main = document.getElementById('main');
  if (state.tab === 'quadrant') {
    main.innerHTML = `
      <div class="quadrant-wrap">
        <div class="axis-x">WANT TO DO</div>
        <div class="middle-row">
          <div class="axis-y left">Counterproductive</div>
          <div class="grid">
            ${renderPanel('red')}${renderPanel('green')}${renderPanel('yellow')}${renderPanel('blue')}
          </div>
          <div class="axis-y right">Productive</div>
        </div>
        <div class="axis-x">DON'T WANT TO DO</div>
      </div>
      ${renderDone()}`;
    initDragDrop();
    if (state.addingIn) setTimeout(() => { const i = document.getElementById('task-input'); if (i) i.focus(); }, 20);
  } else if (state.tab === 'heatmap') {
    main.innerHTML = renderHeatmap();
    setTimeout(() => {
      document.querySelectorAll('.heatmap-body').forEach(el => { el.scrollLeft = el.scrollWidth; });
    }, 50);
  } else if (state.tab === 'calendar') {
    main.innerHTML = renderCalendar();
    setTimeout(() => {
      if (calUI.view === 'week') { scrollCalToNow(); startCalTimeInterval(); }
      else if (calUI.view === 'list') { initAgendaEvents(); }
    }, 0);
  } else {
    main.innerHTML = `<div class="placeholder">Unknown tab</div>`;
  }
}

// ── Long-press → context menu on touch screens ────────────────────────────────
(function initLongPress() {
  let _lpTimer = null;
  let _lpFired = false;

  document.addEventListener('touchstart', e => {
    clearTimeout(_lpTimer);
    _lpFired = false;
    const touch = e.touches[0];
    const x = touch.clientX, y = touch.clientY;
    const fakeEv = { clientX: x, clientY: y, preventDefault: () => {}, stopPropagation: () => {} };

    const taskEl = e.target.closest('.task-item[data-id]');
    if (taskEl) {
      const panel = taskEl.closest('.qpanel');
      const q  = panel?.dataset.q;
      const id = parseInt(taskEl.dataset.id);
      if (q && id) {
        _lpTimer = setTimeout(() => {
          _lpFired = true;
          window._cancelTouchDrag?.(); // cancel armed touch drag before showing popup
          navigator.vibrate?.(30);
          showTaskCtx(fakeEv, q, id);
        }, 480);
      }
    }

    const doneEl = e.target.closest('.done-item');
    if (doneEl) {
      const list = doneEl.closest('.done-list');
      const i = list ? [...list.querySelectorAll('.done-item')].indexOf(doneEl) : -1;
      if (i >= 0) {
        _lpTimer = setTimeout(() => {
          _lpFired = true;
          navigator.vibrate?.(30);
          showCtxMenu(fakeEv, i);
        }, 480);
      }
    }
  }, { passive: true });

  document.addEventListener('touchend',  () => clearTimeout(_lpTimer), { passive: true });
  document.addEventListener('touchmove', () => clearTimeout(_lpTimer), { passive: true });
})();

// ── Go ────────────────────────────────────────────────────────────────────────
boot();
