// ── Context menu (Done panel right-click → move back) ────────────────────────
const ctxMenu = document.getElementById("ctx-menu");
let ctxIdx = null;

window.showCtxMenu = function(e, i) {
  e.preventDefault();
  ctxIdx = i;
  ctxMenu.innerHTML = `<div class="ctx-label">Move back to</div>` +
    Object.keys(Q_META).map(q => `
      <div class="ctx-item" data-q="${q}">
        <div class="ctx-dot" style="background:${Q_META[q].color}"></div>
        ${Q_META[q].label}
      </div>`).join("");
  place(ctxMenu, e);
  ctxMenu.classList.add("visible");
};

ctxMenu.addEventListener("click", e => {
  const item = e.target.closest(".ctx-item");
  if (!item || ctxIdx === null) return;
  const di = state.done[ctxIdx];
  state.done.splice(ctxIdx, 1);
  state.tasks[item.dataset.q].push({ id: di.id, text: di.text });
  closeCtx(); render(); saveState();
});

function closeCtx() { ctxMenu.classList.remove("visible"); ctxIdx = null; }

// ── Day popup ─────────────────────────────────────────────────────────────────
const popup = document.getElementById("day-popup");
window.openDayPopup = function(e, key, filterQ) {
  e.stopPropagation();
  const allTasks = state.history[key] || [];
  const tasks = filterQ ? allTasks.filter(t => t.q === filterQ) : allTasks;
  popup.innerHTML = `
    <div class="popup-header">
      <div class="popup-date">${formatDay(key)}</div>
      <button class="popup-close" onclick="closePopup()">×</button>
    </div>
    <div class="popup-count">${tasks.length} task${tasks.length !== 1 ? "s" : ""} completed</div>
    ${tasks.length
      ? tasks.map(t => `<div class="popup-task"><div class="popup-dot" style="background:${Q_META[t.q]?.color||"#888"}"></div><div class="popup-task-text">${esc(t.text)}</div></div>`).join("")
      : `<div class="popup-empty">Nothing logged.</div>`}`;
  place(popup, e);
  popup.classList.add("visible");
};
window.closePopup = function() { popup.classList.remove("visible"); };

// ── Task actions ──────────────────────────────────────────────────────────────
window.completeTask = function(q, id) {
  const task = state.tasks[q].find(t => t.id === id);
  if (!task) return;
  const el = document.querySelector(`[data-id="${id}"]`);
  if (el) { el.classList.add("completing"); setTimeout(finish, 230); }
  else finish();
  function finish() {
    state.tasks[q] = state.tasks[q].filter(t => t.id !== id);
    state.done.unshift({ ...task, q, time: nowTime() });
    render(); saveState();
  }
};

window.openAdd = function(q) {
  state.addingIn = state.addingIn === q ? null : q;
  render();
  if (state.addingIn) setTimeout(() => { const i = document.getElementById("task-input"); if (i) i.focus(); }, 30);
};
window.confirmAdd = function(q) {
  const inp = document.getElementById("task-input");
  const text = inp?.value.trim();
  if (text) state.tasks[q].push({ id: state.nextId++, text });
  state.addingIn = null; render(); saveState();
};
window.cancelAdd = function() { state.addingIn = null; render(); };

// Archive button in Done panel — also calls the API /archive endpoint
window.clearDone = async function() {
  if (!state.done.length) return;
  cancelPendingSave(); // prevent a pending debounced save from overwriting the archive
  try {
    const data = await apiPost("/api/archive", {});
    Object.assign(state, data.state);
    render();
  } catch (err) {
    console.error("Archive failed:", err);
    syncDot.className = "sync-dot error";
  }
};

// ── Drag & drop ───────────────────────────────────────────────────────────────
function initDragDrop() {
  const clearInsert = () =>
    document.querySelectorAll(".task-item").forEach(t => t.classList.remove("drag-insert-before"));

  document.querySelectorAll(".task-item[data-id]").forEach(el => {
    el.setAttribute("draggable", "true");
    el.addEventListener("dragstart", e => {
      drag.taskId = parseInt(el.dataset.id);
      drag.fromQ  = el.closest(".qpanel").dataset.q;
      drag.insertBefore = null;
      setTimeout(() => el.classList.add("dragging"), 0);
      e.dataTransfer.effectAllowed = "move";
    });
    el.addEventListener("dragend", () => {
      el.classList.remove("dragging");
      clearInsert();
      document.querySelectorAll(".qpanel").forEach(p => p.classList.remove("drag-over"));
    });
  });

  document.querySelectorAll(".qpanel").forEach(panel => {
    const q = panel.dataset.q;
    panel.addEventListener("dragover", e => {
      e.preventDefault();
      panel.classList.add("drag-over");
      // Track which task we're hovering over for insert position
      const taskEl = e.target.closest(".task-item[data-id]");
      clearInsert();
      if (taskEl && parseInt(taskEl.dataset.id) !== drag.taskId) {
        taskEl.classList.add("drag-insert-before");
        drag.insertBefore = parseInt(taskEl.dataset.id);
      } else if (!taskEl) {
        drag.insertBefore = null; // drop at end
      }
    });
    panel.addEventListener("dragleave", e => {
      if (!panel.contains(e.relatedTarget)) {
        panel.classList.remove("drag-over");
        clearInsert();
        drag.insertBefore = null;
      }
    });
    panel.addEventListener("drop", e => {
      e.preventDefault();
      panel.classList.remove("drag-over");
      clearInsert();
      if (!drag.taskId) return;

      const insertAt = (arr, task) => {
        if (drag.insertBefore != null) {
          const idx = arr.findIndex(t => t.id === drag.insertBefore);
          if (idx !== -1) { arr.splice(idx, 0, task); return; }
        }
        arr.push(task);
      };

      if (q === drag.fromQ) {
        // Reorder within same quadrant
        const tasks = state.tasks[q];
        const fi = tasks.findIndex(t => t.id === drag.taskId);
        if (fi === -1) { drag = { taskId:null, fromQ:null, insertBefore:null }; return; }
        const [task] = tasks.splice(fi, 1);
        insertAt(tasks, task);
      } else {
        // Move to different quadrant
        const fi = state.tasks[drag.fromQ].findIndex(t => t.id === drag.taskId);
        if (fi === -1) { drag = { taskId:null, fromQ:null, insertBefore:null }; return; }
        const [task] = state.tasks[drag.fromQ].splice(fi, 1);
        insertAt(state.tasks[q], task);
      }

      drag = { taskId: null, fromQ: null, insertBefore: null };
      render(); saveState();
    });
  });

  initTouchDragDrop();
}

function initTouchDragDrop() {
  document.querySelectorAll('.task-item[data-id]').forEach(el => {
    el.addEventListener('touchstart', e => {
      const panel = el.closest('.qpanel');
      const q = panel?.dataset.q;
      const id = parseInt(el.dataset.id);
      if (!q || !id) return;

      const touch = e.touches[0];
      const startX = touch.clientX, startY = touch.clientY;
      let armed = false, ghost = null, ghostInitTop = 0;
      let insertBeforeId = null, armTimer = null;

      const cleanup = () => {
        clearTimeout(armTimer);
        window._cancelTouchDrag = null;
        el.style.opacity = '';
        if (ghost) { ghost.remove(); ghost = null; }
        document.querySelectorAll('.task-item').forEach(i => i.classList.remove('drag-insert-before'));
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('touchend',  onEnd);
        document.removeEventListener('touchcancel', onEnd);
      };

      const onMove = ev => {
        const t = ev.touches[0];
        const dx = t.clientX - startX, dy = t.clientY - startY;
        if (!armed) {
          if (Math.abs(dx) > 8 || Math.abs(dy) > 8) cleanup();
          return;
        }
        // Create ghost on first move after arming
        if (!ghost) {
          const rect = el.getBoundingClientRect();
          ghost = el.cloneNode(true);
          ghost.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top}px;` +
            `width:${rect.width}px;opacity:0.85;pointer-events:none;z-index:9000;` +
            `transform:scale(1.03);box-shadow:0 4px 20px rgba(0,0,0,0.5);border-radius:7px;`;
          document.body.appendChild(ghost);
          ghostInitTop = rect.top;
          el.style.opacity = '0.25';
        }
        ev.preventDefault();
        ghost.style.top = (ghostInitTop + dy) + 'px';
        // Find insert position
        const items = [...panel.querySelectorAll('.task-item[data-id]')];
        items.forEach(i => i.classList.remove('drag-insert-before'));
        insertBeforeId = null;
        for (const item of items) {
          if (item === el) continue;
          const r = item.getBoundingClientRect();
          if (t.clientY < r.top + r.height / 2) {
            item.classList.add('drag-insert-before');
            insertBeforeId = parseInt(item.dataset.id);
            break;
          }
        }
      };

      const onEnd = () => {
        if (armed && ghost) {
          const tasks = state.tasks[q];
          const fi = tasks.findIndex(t => t.id === id);
          if (fi !== -1) {
            const [task] = tasks.splice(fi, 1);
            if (insertBeforeId != null) {
              const ti = tasks.findIndex(t => t.id === insertBeforeId);
              if (ti !== -1) tasks.splice(ti, 0, task);
              else tasks.push(task);
            } else {
              tasks.push(task);
            }
            render(); saveState();
          }
        }
        cleanup();
      };

      document.addEventListener('touchmove', onMove, { passive: false });
      document.addEventListener('touchend',  onEnd, { once: true });
      document.addEventListener('touchcancel', onEnd, { once: true });

      window._cancelTouchDrag = cleanup;

      armTimer = setTimeout(() => {
        armed = true;
        navigator.vibrate?.(15);
        el.style.opacity = '0.6';
      }, 150);

    }, { passive: true });
  });
}

