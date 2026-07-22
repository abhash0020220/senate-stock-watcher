const PAGE_SIZE = 50;

const STATE_NAMES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'DC', FL: 'Florida',
  GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana',
  IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine',
  MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska',
  NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico',
  NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio',
  OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island',
  SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas',
  UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington',
  WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
  PR: 'Puerto Rico', GU: 'Guam', VI: 'Virgin Islands', AS: 'American Samoa',
  MP: 'Northern Mariana Islands',
};

let allTrades = [];
let filteredTrades = [];
let currentPage = 1;

const els = {
  banner: document.getElementById('coverageBanner'),
  stats: document.getElementById('stats'),
  search: document.getElementById('searchInput'),
  stateFilter: document.getElementById('stateFilter'),
  typeFilter: document.getElementById('typeFilter'),
  minAmountFilter: document.getElementById('minAmountFilter'),
  dateFrom: document.getElementById('dateFrom'),
  dateTo: document.getElementById('dateTo'),
  sortSelect: document.getElementById('sortSelect'),
  clearFilters: document.getElementById('clearFilters'),
  body: document.getElementById('trBody'),
  emptyState: document.getElementById('emptyState'),
  prevPage: document.getElementById('prevPage'),
  nextPage: document.getElementById('nextPage'),
  pageInfo: document.getElementById('pageInfo'),
};

function parseDate(str) {
  // "MM/DD/YYYY"
  const [m, d, y] = str.split('/').map(Number);
  return new Date(y, m - 1, d);
}

function typeClass(type) {
  if (type === 'Purchase') return 'type-purchase';
  if (type.startsWith('Sale')) return 'type-sale';
  return 'type-other';
}

function escapeHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Amounts are STOCK-Act-style brackets ("$15,001 - $50,000") or, rarely, an
// exact dollar figure ("$224"). Parses out the lower bound of the range so
// trades can be filtered/sorted by amount despite not being a plain number.
function amountLowerBound(amountStr) {
  const nums = (amountStr.match(/[\d,]+/g) || []).map(n => parseInt(n.replace(/,/g, ''), 10));
  return nums.length ? nums[0] : 0;
}

function loadData() {
  return fetch('data/transactions.json')
    .then(res => {
      if (!res.ok) throw new Error(`Failed to load dataset (${res.status})`);
      return res.json();
    })
    .then(raw => {
      allTrades = raw
        .filter(t => t.ticker && t.member)
        .map(t => {
          const _date = parseDate(t.transaction_date);
          const _notifDate = t.notification_date ? parseDate(t.notification_date) : null;
          // A notification date before the transaction date is physically
          // impossible (you can't be notified of a trade before it
          // happens), so it flags a typo in the original House filing
          // itself, not something we can safely auto-correct.
          const _dateIssue = _notifDate && _notifDate < _date;
          const _state = (t.office || '').slice(0, 2);
          const _amountLow = amountLowerBound(t.amount || '');
          return { ...t, _date, _dateIssue, _state, _amountLow };
        });

      populateStateFilter();
      renderCoverageBanner();
      renderStats();
      applyFilters();
    })
    .catch(e => {
      console.error(e);
      els.banner.textContent = `Could not load trade data: ${e.message}`;
    });
}

function populateStateFilter() {
  const states = [...new Set(allTrades.map(t => t._state).filter(Boolean))].sort();
  els.stateFilter.innerHTML = '<option value="">All states</option>' +
    states.map(s => `<option value="${s}">${escapeHtml(STATE_NAMES[s] || s)} (${s})</option>`).join('');
}

function renderCoverageBanner() {
  const dates = allTrades.map(t => t._date).sort((a, b) => a - b);
  const first = dates[0];
  const last = dates[dates.length - 1];
  const fmt = d => d.toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
  els.banner.textContent = `Showing ${allTrades.length.toLocaleString()} disclosed House trades, ${fmt(first)} – ${fmt(last)}. Live tracking coming soon.`;
}

function renderStats() {
  const members = new Set(allTrades.map(t => t.member));
  const tickers = new Set(allTrades.map(t => t.ticker));
  const purchases = allTrades.filter(t => t.type === 'Purchase').length;

  const tickerCounts = {};
  allTrades.forEach(t => { tickerCounts[t.ticker] = (tickerCounts[t.ticker] || 0) + 1; });
  const topTicker = Object.entries(tickerCounts).sort((a, b) => b[1] - a[1])[0];

  els.stats.innerHTML = `
    <div class="stat-card"><div class="value">${allTrades.length.toLocaleString()}</div><div class="label">Total trades</div></div>
    <div class="stat-card"><div class="value">${members.size}</div><div class="label">Members</div></div>
    <div class="stat-card"><div class="value">${tickers.size.toLocaleString()}</div><div class="label">Unique tickers</div></div>
    <div class="stat-card"><div class="value">${purchases.toLocaleString()}</div><div class="label">Purchases</div></div>
    <div class="stat-card"><div class="value">${topTicker ? topTicker[0] : '—'}</div><div class="label">Most-traded ticker</div></div>
  `;
}

