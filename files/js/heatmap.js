// ── Heatmap ───────────────────────────────────────────────────────────────────

function renderSingleHeatmap(q) {
  const today = new Date();
  const todayStr = todayKey();
  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const m = Q_META[q];
  const colors = Q_HEAT_COLORS[q];

  // Always Jan 1 of the current year → today
  const jan1 = new Date(today.getFullYear(), 0, 1);
  const dayRange = Math.floor((today - jan1) / 86400000);

  const allCells = [];
  for (let i = dayRange; i >= 0; i--) {
    const d = new Date(today); d.setDate(today.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
    allCells.push({ key, d: new Date(d), dow: d.getDay(), month: d.getMonth() });
  }

  const padded = [...Array(allCells[0].dow).fill(null), ...allCells];
  const weeks = [];
  for (let i = 0; i < padded.length; i += 7) weeks.push(padded.slice(i, i + 7));

  let lastMonth = -1;
  const monthRow = weeks.map(week => {
    const first = week.find(c => c);
    if (first && first.month !== lastMonth) {
      lastMonth = first.month;
      return `<div style="min-width:15px;font-size:10px;color:var(--text-sub);letter-spacing:0.04em">${MONTHS[first.month]}</div>`;
    }
    return `<div style="min-width:15px"></div>`;
  }).join("");

  const cols = weeks.map(week => {
    const cells = week.map(c => {
      if (!c) return `<div style="width:12px;height:12px"></div>`;
      const n = (state.history[c.key] || []).filter(t => t.q === q).length;
      const col = heatColor(n, q);
      const isToday = c.key === todayStr;
      const bg = col ? `background:${col}` : `background:var(--raised)`;
      const ring = isToday ? `box-shadow:0 0 0 1.5px ${m.color};` : "";
      return `<div class="heatmap-cell" style="${bg};${ring}" onclick="openDayPopup(event,'${c.key}','${q}')"></div>`;
    }).join("");
    return `<div class="heatmap-col">${cells}</div>`;
  }).join("");

  const total = Object.values(state.history).reduce((s, a) => s + a.filter(t => t.q === q).length, 0);
  const days  = Object.values(state.history).filter(a => a.some(t => t.q === q)).length;

  const legend = [null, ...colors.slice(1)].map(c =>
    `<div class="legend-cell" style="background:${c || "var(--raised)"}"></div>`).join("");

  return `
    <div class="heatmap-section">
      <div class="heatmap-section-header">
        <div class="heatmap-section-dot" style="background:${m.color}"></div>
        <div>
          <div class="heatmap-title" style="color:${m.color}">${m.label}</div>
          <div class="heatmap-sub">${total} task${total !== 1 ? "s" : ""} across ${days} active day${days !== 1 ? "s" : ""}</div>
        </div>
      </div>
      <div class="heatmap-body">
        <div class="heatmap-months">${monthRow}</div>
        <div class="heatmap-grid-wrap">
          <div class="heatmap-day-labels">
            <div class="heatmap-day-label">Sun</div>
            <div class="heatmap-day-label" style="color:transparent">M</div>
            <div class="heatmap-day-label">Tue</div>
            <div class="heatmap-day-label" style="color:transparent">W</div>
            <div class="heatmap-day-label">Thu</div>
            <div class="heatmap-day-label" style="color:transparent">F</div>
            <div class="heatmap-day-label">Sat</div>
          </div>
          <div class="heatmap-cols">${cols}</div>
        </div>
        <div class="heatmap-legend">
          <div class="heatmap-legend-label">Less</div>
          <div class="heatmap-legend-cells">${legend}</div>
          <div class="heatmap-legend-label">More</div>
        </div>
      </div>
    </div>`;
}

function renderHeatmap() {
  return `
    <div class="heatmap-wrap">
      ${["green", "blue", "red", "yellow"].map(q => renderSingleHeatmap(q)).join("")}
    </div>`;
}
