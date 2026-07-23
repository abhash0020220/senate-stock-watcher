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

const PARTY_NAMES = { R: 'Republican', D: 'Democrat', I: 'Independent' };
const PARTY_COLORS = { R: '#ff6b6b', D: '#4f9dff', I: '#8a919c' };

let allTrades = [];
let filteredTrades = [];
let currentPage = 1;
let partyByOffice = {};
let charts = {};
let analyticsBuilt = false;

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
  tabTrades: document.getElementById('tabTrades'),
  tabAnalytics: document.getElementById('tabAnalytics'),
  tradesView: document.getElementById('tradesView'),
  analyticsView: document.getElementById('analyticsView'),
  memberSelect: document.getElementById('memberSelect'),
  partyCaveat: document.getElementById('partyCaveat'),
  chartModal: document.getElementById('chartModal'),
  modalCanvas: document.getElementById('modalCanvas'),
  modalTitle: document.getElementById('modalTitle'),
  modalClose: document.getElementById('modalClose'),
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
  return Promise.all([
    fetch('data/transactions.json').then(res => {
      if (!res.ok) throw new Error(`Failed to load dataset (${res.status})`);
      return res.json();
    }),
    fetch('data/member_parties.json').then(res => res.ok ? res.json() : {}).catch(() => ({})),
  ])
    .then(([raw, parties]) => {
      partyByOffice = parties;
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
          const _party = (partyByOffice[t.office] || {}).party || null;
          const _month = `${_date.getFullYear()}-${String(_date.getMonth() + 1).padStart(2, '0')}`;
          return { ...t, _date, _dateIssue, _state, _amountLow, _party, _month };
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

// ---------- Analytics ----------

const STATE_CHART_COLORS = [
  '#4f9dff', '#3ddc84', '#ff6b6b', '#f7b955', '#c084fc',
  '#5eead4', '#f472b6', '#a3e635', '#9a9a9a',
];

const AMOUNT_BRACKET_ORDER = [
  '$1,001 - $15,000', '$15,001 - $50,000', '$50,001 - $100,000',
  '$100,001 - $250,000', '$250,001 - $500,000', '$500,001 - $1,000,000',
  '$1,000,001 - $5,000,000', '$5,000,001 - $25,000,000',
];

// Each chart is defined as a (canvasId) => Chart factory, so the exact same
// definition can build either the small card chart or the expanded modal
// version — no config duplication between the two sizes.
const chartMakers = {};
const chartTitles = {};
const CHART_CANVAS_IDS = {
  states: 'chartStates', member: 'chartMember', party: 'chartParty', partyType: 'chartPartyType',
  topTickers: 'chartTopTickers', topMembers: 'chartTopMembers', buySell: 'chartBuySell', amountDist: 'chartAmountDist',
};

function sortedMonths() {
  return [...new Set(allTrades.map(t => t._month))].sort();
}

function monthLabel(m) {
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString('en-US', { year: '2-digit', month: 'short' });
}

function switchView(view) {
  const showAnalytics = view === 'analytics';
  els.tradesView.style.display = showAnalytics ? 'none' : '';
  els.analyticsView.style.display = showAnalytics ? '' : 'none';
  els.tabTrades.classList.toggle('active', !showAnalytics);
  els.tabAnalytics.classList.toggle('active', showAnalytics);
  if (showAnalytics && !analyticsBuilt) {
    buildAnalytics();
    analyticsBuilt = true;
  }
}

function buildAnalytics() {
  registerStateChart();
  registerMemberChart();
  registerPartyChart();
  registerPartyTypeChart();
  registerTopTickersChart();
  registerTopMembersChart();
  registerBuySellChart();
  registerAmountDistChart();

  Object.keys(chartMakers).forEach(key => {
    charts[key] = chartMakers[key](CHART_CANVAS_IDS[key]);
  });
}

function baseChartOptions(extra) {
  return Object.assign({
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { labels: { color: '#eef1f5', boxWidth: 12, font: { size: 11 } } },
    },
    scales: {
      x: { ticks: { color: '#8a919c', font: { size: 10 } }, grid: { color: '#2a3038' } },
      y: { ticks: { color: '#8a919c', font: { size: 10 } }, grid: { color: '#2a3038' }, beginAtZero: true },
    },
  }, extra || {});
}

function registerStateChart() {
  chartTitles.states = 'Trades over time by state';
  chartMakers.states = (canvasId) => {
    const months = sortedMonths();
    const totalsByState = {};
    allTrades.forEach(t => { totalsByState[t._state] = (totalsByState[t._state] || 0) + 1; });
    const topStates = Object.entries(totalsByState).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([s]) => s);

    const perMonthState = {};
    months.forEach(m => { perMonthState[m] = {}; });
    allTrades.forEach(t => {
      const key = topStates.includes(t._state) ? t._state : 'Other';
      perMonthState[t._month][key] = (perMonthState[t._month][key] || 0) + 1;
    });

    const seriesKeys = [...topStates, 'Other'];
    const datasets = seriesKeys.map((key, i) => ({
      label: key === 'Other' ? 'Other' : (STATE_NAMES[key] || key),
      data: months.map(m => perMonthState[m][key] || 0),
      borderColor: STATE_CHART_COLORS[i % STATE_CHART_COLORS.length],
      backgroundColor: STATE_CHART_COLORS[i % STATE_CHART_COLORS.length],
      tension: 0.25,
      pointRadius: 2,
      fill: false,
    }));

    return new Chart(document.getElementById(canvasId), {
      type: 'line',
      data: { labels: months.map(monthLabel), datasets },
      options: baseChartOptions(),
    });
  };
}