// ── Renderers ─────────────────────────────────────────────────────────────────
function renderPanel(q) {
  const m = Q_META[q];
  const rows = state.tasks[q].map(t => `
    <div class="task-item" data-id="${t.id}" oncontextmenu="showTaskCtx(event,'${q}',${t.id})">
      <button class="task-check" onclick="completeTask('${q}',${t.id})"></button>
      <span class="task-text">${esc(t.text)}</span>
    </div>`).join("");
  const addRow = state.addingIn === q ? `
    <div class="add-row">
      <div class="add-ghost"></div>
      <input id="task-input" class="add-input" placeholder="New task…"
        onkeydown="if(event.key==='Enter')confirmAdd('${q}');if(event.key==='Escape')cancelAdd();" />
    </div>` : "";
  const empty = !state.tasks[q].length && state.addingIn !== q ? `<div class="task-empty">Empty</div>` : "";
  return `
    <div class="qpanel ${q}" data-q="${q}">
      <div class="qpanel-header">
        <div><div class="q-label">${m.label}</div><div class="q-sub">${m.sub}</div></div>
        <button class="q-add" onclick="openAdd('${q}')">+</button>
      </div>
      <div class="task-list">${rows}${addRow}${empty}</div>
    </div>`;
}

function renderDone() {
  const items = state.done.map((t, i) => `
    <div class="done-item" oncontextmenu="showCtxMenu(event,${i})">
      <div class="done-item-text">${esc(t.text)}</div>
      <div class="done-meta">
        <div class="done-dot" style="background:${Q_META[t.q].color}"></div>
        <div class="done-time">${t.time}</div>
      </div>
    </div>`).join("");
  return `
    <div class="done-stack">
      <div class="done-top">
        <div class="done-lbl">Done today</div>
        <div class="done-row">
          <div class="done-count">${state.done.length}</div>
          ${state.done.length ? `<button class="done-archive-btn" onclick="clearDone()">archive →</button>` : ""}
        </div>
      </div>
      <div class="done-list">
        ${state.done.length ? items : `<div class="done-empty">Nothing done yet.</div>`}
      </div>
    </div>`;
}

