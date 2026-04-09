// ── Feed styles (injected once) ───────────────────────────────────────────────
(function injectFeedStyles() {
  if (document.getElementById('feed-styles')) return;
  const s = document.createElement('style');
  s.id = 'feed-styles';
  s.textContent = `
    .feed-wrap {
      max-width: 680px;
      margin: 0 auto;
      padding: 28px 20px 48px;
    }
    .feed-header {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      margin-bottom: 20px;
    }
    .feed-heading {
      font-size: 14px;
      font-weight: 600;
      letter-spacing: 0.01em;
      color: var(--text, #e8e8e8);
    }
    .feed-meta {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .feed-updated {
      font-size: 11px;
      color: var(--text-dim, #666);
    }
    .feed-refresh-btn {
      background: none;
      border: 1px solid var(--border, #2a2a2a);
      border-radius: 4px;
      color: var(--text-dim, #666);
      font-size: 11px;
      font-family: inherit;
      padding: 2px 8px;
      cursor: pointer;
      transition: border-color 0.15s, color 0.15s;
    }
    .feed-refresh-btn:hover {
      border-color: var(--text-dim, #666);
      color: var(--text, #e8e8e8);
    }
    .feed-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .feed-item {
      background: var(--surface, #161616);
      border: 1px solid var(--border, #222);
      border-radius: 8px;
      padding: 11px 14px;
      display: grid;
      grid-template-columns: 54px 1fr;
      gap: 12px;
      align-items: start;
      transition: border-color 0.15s;
    }
    .feed-item:hover {
      border-color: var(--border-hover, #333);
    }
    .feed-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 3px 0;
      border-radius: 4px;
      font-size: 9.5px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      width: 54px;
      margin-top: 1px;
    }
    .feed-badge-event  { background: rgba(106,168,224,0.14); color: #6aa8e0; }
    .feed-badge-news   { background: rgba(96,196,132,0.14);  color: #60c484; }
    .feed-badge-alert  { background: rgba(224,112,112,0.14); color: #e07070; }
    .feed-badge-note   { background: rgba(212,176,106,0.14); color: #d4b06a; }
    .feed-body {
      min-width: 0;
    }
    .feed-item-title {
      font-size: 12.5px;
      font-weight: 600;
      color: var(--text, #e8e8e8);
      margin-bottom: 3px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .feed-item-content {
      font-size: 12.5px;
      color: var(--text, #c8c8c8);
      line-height: 1.55;
      word-break: break-word;
    }
    .feed-item-ts {
      font-size: 10.5px;
      color: var(--text-dim, #555);
      margin-top: 6px;
    }
    .feed-empty {
      text-align: center;
      color: var(--text-dim, #555);
      font-size: 13px;
      padding: 60px 0 40px;
      line-height: 1.7;
    }
    .feed-empty-icon {
      font-size: 28px;
      margin-bottom: 10px;
      opacity: 0.4;
    }
    .feed-loading {
      text-align: center;
      color: var(--text-dim, #555);
      font-size: 12px;
      padding: 48px 0;
    }
    .feed-count {
      font-size: 11px;
      color: var(--text-dim, #555);
      margin-bottom: 12px;
    }
    .feed-link {
      color: #6aa8e0;
      text-decoration: none;
      word-break: break-all;
    }
    .feed-link:hover {
      text-decoration: underline;
    }
  `;
  document.head.appendChild(s);
})();

// ── Feed state ────────────────────────────────────────────────────────────────
let feedItems       = [];
let feedPollTimer   = null;
let feedLastUpdated = null;
let feedLoading     = true;

const FEED_POLL_MS = 30_000;

// ── Helpers ───────────────────────────────────────────────────────────────────
function feedRelTime(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60)           return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60)           return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)           return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7)            return `${d}d ago`;
  // Beyond a week: show date
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function feedFmtUpdated(date) {
  if (!date) return '';
  return 'Updated ' + date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

// ── Data fetching ─────────────────────────────────────────────────────────────
async function fetchFeed(silent = false) {
  try {
    const data = await apiGet('/api/openclaw');
    feedItems       = data.items || [];
    feedLastUpdated = new Date();
    feedLoading     = false;
  } catch (err) {
    console.error('Feed fetch failed:', err);
    feedLoading = false;
  }
  // Patch only the inner panel if the feed tab is still mounted
  const panel = document.getElementById('feed-panel');
  if (panel) panel.innerHTML = buildFeedInner();
}

function startFeedPoll() {
  stopFeedPoll();
  fetchFeed();
  feedPollTimer = setInterval(() => fetchFeed(true), FEED_POLL_MS);
}

function stopFeedPoll() {
  clearInterval(feedPollTimer);
  feedPollTimer = null;
}

// ── Rendering ─────────────────────────────────────────────────────────────────
function buildFeedInner() {
  if (feedLoading) {
    return `<div class="feed-loading">Loading…</div>`;
  }

  const updatedStr = feedFmtUpdated(feedLastUpdated);

  const headerHTML = `
    <div class="feed-header">
      <span class="feed-heading">OpenClaw Feed</span>
      <div class="feed-meta">
        <span class="feed-updated" id="feed-updated-ts">${updatedStr}</span>
        <button class="feed-refresh-btn" onclick="fetchFeed()">↻ Refresh</button>
      </div>
    </div>`;

  if (feedItems.length === 0) {
    return headerHTML + `
      <div class="feed-empty">
        <div class="feed-empty-icon">📭</div>
        No items yet.<br>
        <span style="font-size:11px">OpenClaw will push updates here.</span>
      </div>`;
  }

  const countHTML = `<div class="feed-count">${feedItems.length} item${feedItems.length !== 1 ? 's' : ''} · polls every 30s</div>`;

  const listHTML = feedItems.map(item => {
    const badgeClass = `feed-badge feed-badge-${item.type}`;
    const titleHTML  = item.title
      ? `<div class="feed-item-title">${escHtml(item.title)}</div>`
      : '';
    return `
      <div class="feed-item">
        <span class="${badgeClass}">${escHtml(item.type)}</span>
        <div class="feed-body">
          ${titleHTML}
          <div class="feed-item-content">${linkify(item.content)}</div>
          <div class="feed-item-ts">${feedRelTime(item.ts)}</div>
        </div>
      </div>`;
  }).join('');

  return headerHTML + countHTML + `<div class="feed-list">${listHTML}</div>`;
}

// Escape HTML to prevent XSS from bot-pushed content
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Escape then turn URLs into clickable links
function linkify(str) {
  const escaped = escHtml(str);
  return escaped.replace(
    /(https?:\/\/[^\s&]+)/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer" class="feed-link">$1</a>'
  );
}

// Entry point called by ui.js render()
function renderFeed() {
  injectFeedStyles();
  startFeedPoll();
  return `<div class="feed-wrap"><div id="feed-panel">${buildFeedInner()}</div></div>`;
}

function injectFeedStyles() {
  // styles already injected at module load; this is a no-op safety guard
}