function populateMemberSelect() {
  const counts = {};
  allTrades.forEach(t => { counts[t.member] = (counts[t.member] || 0) + 1; });
  const members = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  els.memberSelect.innerHTML = members
    .map(([name, count]) => `<option value="${escapeHtml(name)}">${escapeHtml(name)} (${count})</option>`)
    .join('');
}

function memberChartConfig(memberName) {
  const months = sortedMonths();
  const trades = allTrades.filter(t => t.member === memberName);
  const counts = {};
  trades.forEach(t => { counts[t._month] = (counts[t._month] || 0) + 1; });
  return {
    labels: months.map(monthLabel),
    datasets: [{
      label: memberName,
      data: months.map(m => counts[m] || 0),
      backgroundColor: '#4f9dff',
      borderRadius: 3,
    }],
  };
}

function registerMemberChart() {
  chartTitles.member = "A member's trades over time";
  populateMemberSelect();
  chartMakers.member = (canvasId) => new Chart(document.getElementById(canvasId), {
    type: 'bar',
    data: memberChartConfig(els.memberSelect.value),
    options: baseChartOptions({ plugins: { legend: { display: false } } }),
  });
  els.memberSelect.addEventListener('change', () => {
    if (charts.member) charts.member.destroy();
    charts.member = chartMakers.member('chartMember');
  });
}

function registerPartyChart() {
  chartTitles.party = 'Republican vs. Democrat trades over time';
  chartMakers.party = (canvasId) => {
    const months = sortedMonths();
    const withParty = allTrades.filter(t => t._party === 'R' || t._party === 'D');
    const perMonth = { R: {}, D: {} };
    withParty.forEach(t => { perMonth[t._party][t._month] = (perMonth[t._party][t._month] || 0) + 1; });

    const memberSet = { R: new Set(), D: new Set() };
    withParty.forEach(t => memberSet[t._party].add(t.member));
    els.partyCaveat.textContent =
      `Raw trade counts, not adjusted for how many members of each party filed disclosures in this dataset ` +
      `(${memberSet.R.size} Republican members, ${memberSet.D.size} Democrat members appear here).`;

    return new Chart(document.getElementById(canvasId), {
      type: 'line',
      data: {
        labels: months.map(monthLabel),
        datasets: ['R', 'D'].map(p => ({
          label: PARTY_NAMES[p],
          data: months.map(m => perMonth[p][m] || 0),
          borderColor: PARTY_COLORS[p],
          backgroundColor: PARTY_COLORS[p],
          tension: 0.25,
          pointRadius: 2,
          fill: false,
        })),
      },
      options: baseChartOptions(),
    });
  };
}

function registerPartyTypeChart() {
  chartTitles.partyType = 'Republican vs. Democrat: purchases vs. sales';
  chartMakers.partyType = (canvasId) => {
    const withParty = allTrades.filter(t => t._party === 'R' || t._party === 'D');
    const categories = ['Purchase', 'Sale', 'Exchange'];
    const normType = t => t.type.startsWith('Sale') ? 'Sale' : t.type;

    const counts = { R: { Purchase: 0, Sale: 0, Exchange: 0 }, D: { Purchase: 0, Sale: 0, Exchange: 0 } };
    withParty.forEach(t => {
      const cat = normType(t);
      if (counts[t._party][cat] !== undefined) counts[t._party][cat]++;
    });

    return new Chart(document.getElementById(canvasId), {
      type: 'bar',
      data: {
        labels: categories,
        datasets: ['R', 'D'].map(p => ({
          label: PARTY_NAMES[p],
          data: categories.map(c => counts[p][c]),
          backgroundColor: PARTY_COLORS[p],
          borderRadius: 3,
        })),
      },
      options: baseChartOptions(),
    });
  };
}