// ── Task context menu (quadrant right-click) ──────────────────────────────────
const taskCtxMenu = document.getElementById("task-ctx-menu");
let taskCtxState  = { q: null, id: null, text: null };

window.showTaskCtx = function(e, q, id) {
  e.preventDefault(); e.stopPropagation();
  closeCtx(); closePopup(); // close other menus
  const task = state.tasks[q].find(t => t.id === id);
  if (!task) return;
  taskCtxState = { q, id, text: task.text };
  const label = document.getElementById("task-ctx-label");
  label.textContent = task.text.length > 24 ? task.text.slice(0,24)+"…" : task.text;
  place(taskCtxMenu, e);
  taskCtxMenu.classList.add("visible");
};

function closeTaskCtx() {
  taskCtxMenu.classList.remove("visible");
  taskCtxState = { q: null, id: null, text: null };
}

document.getElementById("task-ctx-delete").addEventListener("click", e => {
  e.stopPropagation();
  const { q, id } = taskCtxState; if (!q) return;
  state.tasks[q] = state.tasks[q].filter(t => t.id !== id);
  closeTaskCtx(); render(); saveState();
});

document.getElementById("task-ctx-today").addEventListener("click", e => {
  e.stopPropagation();
  const { text } = taskCtxState; if (!text) return;
  const now = new Date();
  const sm  = now.getHours()*60 + Math.round(now.getMinutes()/15)*15;
  calAdd(todayKey(), { text, cat: "personal", start: minToTime(sm), end: minToTime(Math.min(sm+60, 24*60)) });
  closeTaskCtx();
  // Flash the sync dot to confirm
  syncDot.className = "sync-dot saved";
  setTimeout(() => { syncDot.className = "sync-dot"; }, 2000);
});

document.getElementById("task-ctx-pick").addEventListener("click", e => {
  e.stopPropagation();
  const { text } = taskCtxState; if (!text) return;
  const now = new Date();
  const sm  = now.getHours()*60 + Math.round(now.getMinutes()/15)*15;
  closeTaskCtx();
  openCalModal({ mode:"create", dateStr:todayKey(), startMin:sm, endMin:Math.min(sm+60,24*60), text, cat:"personal" });
});
