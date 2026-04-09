// ── Calendar ──────────────────────────────────────────────────────────────────
// ── Calendar ──────────────────────────────────────────────────────────────────

const CAL_CATS = {
  class:    { label: "Class",            color: "#6aa8e0" }, // sky blue
  birthday: { label: "Birthday",         color: "#d06090" }, // rose pink
  personal: { label: "Personal",         color: "#d4b06a" }, // amber
  work:     { label: "Work",             color: "#60c484" }, // green
  study:    { label: "Study",            color: "#e07070" }, // red
  hobby:    { label: "Hobby",            color: "#e09a55" }, // orange
  chore:    { label: "Chore",            color: "#7860b8" }, // violet
  holiday:  { label: "National Holiday", color: "#2ec4b6" }, // teal
};
const CAL_CAT_FALLBACK = { label: "Other", color: "#6a6a8a" };

const HOUR_PX      = 44;   // Google/Apple use ~48px — keeps full day visible without endless scroll
const PX_PER_MIN   = HOUR_PX / 60;
const DAY_SHORT    = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
const MONTH_SHORT  = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const MONTH_LONG   = ["January","February","March","April","May","June","July","August","September","October","November","December"];

let calUI = { weekOffset: 0, monthOffset: 0, view: "week" };
let calDrag       = null;
let calBlockNextClick = false;
let calTimeInterval   = null;
let calHoveredId  = null;
let calArrowTimer = null;