function applyFilters() {
  const q = els.search.value.trim().toLowerCase();
  const stateVal = els.stateFilter.value;
  const typeVal = els.typeFilter.value;
  const minAmount = parseInt(els.minAmountFilter.value, 10) || 0;
  const fromVal = els.dateFrom.value ? new Date(els.dateFrom.value) : null;
  const toVal = els.dateTo.value ? new Date(els.dateTo.value) : null;
  const sortVal = els.sortSelect.value;

  filteredTrades = allTrades.filter(t => {
    if (stateVal && t._state !== stateVal) return false;
    if (typeVal && t.type !== typeVal) return false;
    if (minAmount && t._amountLow < minAmount) return false;
    if (fromVal && t._date < fromVal) return false;
    if (toVal && t._date > toVal) return false;
    if (!q) return true;
    return (
      t.member.toLowerCase().includes(q) ||
      t.ticker.toLowerCase().includes(q) ||
      (t.asset_description || '').toLowerCase().includes(q) ||
      (t.office || '').toLowerCase().includes(q) ||
      (STATE_NAMES[t._state] || '').toLowerCase().includes(q)
    );
  });

  filteredTrades.sort((a, b) => {
    switch (sortVal) {
      case 'date_asc': return a._date - b._date;
      case 'member_asc': return a.member.localeCompare(b.member);
      case 'ticker_asc': return a.ticker.localeCompare(b.ticker);
      case 'amount_desc': return b._amountLow - a._amountLow;
      default: return b._date - a._date; // date_desc
    }
  });

  currentPage = 1;
  renderTable();
}

function renderTable() {
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageItems = filteredTrades.slice(start, start + PAGE_SIZE);

  els.emptyState.style.display = pageItems.length ? 'none' : 'block';

  els.body.innerHTML = pageItems.map(t => `
    <tr>
      <td>${t.transaction_date}${t._dateIssue ? ` <span class="date-flag" title="This filing's notification date is before its transaction date — likely a typo in the original House filing, not this app.">⚠</span>` : ''}</td>
      <td>${escapeHtml(t.member)}</td>
      <td>${escapeHtml(STATE_NAMES[t._state] || t._state)}</td>
      <td>${escapeHtml(t.office)}</td>
      <td><strong>${escapeHtml(t.ticker)}</strong></td>
      <td>${escapeHtml(t.asset_description)}</td>
      <td><span class="type-pill ${typeClass(t.type)}">${escapeHtml(t.type)}</span></td>
      <td>${escapeHtml(t.amount)}</td>
      <td>${t.ptr_link ? `<a class="ptr-link" href="${t.ptr_link}" target="_blank" rel="noopener">filing ↗</a>` : ''}</td>
    </tr>
  `).join('');

  const totalPages = Math.max(1, Math.ceil(filteredTrades.length / PAGE_SIZE));
  els.pageInfo.textContent = `Page ${currentPage} of ${totalPages} (${filteredTrades.length.toLocaleString()} trades)`;
  els.prevPage.disabled = currentPage <= 1;
  els.nextPage.disabled = currentPage >= totalPages;
}

function clearFilters() {
  els.search.value = '';
  els.stateFilter.value = '';
  els.typeFilter.value = '';
  els.minAmountFilter.value = '0';
  els.dateFrom.value = '';
  els.dateTo.value = '';
  els.sortSelect.value = 'date_desc';
  applyFilters();
}

els.search.addEventListener('input', applyFilters);
els.stateFilter.addEventListener('change', applyFilters);
els.typeFilter.addEventListener('change', applyFilters);
els.minAmountFilter.addEventListener('change', applyFilters);
els.dateFrom.addEventListener('change', applyFilters);
els.dateTo.addEventListener('change', applyFilters);
els.sortSelect.addEventListener('change', applyFilters);
els.clearFilters.addEventListener('click', clearFilters);
els.prevPage.addEventListener('click', () => { if (currentPage > 1) { currentPage--; renderTable(); } });
els.nextPage.addEventListener('click', () => {
  const totalPages = Math.max(1, Math.ceil(filteredTrades.length / PAGE_SIZE));
  if (currentPage < totalPages) { currentPage++; renderTable(); }
});

loadData();