function registerTopTickersChart() {
  chartTitles.topTickers = 'Most-traded tickers';
  chartMakers.topTickers = (canvasId) => {
    const counts = {};
    allTrades.forEach(t => { counts[t.ticker] = (counts[t.ticker] || 0) + 1; });
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10);

    return new Chart(document.getElementById(canvasId), {
      type: 'bar',
      data: {
        labels: top.map(([ticker]) => ticker),
        datasets: [{ label: 'Trades', data: top.map(([, c]) => c), backgroundColor: '#3ddc84', borderRadius: 3 }],
      },
      options: baseChartOptions({ indexAxis: 'y', plugins: { legend: { display: false } } }),
    });
  };
}

function registerTopMembersChart() {
  chartTitles.topMembers = 'Most active traders';
  chartMakers.topMembers = (canvasId) => {
    const counts = {};
    const partyOf = {};
    allTrades.forEach(t => {
      counts[t.member] = (counts[t.member] || 0) + 1;
      partyOf[t.member] = t._party;
    });
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10);

    return new Chart(document.getElementById(canvasId), {
      type: 'bar',
      data: {
        labels: top.map(([name]) => name),
        datasets: [{
          label: 'Trades',
          data: top.map(([, c]) => c),
          backgroundColor: top.map(([name]) => PARTY_COLORS[partyOf[name]] || '#9a9a9a'),
          borderRadius: 3,
        }],
      },
      options: baseChartOptions({ indexAxis: 'y', plugins: { legend: { display: false } } }),
    });
  };
}

function registerBuySellChart() {
  chartTitles.buySell = 'Buy vs. sell trend over time';
  chartMakers.buySell = (canvasId) => {
    const months = sortedMonths();
    const normType = t => t.type.startsWith('Sale') ? 'Sale' : t.type;
    const categories = ['Purchase', 'Sale', 'Exchange'];
    const colors = { Purchase: '#3ddc84', Sale: '#ff6b6b', Exchange: '#f7b955' };

    const perMonth = {};
    months.forEach(m => { perMonth[m] = { Purchase: 0, Sale: 0, Exchange: 0 }; });
    allTrades.forEach(t => { perMonth[t._month][normType(t)]++; });

    return new Chart(document.getElementById(canvasId), {
      type: 'line',
      data: {
        labels: months.map(monthLabel),
        datasets: categories.map(cat => ({
          label: cat,
          data: months.map(m => perMonth[m][cat]),
          borderColor: colors[cat],
          backgroundColor: colors[cat],
          tension: 0.25,
          pointRadius: 2,
          fill: false,
        })),
      },
      options: baseChartOptions(),
    });
  };
}

function registerAmountDistChart() {
  chartTitles.amountDist = 'Trade size distribution';
  chartMakers.amountDist = (canvasId) => {
    const counts = {};
    AMOUNT_BRACKET_ORDER.forEach(b => { counts[b] = 0; });
    let other = 0;
    allTrades.forEach(t => {
      if (counts[t.amount] !== undefined) counts[t.amount]++;
      else other++;
    });
    const labels = [...AMOUNT_BRACKET_ORDER, 'Other (exact amounts)'];
    const data = [...AMOUNT_BRACKET_ORDER.map(b => counts[b]), other];

    return new Chart(document.getElementById(canvasId), {
      type: 'bar',
      data: { labels, datasets: [{ label: 'Trades', data, backgroundColor: '#c084fc', borderRadius: 3 }] },
      options: baseChartOptions({
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: '#8a919c', font: { size: 9 }, maxRotation: 40, minRotation: 40 }, grid: { color: '#2a3038' } },
          y: { ticks: { color: '#8a919c', font: { size: 10 } }, grid: { color: '#2a3038' }, beginAtZero: true },
        },
      }),
    });
  };
}

function openChartModal(key) {
  els.modalTitle.textContent = chartTitles[key] || '';
  els.chartModal.style.display = 'flex';
  if (charts.modal) charts.modal.destroy();
  charts.modal = chartMakers[key]('modalCanvas');
}

function closeChartModal() {
  els.chartModal.style.display = 'none';
  if (charts.modal) { charts.modal.destroy(); charts.modal = null; }
}

document.querySelectorAll('.expand-btn').forEach(btn => {
  btn.addEventListener('click', () => openChartModal(btn.dataset.chart));
});
els.modalClose.addEventListener('click', closeChartModal);
els.chartModal.addEventListener('click', (e) => { if (e.target === els.chartModal) closeChartModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && els.chartModal.style.display !== 'none') closeChartModal(); });

els.tabTrades.addEventListener('click', () => switchView('trades'));
els.tabAnalytics.addEventListener('click', () => switchView('analytics'));

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