// ── Calendar helpers ──────────────────────────────────────────────────────────
function getWeekDates(offset) {
  const now = new Date(); const day = now.getDay();
  const mon = new Date(now);
  mon.setDate(now.getDate() - (day === 0 ? 6 : day - 1) + offset * 7);
  mon.setHours(0,0,0,0);
  return Array.from({length:7}, (_,i) => { const d = new Date(mon); d.setDate(mon.getDate()+i); return d; });
}
function getVisibleDates() {
  return getWeekDates(calUI.weekOffset); // always 7 days — mobile scrolls horizontally
}
function dKey(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
function minToTime(m) { return `${String(Math.floor(m/60)%24).padStart(2,"0")}:${String(m%60).padStart(2,"0")}`; }
function timeToMin(t) { const [h,m]=t.split(":").map(Number); return h*60+m; }
function nextCalId() { return state.calNextId++; }

// ── Calendar CRUD + undo history ──────────────────────────────────────────────
const CAL_HIST = []; // undo stack, max 30 entries
function calPush(action) { CAL_HIST.push(action); if (CAL_HIST.length>30) CAL_HIST.shift(); }

function calAdd(dateStr, ev, silent=false) {
  if (!state.calendar[dateStr]) state.calendar[dateStr] = [];
  ev.id = nextCalId(); state.calendar[dateStr].push(ev);
  if (!silent) { calPush({ type:'add', dateStr, id:ev.id }); saveState(); }
}
function calUpdate(dateStr, id, changes, silent=false) {
  const arr = state.calendar[dateStr]; if (!arr) return;
  const ev = arr.find(e=>e.id===id); if (!ev) return;
  if (!silent) calPush({ type:'update', dateStr, id, prev:{...ev} });
  Object.assign(ev, changes);
  if (!silent) saveState();
}
function calMove(fromDate, id, toDate, startMin, endMin, silent=false) {
  const arr = state.calendar[fromDate]; if (!arr) return;
  const i = arr.findIndex(e=>e.id===id); if (i===-1) return;
  const ev = arr[i];
  if (!silent) calPush({ type:'move', fromDate, toDate, id, prevStart:ev.start, prevEnd:ev.end });
  ev.start = minToTime(startMin); ev.end = minToTime(endMin);
  if (fromDate !== toDate) {
    arr.splice(i, 1);
    if (!arr.length) delete state.calendar[fromDate];
    if (!state.calendar[toDate]) state.calendar[toDate] = [];
    state.calendar[toDate].push(ev);
  }
  if (!silent) saveState();
}
function calDelete(dateStr, id, silent=false) {
  const arr = state.calendar[dateStr]; if (!arr) return;
  const i = arr.findIndex(e=>e.id===id); if (i===-1) return;
  if (!silent) calPush({ type:'delete', dateStr, ev:{...arr[i]} });
  arr.splice(i,1); if (!arr.length) delete state.calendar[dateStr];
  if (!silent) saveState();
}

function calUndoLast() {
  const action = CAL_HIST.pop(); if (!action) return;
  switch (action.type) {
    case 'add':
      calDelete(action.dateStr, action.id, true); break;
    case 'import':
      for (const {dateStr,id} of action.added) calDelete(dateStr, id, true); break;
    case 'update':
      calUpdate(action.dateStr, action.id, action.prev, true); break;
    case 'move':
      calMove(action.toDate, action.id, action.fromDate,
        timeToMin(action.prevStart), timeToMin(action.prevEnd), true); break;
    case 'delete': {
      const ev = {...action.ev};
      const dk = action.dateStr;
      if (!state.calendar[dk]) state.calendar[dk] = [];
      state.calendar[dk].push(ev); // restore with original id
      break;
    }
  }
  saveState(); refreshCalContent();
}

// ── Modal ─────────────────────────────────────────────────────────────────────
let _calModal = null;

function openCalModal(opts) {
  _calModal = opts;
  document.getElementById("cal-modal")?.remove();
  document.getElementById("cal-modal-overlay")?.remove();
  const catOpts = Object.keys(CAL_CATS).map(k =>
    `<option value="${k}"${opts.cat===k?" selected":""}>${CAL_CATS[k].label}</option>`).join("");
  const isEdit  = opts.mode === "edit";
  const allDay  = !!opts.allDay;
  const timeRowStyle = allDay ? `style="display:none"` : "";
  const html = `
    <div id="cal-modal-overlay" onclick="closeCalModal()"></div>
    <div id="cal-modal">
      <div class="cal-modal-header">
        <div class="cal-modal-title">${isEdit?"Edit event":"New event"}</div>
        <button class="cal-modal-close" onclick="closeCalModal()">×</button>
      </div>
      <input id="cm-text" class="cal-modal-input" placeholder="Event name…" value="${esc(opts.text||"")}"
        onkeydown="if(event.key==='Enter')submitCalModal();if(event.key==='Escape')closeCalModal();" />
      <label class="cal-allday-toggle">
        <input type="checkbox" id="cm-allday" ${allDay?"checked":""} onchange="calToggleAllDay(this.checked)">
        <span>All day</span>
      </label>
      <div class="cal-modal-row" id="cm-time-row" ${timeRowStyle}>
        <div class="cal-modal-field" style="flex:1.3">
          <label class="cal-modal-label">Date</label>
          <input id="cm-date" class="cal-modal-input-sm" type="date" value="${opts.dateStr}" />
        </div>
        <div class="cal-modal-field">
          <label class="cal-modal-label">From</label>
          <input id="cm-start" class="cal-modal-input-sm" type="time" value="${minToTime(opts.startMin||540)}" />
        </div>
        <div class="cal-modal-field">
          <label class="cal-modal-label">To</label>
          <input id="cm-end" class="cal-modal-input-sm" type="time" value="${minToTime(opts.endMin||600)}" />
        </div>
      </div>
      <div class="cal-modal-row" id="cm-allday-date-row" ${!allDay?`style="display:none"`:""}>
        <div class="cal-modal-field" style="flex:1">
          <label class="cal-modal-label">Date</label>
          <input id="cm-allday-date" class="cal-modal-input-sm" type="date" value="${opts.dateStr}" />
        </div>
      </div>
      <div class="cal-modal-row">
        <div class="cal-modal-field" style="flex:1">
          <label class="cal-modal-label">Category</label>
          <select id="cm-cat" class="cal-modal-input-sm">${catOpts}</select>
        </div>
      </div>
      <div class="cal-modal-actions">
        ${isEdit?`<button class="cal-modal-delete" onclick="calDeleteClose('${opts.dateStr}',${opts.id})">Delete</button>`:`<div></div>`}
        <div style="display:flex;gap:8px">
          <button class="cal-modal-cancel" onclick="closeCalModal()">Cancel</button>
          <button class="cal-modal-save"   onclick="submitCalModal()">Save</button>
        </div>
      </div>
    </div>`;
  document.body.insertAdjacentHTML("beforeend", html);
  document.getElementById("cm-text")?.focus();
}

window.calToggleAllDay = function(checked) {
  document.getElementById("cm-time-row").style.display = checked ? "none" : "";
  document.getElementById("cm-allday-date-row").style.display = checked ? "" : "none";
};

function closeCalModal() {
  _calModal = null;
  document.getElementById("cal-modal")?.remove();
  document.getElementById("cal-modal-overlay")?.remove();
}

window.calDeleteClose = function(dateStr, id) {
  calDelete(dateStr, id); closeCalModal(); refreshCalContent();
};

window.submitCalModal = function() {
  const text    = document.getElementById("cm-text")?.value.trim();
  const cat     = document.getElementById("cm-cat")?.value || "personal";
  const allDay  = document.getElementById("cm-allday")?.checked || false;
  if (!text) return;
  const dateStr = allDay
    ? document.getElementById("cm-allday-date")?.value
    : document.getElementById("cm-date")?.value;
  if (!dateStr) return;
  const d = _calModal;
  if (allDay) {
    const evData = { text, cat, allDay: true };
    if (d.mode === "edit") {
      if (dateStr !== d.dateStr) {
        // Move to new date
        calDelete(d.dateStr, d.id);
        calAdd(dateStr, evData);
      } else {
        calUpdate(dateStr, d.id, evData);
      }
    } else {
      calAdd(dateStr, evData);
    }
  } else {
    const startMin = timeToMin(document.getElementById("cm-start")?.value || "09:00");
    let   endMin   = timeToMin(document.getElementById("cm-end")?.value   || "10:00");
    if (endMin <= startMin) endMin = startMin + 30;
    if (d.mode === "edit") {
      if (dateStr !== d.dateStr) {
        calMove(d.dateStr, d.id, dateStr, startMin, endMin);
      } else {
        calUpdate(dateStr, d.id, { text, cat, allDay: false, start: minToTime(startMin), end: minToTime(endMin) });
      }
    } else {
      calAdd(dateStr, { text, cat, allDay: false, start: minToTime(startMin), end: minToTime(endMin) });
    }
  }
  closeCalModal(); refreshCalContent();
};

// ── Event overlap layout ──────────────────────────────────────────────────────
function layoutDayEvents(events) {
  const timed = events.filter(ev => !ev.allDay);
  if (!timed.length) return [];
  const sorted = timed.slice().sort((a,b) => timeToMin(a.start) - timeToMin(b.start));
  const trackEnds = [];
  const assigned  = sorted.map(ev => {
    const sm = timeToMin(ev.start), em = timeToMin(ev.end);
    let col = trackEnds.findIndex(end => end <= sm);
    if (col === -1) { col = trackEnds.length; }
    trackEnds[col] = em;
    return { ev, col };
  });
  return assigned.map(({ ev, col }) => {
    const sm = timeToMin(ev.start), em = timeToMin(ev.end);
    const concurrent = assigned.filter(({ ev: o }) => {
      const os = timeToMin(o.start), oe = timeToMin(o.end);
      return os < em && oe > sm;
    });
    const totalCols = Math.max(...concurrent.map(c => c.col)) + 1;
    return { ev, col, totalCols };
  });
}

// ── Week view ─────────────────────────────────────────────────────────────────
function renderCalEventBlock(ev, dateStr, col=0, totalCols=1) {
  const sm    = timeToMin(ev.start), em = timeToMin(ev.end);
  const top   = sm * PX_PER_MIN;
  const height= Math.max((em-sm)*PX_PER_MIN, 22);
  const cat   = CAL_CATS[ev.cat] || CAL_CAT_FALLBACK;
  const short = height < 38;
  const GAP   = 2;
  const posStyle = totalCols === 1
    ? `left:3px;right:3px`
    : `left:calc(${col/totalCols*100}% + ${GAP}px);width:calc(${100/totalCols}% - ${GAP*2}px)`;
  return `<div class="cal-event"
    style="top:${top}px;height:${height}px;${posStyle};background:${cat.color}22;border-left:2.5px solid ${cat.color}"
    data-id="${ev.id}" data-date="${dateStr}"
    onmouseenter="calHoveredId={dateStr:'${dateStr}',id:${ev.id}}"
    onmouseleave="calHoveredId=null"
    onclick="if(!calBlockNextClick){event.stopPropagation();calEditModal('${dateStr}',${ev.id});}"
    onpointerdown="calDragStart(event,this,'${dateStr}',${ev.id})">
    <div class="cal-event-inner">
      <span class="cal-event-name">${esc(ev.text)}</span>
      ${!short?`<span class="cal-event-time" id="cal-ev-time-${ev.id}">${ev.start}–${ev.end}</span>`:""}
    </div>
    <div class="cal-event-resize" onclick="event.stopPropagation()"
         onpointerdown="calResizeStart(event,'${dateStr}',${ev.id})"></div>
  </div>`;
}

function renderCalWeek() {
  const days     = getVisibleDates();
  const todayStr = todayKey();
  const now      = new Date();
  const nowMin   = now.getHours()*60 + now.getMinutes();
  const isThisView = days.some(d => dKey(d) === todayStr);

  const dayHeaders = days.map((d) => {
    const key = dKey(d); const isToday = key===todayStr;
    const dow = (d.getDay()+6)%7; // 0=Mon
    return `<div class="cal-day-head${isToday?" cal-today-head":""}">
      <span class="cal-day-name">${DAY_SHORT[dow]}</span>
      <span class="cal-day-num">${d.getDate()}</span>
    </div>`;
  }).join("");

  // All-day strip (sticky, above scrollable area)
  const allDayCells = days.map(d => {
    const key  = dKey(d);
    const evs  = (state.calendar[key]||[]).filter(ev=>ev.allDay);
    const pills = evs.map(ev => {
      const cat = CAL_CATS[ev.cat] || CAL_CAT_FALLBACK;
      return `<div class="cal-allday-event"
        style="background:${cat.color}33;border-left:2.5px solid ${cat.color}"
        onclick="event.stopPropagation();calEditModal('${key}',${ev.id})">${esc(ev.text)}</div>`;
    }).join("");
    // Archived tasks chip — reads from state.history (not duplicated in calendar)
    const archived = state.history[key] || [];
    const archiveChip = archived.length ? (() => {
      const counts = {}; archived.forEach(t => { counts[t.q] = (counts[t.q]||0)+1; });
      const topQ = Object.keys(counts).sort((a,b)=>counts[b]-counts[a])[0];
      const col = Q_META[topQ]?.color || "#888";
      return `<div class="cal-allday-archived" onclick="event.stopPropagation();openDayPopup(event,'${key}',null)"
        style="border-left:2.5px solid ${col};background:${col}1a;color:${col}">✓ ${archived.length} done</div>`;
    })() : "";
    return `<div class="cal-allday-cell">${pills}${archiveChip}</div>`;
  }).join("");

  const timeLabels = Array.from({length:24},(_,h) =>
    `<div class="cal-time-label" style="top:${h*HOUR_PX}px">${String(h).padStart(2,"0")}:00</div>`
  ).join("");

  const dayCols = days.map(d => {
    const key      = dKey(d); const isToday = key===todayStr;
    const allEvs   = state.calendar[key] || [];
    const layout   = layoutDayEvents(allEvs);
    const hourLines = Array.from({length:24},(_,h) => `
      <div class="cal-hour-line" style="top:${h*HOUR_PX}px"></div>
      <div class="cal-half-line" style="top:${h*HOUR_PX+HOUR_PX/2}px"></div>`).join("");
    const evBlocks = layout.map(({ev,col,totalCols}) =>
      renderCalEventBlock(ev, key, col, totalCols)).join("");
    return `<div class="cal-day-col${isToday?" cal-today-col":""}" data-date="${key}"
               onclick="calSlotClick(event,'${key}')">
      ${hourLines}${evBlocks}
    </div>`;
  }).join("");

  const nowLine = isThisView
    ? `<div class="cal-now-overlay" id="cal-now-line" style="top:${nowMin*PX_PER_MIN}px"></div>`
    : "";

  return `
    <div class="cal-week-container">
      <div class="cal-week-scroll" id="cal-week-scroll">
        <div class="cal-week-inner">
          <div class="cal-week-sticky">
            <div class="cal-week-header">
              <div class="cal-gutter-head"></div>
              ${dayHeaders}
            </div>
            <div class="cal-allday-strip">
              <div class="cal-allday-gutter"><span class="cal-allday-gutter-lbl">all day</span></div>
              ${allDayCells}
            </div>
          </div>
          <div class="cal-week-grid" style="height:${24*HOUR_PX}px" id="cal-week-grid">
            <div class="cal-time-gutter">${timeLabels}</div>
            ${dayCols}
            ${nowLine}
          </div>
        </div>
      </div>
    </div>`;
}

// ── Month view ────────────────────────────────────────────────────────────────
function renderCalMonth() {
  const now   = new Date();
  const anchor= new Date(now.getFullYear(), now.getMonth()+calUI.monthOffset, 1);
  const year  = anchor.getFullYear(), month = anchor.getMonth();
  const todayStr = todayKey();
  const firstDow = (new Date(year,month,1).getDay()+6)%7; // Mon=0
  const daysInMonth = new Date(year,month+1,0).getDate();

  const cells = [];
  for (let i=0; i<firstDow; i++) {
    const d = new Date(year,month,1-(firstDow-i));
    cells.push({d, out:true});
  }
  for (let i=1; i<=daysInMonth; i++) cells.push({d:new Date(year,month,i), out:false});
  const rem = (7-(cells.length%7))%7;
  for (let i=1; i<=rem; i++) cells.push({d:new Date(year,month+1,i), out:true});

  const rows = [];
  for (let r=0; r<cells.length; r+=7) {
    const week = cells.slice(r,r+7);
    const rowHtml = week.map(({d,out}) => {
      const key = dKey(d); const isToday = key===todayStr;
      const evs = [...(state.calendar[key]||[])].sort((a,b)=>{
        if (a.allDay && !b.allDay) return -1;
        if (!a.allDay && b.allDay) return 1;
        return (a.start||"").localeCompare(b.start||"");
      });
      const visible = evs.slice(0,3);
      const extra   = evs.length-3;
      const evHtml  = visible.map(ev => {
        const cat = CAL_CATS[ev.cat]||CAL_CAT_FALLBACK;
        return `<div class="cal-month-event"
          style="background:${cat.color}22;border-left:2.5px solid ${cat.color}"
          onclick="event.stopPropagation();calEditModal('${key}',${ev.id})">${esc(ev.text)}</div>`;
      }).join("") + (extra>0?`<div class="cal-month-more">+${extra} more</div>`:"");
      return `<div class="cal-month-cell${out?" cal-month-out":""}${isToday?" cal-month-today":""}"
                onclick="calMonthDayClick('${key}')">
        <div class="cal-month-day-num">${d.getDate()}</div>
        ${evHtml}
      </div>`;
    }).join("");
    rows.push(`<div class="cal-month-row">${rowHtml}</div>`);
  }

  return `
    <div class="cal-month-view">
      <div class="cal-month-weekdays">${DAY_SHORT.map(n=>`<div class="cal-month-weekday">${n}</div>`).join("")}</div>
      <div class="cal-month-grid">${rows.join("")}</div>
    </div>`;
}

// ── Calendar top-level renderer ───────────────────────────────────────────────
function getCalHeading() {
  if (calUI.view === "list") return "Upcoming Events";
  if (calUI.view === "week") {
    const days = getVisibleDates();
    const d0 = days[0], d1 = days[days.length-1];
    if (d0.getMonth()===d1.getMonth())
      return `${MONTH_SHORT[d0.getMonth()]} ${d0.getDate()}–${d1.getDate()}, ${d0.getFullYear()}`;
    if (d0.getFullYear()===d1.getFullYear())
      return `${MONTH_SHORT[d0.getMonth()]} ${d0.getDate()} – ${MONTH_SHORT[d1.getMonth()]} ${d1.getDate()}, ${d0.getFullYear()}`;
    return `${MONTH_SHORT[d0.getMonth()]} ${d0.getDate()}, ${d0.getFullYear()} – ${MONTH_SHORT[d1.getMonth()]} ${d1.getDate()}, ${d1.getFullYear()}`;
  }
  const now   = new Date();
  const anchor= new Date(now.getFullYear(), now.getMonth()+calUI.monthOffset, 1);
  return `${MONTH_LONG[anchor.getMonth()]} ${anchor.getFullYear()}`;
}

function renderCalendar() {
  return `
    <div class="cal-wrap">
      <input type="file" id="ical-file-input" accept=".ics" style="display:none" onchange="handleIcalFile(event)" />
      <div class="cal-toolbar">
        <div class="cal-nav-group">
          <button class="cal-nav-btn" onclick="calNav(-1)">‹</button>
          <button class="cal-today-btn" onclick="calNav(0)">Today</button>
          <button class="cal-nav-btn" onclick="calNav(1)">›</button>
          <span class="cal-heading">${getCalHeading()}</span>
        </div>
        <div class="cal-view-group">
          <button class="cal-import-btn" onclick="document.getElementById('ical-file-input').click()">↑ Import .ics</button>
          <div class="cal-view-toggle">
            <button class="cal-view-btn${calUI.view==="week"?" active":""}" onclick="calSetView('week')">Week</button>
            <button class="cal-view-btn${calUI.view==="month"?" active":""}" onclick="calSetView('month')">Month</button>
            <button class="cal-view-btn${calUI.view==="list"?" active":""}" onclick="calSetView('list')">List</button>
          </div>
          <button class="cal-add-btn" onclick="calOpenNew()">+ Add</button>
        </div>
      </div>
      <div id="cal-content">
        ${calUI.view==="week" ? renderCalWeek() : calUI.view==="month" ? renderCalMonth() : renderCalAgenda()}
      </div>
    </div>`;
}

function refreshCalContent() {
  const el = document.getElementById("cal-content");
  if (!el) return;
  if (calUI.view==="week") { el.innerHTML = renderCalWeek(); scrollCalToNow(); startCalTimeInterval(); }
  else if (calUI.view==="month") { el.innerHTML = renderCalMonth(); }
  else { el.innerHTML = renderCalAgenda(); initAgendaEvents(); }
}

// ── Calendar interactions ─────────────────────────────────────────────────────
window.calNav = function(dir) {
  if (calUI.view === "list") return; // list view has no pagination
  if (dir===0) { calUI.weekOffset=0; calUI.monthOffset=0; }
  else if (calUI.view==="week") calUI.weekOffset += dir;
  else calUI.monthOffset += dir;
  render();
};
window.calSetView = function(v) { calUI.view=v; localStorage.setItem("oc-cal-view", v); render(); };
window.calOpenNew = function() {
  const now=new Date(); const sm=now.getHours()*60+Math.round(now.getMinutes()/15)*15;
  openCalModal({mode:"create", dateStr:todayKey(), startMin:sm, endMin:sm+60, text:"", cat:"personal"});
};
window.calEditModal = function(dateStr, id) {
  const ev=(state.calendar[dateStr]||[]).find(e=>e.id===id); if (!ev) return;
  if (ev.allDay) {
    openCalModal({mode:"edit", dateStr, id, allDay:true, startMin:540, endMin:600, text:ev.text, cat:ev.cat});
  } else {
    openCalModal({mode:"edit", dateStr, id, allDay:false, startMin:timeToMin(ev.start), endMin:timeToMin(ev.end), text:ev.text, cat:ev.cat});
  }
};
window.calSlotClick = function(e, dateStr) {
  if (calBlockNextClick) return;
  const grid  = document.getElementById("cal-week-grid");
  const scroll = document.getElementById("cal-week-scroll");
  if (!grid || !scroll) return;
  const rect = grid.getBoundingClientRect();
  const relY = e.clientY - rect.top + scroll.scrollTop;
  const sm = Math.max(0, Math.min(23*60, Math.floor(relY/PX_PER_MIN/15)*15));
  openCalModal({mode:"create", dateStr, startMin:sm, endMin:Math.min(24*60,sm+60), text:"", cat:"personal"});
};
window.calMonthDayClick = function(dateStr) {
  const d=new Date(dateStr+"T12:00:00"), now=new Date();
  const nowMon=new Date(now); const nd=now.getDay();
  nowMon.setDate(now.getDate()-(nd===0?6:nd-1)); nowMon.setHours(0,0,0,0);
  const tMon=new Date(d); const td=d.getDay();
  tMon.setDate(d.getDate()-(td===0?6:td-1)); tMon.setHours(0,0,0,0);
  calUI.weekOffset=Math.round((tMon-nowMon)/604800000);
  calUI.view="week"; render();
};

// ── Drag (move) — uses pointer events so touch works too ──────────────────────
window.calDragStart = function(e, el, dateStr, id) {
  if (e.pointerType==="mouse" && e.button!==0) return;
  if (e.target.closest(".cal-event-resize")) return;
  e.stopPropagation();
  const ev=(state.calendar[dateStr]||[]).find(v=>v.id===id); if (!ev) return;
  if (ev.allDay) return;
  const sm=timeToMin(ev.start), em=timeToMin(ev.end);
  const rect=el.getBoundingClientRect();
  // Track where in the event the user grabbed — so the event doesn't jump to cursor top
  const cursorOffsetY = e.clientY - rect.top;
  calDrag={type:"move", dateStr, id, duration:em-sm, startX:e.clientX, startY:e.clientY,
    initLeft:rect.left, initTop:rect.top, cursorOffsetY, el, clone:null, started:false,
    currentDate:dateStr, currentStart:sm};
  document.addEventListener("pointermove", calMouseMove);
  document.addEventListener("pointerup",   calMouseUp);
};

// ── Drag (resize) ─────────────────────────────────────────────────────────────
window.calResizeStart = function(e, dateStr, id) {
  e.stopPropagation(); e.preventDefault();
  const ev=(state.calendar[dateStr]||[]).find(v=>v.id===id); if (!ev) return;
  const el=document.querySelector(`.cal-event[data-id="${id}"]`);
  calDrag={type:"resize", dateStr, id, startMin:timeToMin(ev.start), endMin:timeToMin(ev.end),
    startY:e.clientY, el, currentEnd:timeToMin(ev.end)};
  document.addEventListener("pointermove", calMouseMove);
  document.addEventListener("pointerup",   calMouseUp);
};

function calMouseMove(e) {
  if (!calDrag) return;
  if (calDrag.type==="move") {
    const dx=e.clientX-calDrag.startX, dy=e.clientY-calDrag.startY;
    if (!calDrag.started && Math.abs(dx)<5 && Math.abs(dy)<5) return;
    if (!calDrag.started) {
      calDrag.started=true;
      const c=calDrag.el.cloneNode(true);
      c.style.cssText=`position:fixed;width:${calDrag.el.offsetWidth}px;` +
        `left:${calDrag.initLeft}px;top:${calDrag.initTop}px;` +
        `opacity:0.85;pointer-events:none;z-index:9000;` +
        `transform:scale(1.02);box-shadow:0 8px 24px rgba(0,0,0,0.45);`;
      document.body.appendChild(c); calDrag.clone=c;
      calDrag.el.style.opacity="0.22";
      calDrag.cols=[...document.querySelectorAll(".cal-day-col")];
    }
    calDrag.clone.style.left=(calDrag.initLeft+dx)+"px";
    calDrag.clone.style.top =(calDrag.initTop +dy)+"px";
    // Target column
    for (const col of calDrag.cols) {
      const r=col.getBoundingClientRect();
      if (e.clientX>=r.left && e.clientX<r.right) { calDrag.currentDate=col.dataset.date; break; }
    }
    // Target time — subtract cursorOffsetY so event top (not cursor) snaps to grid
    const body=document.getElementById("cal-week-scroll"), grid=document.getElementById("cal-week-grid");
    if (body&&grid) {
      const gridRect=grid.getBoundingClientRect();
      const relY = e.clientY - gridRect.top - calDrag.cursorOffsetY;
      const snapped=Math.max(0,Math.round(relY/PX_PER_MIN/15)*15);
      calDrag.currentStart=Math.min(Math.max(0,snapped), 23*60+45-calDrag.duration);
    }
  } else if (calDrag.type==="resize") {
    const dy=e.clientY-calDrag.startY;
    const deltaMin=Math.round(dy/PX_PER_MIN/15)*15;
    const newEnd=Math.max(calDrag.startMin+15, calDrag.endMin+deltaMin);
    calDrag.currentEnd=Math.min(newEnd, 24*60);
    if (calDrag.el) calDrag.el.style.height=Math.max((calDrag.currentEnd-calDrag.startMin)*PX_PER_MIN,22)+"px";
  }
}

function calMouseUp() {
  document.removeEventListener("pointermove", calMouseMove);
  document.removeEventListener("pointerup",   calMouseUp);
  if (!calDrag) return;
  if (calDrag.type==="move") {
    if (calDrag.clone) calDrag.clone.remove();
    calDrag.el.style.opacity="";
    if (calDrag.started) {
      calBlockNextClick=true; setTimeout(()=>{calBlockNextClick=false;},150);
      calMove(calDrag.dateStr, calDrag.id, calDrag.currentDate,
              calDrag.currentStart, calDrag.currentStart+calDrag.duration);
      refreshCalContent();
    }
  } else if (calDrag.type==="resize") {
    calUpdate(calDrag.dateStr, calDrag.id, {end:minToTime(calDrag.currentEnd)});
    refreshCalContent();
  }
  calDrag=null;
}

// ── Arrow-key nudge (when hovering an event) ──────────────────────────────────
function calArrowNudge(dir) {
  if (!calHoveredId) return;
  const { dateStr, id } = calHoveredId;
  const arr = state.calendar[dateStr] || [];
  const ev  = arr.find(e => e.id === id);
  if (!ev || ev.allDay) return;
  const dur = timeToMin(ev.end) - timeToMin(ev.start);
  const newSm = Math.max(0, Math.min(23*60+45-dur, timeToMin(ev.start) + dir*15));
  ev.start = minToTime(newSm); ev.end = minToTime(newSm+dur);
  // Update DOM immediately for smooth feel
  const el = document.querySelector(`.cal-event[data-id="${id}"]`);
  if (el) {
    el.style.top = (newSm * PX_PER_MIN) + "px";
    const te = document.getElementById(`cal-ev-time-${id}`);
    if (te) te.textContent = `${ev.start}–${ev.end}`;
  }
  // Debounce save + full refresh
  clearTimeout(calArrowTimer);
  calArrowTimer = setTimeout(() => { saveState(); refreshCalContent(); }, 500);
}

// ── iCal import ───────────────────────────────────────────────────────────────
function parseIcalDate(val, hasTzid) {
  // val: raw value string e.g. "20260407T090000" or "20260407T090000Z" or "20260407"
  const isUTC = val.endsWith("Z");
  const clean = val.replace(/Z$/, "").replace(/[:-]/g, "");
  // All-day: date-only (8 digits)
  if (clean.length === 8) {
    return { dateStr:`${clean.slice(0,4)}-${clean.slice(4,6)}-${clean.slice(6,8)}`, allDay:true };
  }
  const y  = clean.slice(0,4), mo = clean.slice(4,6), d  = clean.slice(6,8);
  const hh = clean.slice(9,11), mm = clean.slice(11,13);
  let date;
  if (isUTC) {
    // Explicit UTC — let the browser convert to local
    date = new Date(`${y}-${mo}-${d}T${hh}:${mm}:00Z`);
  } else if (hasTzid) {
    // TZID present → time is already in named timezone.
    // We can't convert arbitrary TZID without full tz-db, so treat as local
    // (works when user exports from a calendar set to their own timezone)
    date = new Date(`${y}-${mo}-${d}T${hh}:${mm}:00`);
  } else {
    // Floating time — treat as local
    date = new Date(`${y}-${mo}-${d}T${hh}:${mm}:00`);
  }
  return {
    dateStr: `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`,
    time:    `${String(date.getHours()).padStart(2,"0")}:${String(date.getMinutes()).padStart(2,"0")}`,
    allDay:  false,
  };
}

function importIcal(icsText) {
  const text    = icsText.replace(/\r\n[ \t]/g,"").replace(/\n[ \t]/g,"");
  const vevents = text.split(/BEGIN:VEVENT/i).slice(1);
  const toAdd   = [];

  for (const block of vevents) {
    // Get value, also detect TZID on the same property line
    const getLine = key => {
      const m = block.match(new RegExp(`^(${key}(?:;[^:]*)?)\\:(.+)$`,"im"));
      if (!m) return null;
      const hasTzid = /TZID=/i.test(m[1]);
      const val = m[2].trim().replace(/\\n/g," ").replace(/\\,/g,",").replace(/\\;/g,";");
      return { val, hasTzid };
    };
    const get = key => getLine(key)?.val || null;

    const summary = get("SUMMARY") || "Imported event";
    const startL  = getLine("DTSTART"); if (!startL) continue;
    const endL    = getLine("DTEND");
    const rrule   = get("RRULE");
    const sp      = parseIcalDate(startL.val, startL.hasTzid);
    const ep      = endL ? parseIcalDate(endL.val, endL.hasTzid) : null;

    let endTime = ep?.time;
    if (!sp.allDay && !endTime) {
      const dur = get("DURATION");
      if (dur) {
        const h=(dur.match(/(\d+)H/)||[,0])[1], m2=(dur.match(/(\d+)M/)||[,0])[1];
        endTime = minToTime(timeToMin(sp.time) + (+h)*60 + (+m2));
      } else { endTime = minToTime(timeToMin(sp.time)+60); }
    }

    const lc = summary.toLowerCase();
    let cat = "personal";
    if (/class|lecture|seminar|tutorial|college|university/i.test(lc)) cat = "class";
    else if (/birthday|bday/i.test(lc)) cat = "birthday";
    else if (/holiday|public holiday|national day|bank holiday|day off|koningsdag|bevrijding|kerst|nieuwjaar|christmas|new year|liberation|king.?s day/i.test(lc)) cat = "holiday";
    else if (/work|meeting|standup|sprint|client/i.test(lc)) cat = "work";
    else if (/study|exam|assignment|homework|paper/i.test(lc)) cat = "study";
    else if (/gym|sport|yoga|run|swim|hobby|game|play/i.test(lc)) cat = "hobby";
    else if (/chore|clean|laundry|grocery|shop|errand/i.test(lc)) cat = "chore";

    const baseEv = sp.allDay
      ? { text:summary, cat, allDay:true }
      : { text:summary, cat, allDay:false, start:sp.time, end:endTime };

    if (rrule) {
      const freq = (rrule.match(/FREQ=(\w+)/i)||[])[1]?.toUpperCase();
      if (freq === "WEEKLY") {
        const untilM = rrule.match(/UNTIL=(\d{8})/i);
        const countM = rrule.match(/COUNT=(\d+)/i);
        const byDay  = (rrule.match(/BYDAY=([\w,]+)/i)||[])[1]?.split(",");
        const DAY    = {SU:0,MO:1,TU:2,WE:3,TH:4,FR:5,SA:6};
        const start  = new Date(sp.dateStr+"T12:00:00");
        const limit  = untilM
          ? new Date(`${untilM[1].slice(0,4)}-${untilM[1].slice(4,6)}-${untilM[1].slice(6,8)}T12:00:00`)
          : new Date(start.getTime() + 18*7*864e5);
        const maxN   = countM ? +countM[1] : 999;
        let cur = new Date(start), n = 0;
        while (cur <= limit && n < maxN) {
          if (!byDay || byDay.some(d2 => DAY[d2] === cur.getDay())) {
            const dk = `${cur.getFullYear()}-${String(cur.getMonth()+1).padStart(2,"0")}-${String(cur.getDate()).padStart(2,"0")}`;
            toAdd.push({ dateStr:dk, ev:{...baseEv} });
            n++;
          }
          cur.setDate(cur.getDate()+1);
        }
      } else {
        toAdd.push({ dateStr:sp.dateStr, ev:{...baseEv} });
      }
    } else {
      toAdd.push({ dateStr:sp.dateStr, ev:{...baseEv} });
    }
  }

  for (const { dateStr, ev } of toAdd) {
    if (!state.calendar[dateStr]) state.calendar[dateStr] = [];
    ev.id = nextCalId();
    state.calendar[dateStr].push(ev);
  }
  if (toAdd.length) {
    // Push single bulk undo entry for the entire import
    calPush({ type:'import', added: toAdd.map(({dateStr,ev})=>({dateStr,id:ev.id})) });
    saveState();
  }
  return toAdd.length;
}

window.handleIcalFile = function(e) {
  const file = e.target.files?.[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    const count = importIcal(ev.target.result);
    e.target.value = "";
    refreshCalContent();
    syncDot.className = "sync-dot saved";
    setTimeout(() => { syncDot.className = "sync-dot"; }, 2500);
    if (!count) alert("No events found in the .ics file.");
    else console.log(`[Naoki's Logs] Imported ${count} event(s) from ${file.name}`);
  };
  reader.readAsText(file);
};

// ── Time line ─────────────────────────────────────────────────────────────────
function scrollCalToNow() {
  const scroll = document.getElementById("cal-week-scroll"); if (!scroll) return;
  const now    = new Date(); const nowMin = now.getHours()*60 + now.getMinutes();
  // Vertical: center on current time (or 8am for other weeks)
  const targetY = (calUI.weekOffset === 0)
    ? Math.max(0, nowMin * PX_PER_MIN - scroll.clientHeight / 2 + 80)
    : 8 * HOUR_PX - 20;
  scroll.scrollTop = targetY;
  // Horizontal: scroll today's column into view on mobile
  if (isMobile()) {
    const todayEl = document.querySelector(".cal-today-col");
    if (todayEl) {
      const gutterW = 40;
      const colLeft = todayEl.offsetLeft;
      const colW    = todayEl.offsetWidth;
      scroll.scrollLeft = Math.max(0, colLeft - gutterW - (scroll.clientWidth - gutterW - colW) / 2);
    }
  }
}
function startCalTimeInterval() {
  if (calTimeInterval) clearInterval(calTimeInterval);
  calTimeInterval=setInterval(()=>{
    const line=document.getElementById("cal-now-line");
    if (!line) { clearInterval(calTimeInterval); calTimeInterval=null; return; }
    const now=new Date();
    line.style.top=(now.getHours()*60+now.getMinutes())*PX_PER_MIN+"px";
  }, 30000);
}

// ── Agenda (list) view ────────────────────────────────────────────────────────
let agendaSel     = new Set(); // selected event IDs (as "dateStr|id" strings)
let agendaBulkCat = "personal"; // persists the chosen target category across re-renders
let agendaLastIdx = -1; // index of last clicked row, for shift-range selection

function renderCalAgenda() {
  const today = todayKey();
  const DOW_FULL = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const entries = [];
  Object.keys(state.calendar).sort().forEach(dateStr => {
    if (dateStr < today) return;
    const evs = [...(state.calendar[dateStr]||[])].sort((a,b) => {
      if (a.allDay && !b.allDay) return -1;
      if (!a.allDay && b.allDay) return 1;
      return (a.start||"00:00").localeCompare(b.start||"00:00");
    });
    if (evs.length) entries.push({ dateStr, evs });
  });

  if (!entries.length) {
    return `<div class="cal-agenda-wrap"><div class="cal-agenda-empty">No upcoming events</div></div>`;
  }

  let rowIdx = 0;
  const dayHtml = entries.map(({ dateStr, evs }) => {
    const d = new Date(dateStr + "T12:00:00");
    const isToday = dateStr === today;
    const badge = isToday ? `<span class="cal-agenda-today-badge">Today</span>` : "";
    const rowsHtml = evs.map(ev => {
      const cat = CAL_CATS[ev.cat] || CAL_CAT_FALLBACK;
      const key = `${dateStr}|${ev.id}`;
      const sel = agendaSel.has(key);
      const timeStr = ev.allDay ? "all day" : `${ev.start} – ${ev.end}`;
      const idx = rowIdx++;
      return `<div class="cal-agenda-row${sel?" sel":""}" data-akey="${key}" data-date="${dateStr}" data-id="${ev.id}" data-idx="${idx}">
        <div class="cal-agenda-cb${sel?" checked":""}">${sel?"✓":""}</div>
        <div class="cal-agenda-dot" style="background:${cat.color}"></div>
        <div class="cal-agenda-time">${timeStr}</div>
        <div class="cal-agenda-name">${esc(ev.text)}</div>
        <div class="cal-agenda-cat" style="background:${cat.color}22;color:${cat.color}">${cat.label}</div>
      </div>`;
    }).join("");
    return `<div class="cal-agenda-day">
      <div class="cal-agenda-date">
        <span class="cal-agenda-dow">${DOW_FULL[d.getDay()]}</span>
        <span class="cal-agenda-dnum">${d.getDate()} ${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getMonth()]} ${d.getFullYear()}</span>
        ${badge}
      </div>
      ${rowsHtml}
    </div>`;
  }).join("");

  const bulkBar = agendaSel.size > 0 ? renderAgendaBulkBar() : "";
  return `<div style="display:flex;flex-direction:column;flex:1;min-height:0;gap:8px">
    <div class="cal-agenda-wrap">${dayHtml}</div>
    ${bulkBar}
  </div>`;
}

function renderAgendaBulkBar() {
  const catOpts = Object.keys(CAL_CATS).map(k =>
    `<option value="${k}"${k===agendaBulkCat?" selected":""}>${CAL_CATS[k].label}</option>`).join("");
  return `<div class="cal-bulk-bar">
    <span class="cal-bulk-count">${agendaSel.size} selected</span>
    <select class="cal-bulk-sel" id="bulk-cat-sel" onchange="agendaBulkCat=this.value">${catOpts}</select>
    <button class="cal-bulk-apply" onclick="agendaBulkReclassify()">Reclassify</button>
    <button class="cal-bulk-delete" onclick="agendaBulkDelete()">Delete</button>
    <button class="cal-bulk-clear" onclick="agendaClearSel()">✕</button>
  </div>`;
}

function initAgendaEvents() {
  const allRows = [...document.querySelectorAll(".cal-agenda-row")];
  allRows.forEach(row => {
    row.addEventListener("click", e => {
      if (e.target.closest(".cal-agenda-cb") || e.shiftKey) {
        const key = row.dataset.akey;
        const idx = parseInt(row.dataset.idx);

        if (e.shiftKey && agendaLastIdx >= 0) {
          // Range select: toggle all rows between last click and this one
          const lo = Math.min(agendaLastIdx, idx);
          const hi = Math.max(agendaLastIdx, idx);
          // Determine whether we're selecting or deselecting based on current row state
          const selecting = !agendaSel.has(key);
          allRows.forEach(r => {
            const ri = parseInt(r.dataset.idx);
            if (ri >= lo && ri <= hi) {
              if (selecting) agendaSel.add(r.dataset.akey);
              else agendaSel.delete(r.dataset.akey);
            }
          });
        } else {
          // Single toggle
          if (agendaSel.has(key)) agendaSel.delete(key);
          else agendaSel.add(key);
          agendaLastIdx = idx;
        }

        const wrap = document.querySelector(".cal-agenda-wrap");
        const savedScroll = wrap ? wrap.scrollTop : 0;
        refreshCalContent();
        requestAnimationFrame(() => {
          const newWrap = document.querySelector(".cal-agenda-wrap");
          if (newWrap) newWrap.scrollTop = savedScroll;
        });
      } else {
        calEditModal(row.dataset.date, parseInt(row.dataset.id));
      }
    });
  });
}

// Refresh agenda list while keeping scroll position intact
function refreshAgendaKeepScroll() {
  const wrap = document.querySelector(".cal-agenda-wrap");
  const savedScroll = wrap ? wrap.scrollTop : 0;
  refreshCalContent();
  requestAnimationFrame(() => {
    const newWrap = document.querySelector(".cal-agenda-wrap");
    if (newWrap) newWrap.scrollTop = savedScroll;
  });
}

window.agendaBulkReclassify = function() {
  if (!agendaSel.size) return;
  agendaSel.forEach(key => {
    const [dateStr, idStr] = key.split("|");
    calUpdate(dateStr, parseInt(idStr), { cat: agendaBulkCat }, true);
  });
  agendaSel.clear();
  agendaLastIdx = -1;
  saveState();
  refreshAgendaKeepScroll();
};

window.agendaBulkDelete = function() {
  if (!agendaSel.size) return;
  if (!confirm(`Delete ${agendaSel.size} event${agendaSel.size>1?"s":""}?`)) return;
  agendaSel.forEach(key => {
    const [dateStr, idStr] = key.split("|");
    calDelete(dateStr, parseInt(idStr), true);
  });
  agendaSel.clear();
  agendaLastIdx = -1;
  saveState();
  refreshAgendaKeepScroll();
};

window.agendaClearSel = function() {
  agendaSel.clear();
  agendaLastIdx = -1;
  refreshAgendaKeepScroll();
};
