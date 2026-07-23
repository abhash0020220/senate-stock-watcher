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
const CHAMBER_COLORS = { House: '#4f9dff', Senate: '#c084fc' };

let allTrades = [];
let filteredTrades = [];
let currentPage = 1;
let charts = {};
let analyticsBuilt = false;

const els = {
  banner: document.getElementById('coverageBanner'),
  stats: document.getElementById('stats'),
  search: document.getElementById('searchInput'),
  stateFilter: document.getElementById('stateFilter'),
  partyFilter: document.getElementById('partyFilter'),
  chamberFilter: document.getElementById('chamberFilter'),
  typeFilter: document.getElementById('typeFilter'),
  minAmountFilter: document.getElementById('minAmountFilter'),
  dateFrom: document.getElementById('dateFrom'),
  dateTo: document.getElementById('dateTo'),
  daysToFileFilter: document.getElementById('daysToFileFilter'),
  sortSelect: document.getElementById('sortSelect'),
  clearFilters: document.getElementById('clearFilters'),
  body: document.getElementById('trBody'),
  emptyState: document.getElementById('emptyState'),
  prevPage: document.getElementById('prevPage'),
  nextPage: document.getElementById('nextPage'),
  pageInfo: document.getElementById('pageInfo'),
  prevPageBottom: document.getElementById('prevPageBottom'),
  nextPageBottom: document.getElementById('nextPageBottom'),
  pageInfoBottom: document.getElementById('pageInfoBottom'),
  tabTrades: document.getElementById('tabTrades'),
  tabAnalytics: document.getElementById('tabAnalytics'),
  tradesView: document.getElementById('tradesView'),
  analyticsView: document.getElementById('analyticsView'),
  memberSelect: document.getElementById('memberSelect'),
  partyCaveat: document.getElementById('partyCaveat'),
  analyticsChamberFilter: document.getElementById('analyticsChamberFilter'),
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

// House PTRs just print "S" for a full sale (mapped to "Sale"); Senate
// filings explicitly print "S (full)" (mapped to "Sale (Full)"). Same
// underlying event, two different chamber labels — normalize so
// filtering/coloring doesn't split one thing into two values.
function normalizeType(type) {
  return type === 'Sale' ? 'Sale (Full)' : type;
}

function typeClass(type) {
  const t = normalizeType(type);
  if (t === 'Purchase') return 'type-purchase';
  if (t === 'Sale (Full)') return 'type-sale-full';
  if (t === 'Sale (Partial)') return 'type-sale-partial';
  if (t === 'Exchange') return 'type-exchange';
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
          const _filedDate = t.filed_date ? parseDate(t.filed_date) : null;
          // A notification/filed date before the transaction date is
          // physically impossible (you can't be notified of, or disclose,
          // a trade before it happens), so it flags a typo in the original
          // filing's transaction date, not something we can safely
          // auto-correct — verified against several real cases where the
          // "Digitally Signed" filed date matched the PDF exactly, so the
          // transaction date is the one that's wrong.
          const _dateIssue = (_notifDate && _notifDate < _date) || (_filedDate && _filedDate < _date);
          const _state = t.state || (t.office || '').slice(0, 2);
          const _amountLow = amountLowerBound(t.amount || '');
          const _party = t.party || null;
          const _month = `${_date.getFullYear()}-${String(_date.getMonth() + 1).padStart(2, '0')}`;
          const _daysToFile = typeof t.days_to_file === 'number' ? t.days_to_file : null;
          return { ...t, _date, _dateIssue, _state, _amountLow, _party, _month, _filedDate, _daysToFile };
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
  const houseCount = allTrades.filter(t => t.chamber === 'House').length;
  const senateCount = allTrades.filter(t => t.chamber === 'Senate').length;
  els.banner.textContent = `Showing ${allTrades.length.toLocaleString()} disclosed trades (${houseCount.toLocaleString()} House, ${senateCount.toLocaleString()} Senate), ${fmt(first)} – ${fmt(last)}. Auto-refreshed daily — "Filed" is when the trade was disclosed, not when it happened.`;
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
  const partyVal = els.partyFilter.value;
  const chamberVal = els.chamberFilter.value;
  const typeVal = els.typeFilter.value;
  const minAmount = parseInt(els.minAmountFilter.value, 10) || 0;
  const fromVal = els.dateFrom.value ? new Date(els.dateFrom.value) : null;
  const toVal = els.dateTo.value ? new Date(els.dateTo.value) : null;
  const minDaysToFile = parseInt(els.daysToFileFilter.value, 10) || 0;
  const sortVal = els.sortSelect.value;

  filteredTrades = allTrades.filter(t => {
    if (stateVal && t._state !== stateVal) return false;
    if (partyVal && t._party !== partyVal) return false;
    if (chamberVal && t.chamber !== chamberVal) return false;
    if (typeVal && normalizeType(t.type) !== typeVal) return false;
    if (minAmount && t._amountLow < minAmount) return false;
    if (fromVal && t._date < fromVal) return false;
    if (toVal && t._date > toVal) return false;
    if (minDaysToFile && (t._daysToFile === null || t._daysToFile < minDaysToFile)) return false;
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
      case 'filed_desc': return (b._filedDate || 0) - (a._filedDate || 0);
      case 'member_asc': return a.member.localeCompare(b.member);
      case 'ticker_asc': return a.ticker.localeCompare(b.ticker);
      case 'amount_desc': return b._amountLow - a._amountLow;
      case 'days_desc': return (b._daysToFile ?? -1) - (a._daysToFile ?? -1);
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
      <td>${t.transaction_date}${t._dateIssue ? ` <span class="date-flag" title="This filing's notification/filed date is before its transaction date — almost certainly a typo in the original filing's transaction date, not this app.">⚠</span>` : ''}</td>
      <td>${t.filed_date ? escapeHtml(t.filed_date) : '—'}${t._daysToFile !== null ? ` <span class="days-pill${t._daysToFile < 45 ? ' on-time' : ' late'}">${t._daysToFile}d</span>` : ''}</td>
      <td>${escapeHtml(t.member)}${t.member_url ? ` <a class="member-link" href="${t.member_url}" target="_blank" rel="noopener" title="Official congress.gov profile">↗</a>` : ''}</td>
      <td>${t._party ? `<span class="party-pill" style="background:${PARTY_COLORS[t._party]}22; color:${PARTY_COLORS[t._party]};">${escapeHtml(PARTY_NAMES[t._party] || t._party)}</span>` : '—'}</td>
      <td>${escapeHtml(t.chamber)}</td>
      <td>${escapeHtml(STATE_NAMES[t._state] || t._state)}</td>
      <td>${escapeHtml(t.office)}</td>
      <td><strong>${escapeHtml(t.ticker)}</strong> <a class="member-link" href="https://finance.yahoo.com/quote/${encodeURIComponent(t.ticker)}" target="_blank" rel="noopener" title="View on Yahoo Finance">↗</a></td>
      <td><span class="type-pill ${typeClass(t.type)}">${escapeHtml(normalizeType(t.type))}</span></td>
      <td>${escapeHtml(t.amount)}</td>
      <td>${escapeHtml(t.asset_description)}</td>
      <td>${t.ptr_link ? `<a class="ptr-link" href="${t.ptr_link}" target="_blank" rel="noopener">filing ↗</a>` : ''}</td>
    </tr>
  `).join('');

  const totalPages = Math.max(1, Math.ceil(filteredTrades.length / PAGE_SIZE));
  const pageInfoText = `Page ${currentPage} of ${totalPages} (${filteredTrades.length.toLocaleString()} trades)`;
  els.pageInfo.textContent = pageInfoText;
  els.pageInfoBottom.textContent = pageInfoText;
  els.prevPage.disabled = currentPage <= 1;
  els.nextPage.disabled = currentPage >= totalPages;
  els.prevPageBottom.disabled = currentPage <= 1;
  els.nextPageBottom.disabled = currentPage >= totalPages;
}

function clearFilters() {
  els.search.value = '';
  els.stateFilter.value = '';
  els.partyFilter.value = '';
  els.chamberFilter.value = '';
  els.typeFilter.value = '';
  els.minAmountFilter.value = '0';
  els.dateFrom.value = '';
  els.dateTo.value = '';
  els.daysToFileFilter.value = '0';
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
  chamber: 'chartChamber', chamberType: 'chartChamberType',
  topTickers: 'chartTopTickers', topMembers: 'chartTopMembers', buySell: 'chartBuySell', amountDist: 'chartAmountDist',
  daysDist: 'chartDaysDist', avgDaysParty: 'chartAvgDaysParty', avgDaysChamber: 'chartAvgDaysChamber',
  volumeByState: 'chartVolumeByState', volumeByTicker: 'chartVolumeByTicker', monthlyTotal: 'chartMonthlyTotal',
};
// Charts that inherently compare House vs. Senate ignore the scope
// selector — filtering to "House only" would make a House-vs-Senate
// comparison meaningless — everything else respects it.
const CHAMBER_COMPARISON_CHARTS = new Set(['chamber', 'chamberType', 'avgDaysChamber']);

function scopedTrades() {
  const chamber = els.analyticsChamberFilter.value;
  return chamber ? allTrades.filter(t => t.chamber === chamber) : allTrades;
}

function tradesFor(key) {
  return CHAMBER_COMPARISON_CHARTS.has(key) ? allTrades : scopedTrades();
}

function sortedMonths(trades) {
  return [...new Set((trades || scopedTrades()).map(t => t._month))].sort();
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
  registerChamberChart();
  registerChamberTypeChart();
  registerTopTickersChart();
  registerTopMembersChart();
  registerBuySellChart();
  registerAmountDistChart();
  registerDaysDistChart();
  registerAvgDaysPartyChart();
  registerAvgDaysChamberChart();
  registerVolumeByStateChart();
  registerVolumeByTickerChart();
  registerMonthlyTotalChart();

  rebuildAllCharts();
}

function rebuildAllCharts() {
  Object.keys(chartMakers).forEach(key => {
    if (charts[key]) charts[key].destroy();
    charts[key] = chartMakers[key](CHART_CANVAS_IDS[key]);
  });
}

// Clicking a legend item isolates that series (hides every other one)
// instead of Chart.js's default of just toggling the clicked series off.
// Clicking a second item adds it to the visible set rather than replacing
// the first. Clicking the last visible item off resets back to "show all"
// so users don't get stuck on a blank chart. "Isolated" is derived from
// current visibility state rather than tracked separately, so it works
// the same after any sequence of clicks.
function isolateLegendClick(e, legendItem, legend) {
  const chart = legend.chart;
  const metas = chart.data.datasets.map((_, i) => chart.getDatasetMeta(i));
  const allVisible = metas.every(m => !m.hidden);

  if (allVisible) {
    metas.forEach((m, i) => { m.hidden = i !== legendItem.datasetIndex; });
  } else {
    const meta = metas[legendItem.datasetIndex];
    meta.hidden = meta.hidden ? false : true;
    if (metas.every(m => m.hidden)) metas.forEach(m => { m.hidden = false; });
  }
  chart.update();
}

function baseChartOptions(extra) {
  return Object.assign({
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { labels: { color: '#eef1f5', boxWidth: 12, font: { size: 11 } }, onClick: isolateLegendClick },
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
    const trades = tradesFor('states');
    const months = sortedMonths(trades);
    const totalsByState = {};
    trades.forEach(t => { totalsByState[t._state] = (totalsByState[t._state] || 0) + 1; });
    const topStates = Object.entries(totalsByState).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([s]) => s);

    const perMonthState = {};
    months.forEach(m => { perMonthState[m] = {}; });
    trades.forEach(t => {
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
  const trades = tradesFor('member');
  const counts = {};
  trades.forEach(t => { counts[t.member] = (counts[t.member] || 0) + 1; });
  const members = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const prevValue = els.memberSelect.value;
  els.memberSelect.innerHTML = members
    .map(([name, count]) => `<option value="${escapeHtml(name)}">${escapeHtml(name)} (${count})</option>`)
    .join('');
  if (members.some(([name]) => name === prevValue)) els.memberSelect.value = prevValue;
}

function memberChartConfig(memberName) {
  const trades = tradesFor('member');
  const months = sortedMonths(trades);
  const memberTrades = trades.filter(t => t.member === memberName);
  const counts = {};
  memberTrades.forEach(t => { counts[t._month] = (counts[t._month] || 0) + 1; });
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
    const trades = tradesFor('party');
    const months = sortedMonths(trades);
    const withParty = trades.filter(t => t._party === 'R' || t._party === 'D');
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
    const withParty = tradesFor('partyType').filter(t => t._party === 'R' || t._party === 'D');
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

function registerChamberChart() {
  chartTitles.chamber = 'House vs. Senate trades over time';
  chartMakers.chamber = (canvasId) => {
    const trades = tradesFor('chamber'); // always allTrades — comparison chart
    const months = sortedMonths(trades);
    const perMonth = { House: {}, Senate: {} };
    trades.forEach(t => { perMonth[t.chamber][t._month] = (perMonth[t.chamber][t._month] || 0) + 1; });

    return new Chart(document.getElementById(canvasId), {
      type: 'line',
      data: {
        labels: months.map(monthLabel),
        datasets: ['House', 'Senate'].map(c => ({
          label: c,
          data: months.map(m => perMonth[c][m] || 0),
          borderColor: CHAMBER_COLORS[c],
          backgroundColor: CHAMBER_COLORS[c],
          tension: 0.25,
          pointRadius: 2,
          fill: false,
        })),
      },
      options: baseChartOptions(),
    });
  };
}

function registerChamberTypeChart() {
  chartTitles.chamberType = 'House vs. Senate: purchases vs. sales';
  chartMakers.chamberType = (canvasId) => {
    const trades = tradesFor('chamberType'); // always allTrades
    const categories = ['Purchase', 'Sale', 'Exchange'];
    const normType = t => t.type.startsWith('Sale') ? 'Sale' : t.type;

    const counts = { House: { Purchase: 0, Sale: 0, Exchange: 0 }, Senate: { Purchase: 0, Sale: 0, Exchange: 0 } };
    trades.forEach(t => {
      const cat = normType(t);
      if (counts[t.chamber] && counts[t.chamber][cat] !== undefined) counts[t.chamber][cat]++;
    });

    return new Chart(document.getElementById(canvasId), {
      type: 'bar',
      data: {
        labels: categories,
        datasets: ['House', 'Senate'].map(c => ({
          label: c,
          data: categories.map(cat => counts[c][cat]),
          backgroundColor: CHAMBER_COLORS[c],
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
    tradesFor('topTickers').forEach(t => { counts[t.ticker] = (counts[t.ticker] || 0) + 1; });
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
    tradesFor('topMembers').forEach(t => {
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
    const trades = tradesFor('buySell');
    const months = sortedMonths(trades);
    const normType = t => t.type.startsWith('Sale') ? 'Sale' : t.type;
    const categories = ['Purchase', 'Sale', 'Exchange'];
    const colors = { Purchase: '#3ddc84', Sale: '#ff6b6b', Exchange: '#f7b955' };

    const perMonth = {};
    months.forEach(m => { perMonth[m] = { Purchase: 0, Sale: 0, Exchange: 0 }; });
    trades.forEach(t => { perMonth[t._month][normType(t)]++; });

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
    tradesFor('amountDist').forEach(t => {
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

const DAYS_BUCKET_ORDER = ['0–15', '15–30', '30–45', '45–60', '60–90', '90+'];
function daysBucket(days) {
  if (days < 15) return '0–15';
  if (days < 30) return '15–30';
  if (days < 45) return '30–45';
  if (days < 60) return '45–60';
  if (days < 90) return '60–90';
  return '90+';
}

function registerDaysDistChart() {
  chartTitles.daysDist = 'Days-to-file distribution';
  chartMakers.daysDist = (canvasId) => {
    const counts = {};
    DAYS_BUCKET_ORDER.forEach(b => { counts[b] = 0; });
    tradesFor('daysDist').forEach(t => {
      if (t._daysToFile !== null && t._daysToFile >= 0) counts[daysBucket(t._daysToFile)]++;
    });

    return new Chart(document.getElementById(canvasId), {
      type: 'bar',
      data: {
        labels: DAYS_BUCKET_ORDER,
        datasets: [{
          label: 'Trades',
          data: DAYS_BUCKET_ORDER.map(b => counts[b]),
          backgroundColor: DAYS_BUCKET_ORDER.map(b => (b === '45–60' || b === '60–90' || b === '90+') ? '#ff6b6b' : '#3ddc84'),
          borderRadius: 3,
        }],
      },
      options: baseChartOptions({ plugins: { legend: { display: false } } }),
    });
  };
}

function registerAvgDaysPartyChart() {
  chartTitles.avgDaysParty = 'Average days to file, by party';
  chartMakers.avgDaysParty = (canvasId) => {
    const trades = tradesFor('avgDaysParty').filter(t => (t._party === 'R' || t._party === 'D') && t._daysToFile !== null && t._daysToFile >= 0);
    const sums = { R: 0, D: 0 };
    const counts = { R: 0, D: 0 };
    trades.forEach(t => { sums[t._party] += t._daysToFile; counts[t._party]++; });
    const avg = p => counts[p] ? Math.round(sums[p] / counts[p]) : 0;

    return new Chart(document.getElementById(canvasId), {
      type: 'bar',
      data: {
        labels: [PARTY_NAMES.R, PARTY_NAMES.D],
        datasets: [{ label: 'Avg. days to file', data: [avg('R'), avg('D')], backgroundColor: [PARTY_COLORS.R, PARTY_COLORS.D], borderRadius: 3 }],
      },
      options: baseChartOptions({ plugins: { legend: { display: false } } }),
    });
  };
}

function registerAvgDaysChamberChart() {
  chartTitles.avgDaysChamber = 'Average days to file: House vs. Senate';
  chartMakers.avgDaysChamber = (canvasId) => {
    const trades = tradesFor('avgDaysChamber').filter(t => t._daysToFile !== null && t._daysToFile >= 0); // always allTrades
    const sums = { House: 0, Senate: 0 };
    const counts = { House: 0, Senate: 0 };
    trades.forEach(t => { sums[t.chamber] += t._daysToFile; counts[t.chamber]++; });
    const avg = c => counts[c] ? Math.round(sums[c] / counts[c]) : 0;

    return new Chart(document.getElementById(canvasId), {
      type: 'bar',
      data: {
        labels: ['House', 'Senate'],
        datasets: [{ label: 'Avg. days to file', data: [avg('House'), avg('Senate')], backgroundColor: [CHAMBER_COLORS.House, CHAMBER_COLORS.Senate], borderRadius: 3 }],
      },
      options: baseChartOptions({ plugins: { legend: { display: false } } }),
    });
  };
}

function registerVolumeByStateChart() {
  chartTitles.volumeByState = 'Dollar volume by state';
  chartMakers.volumeByState = (canvasId) => {
    const sums = {};
    tradesFor('volumeByState').forEach(t => { sums[t._state] = (sums[t._state] || 0) + t._amountLow; });
    const top = Object.entries(sums).sort((a, b) => b[1] - a[1]).slice(0, 10);

    return new Chart(document.getElementById(canvasId), {
      type: 'bar',
      data: {
        labels: top.map(([s]) => STATE_NAMES[s] || s),
        datasets: [{ label: 'Min. dollar volume', data: top.map(([, v]) => v), backgroundColor: '#f7b955', borderRadius: 3 }],
      },
      options: baseChartOptions({
        indexAxis: 'y',
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => `$${ctx.parsed.x.toLocaleString()}+` } } },
      }),
    });
  };
}

function registerVolumeByTickerChart() {
  chartTitles.volumeByTicker = 'Dollar volume by ticker';
  chartMakers.volumeByTicker = (canvasId) => {
    const sums = {};
    tradesFor('volumeByTicker').forEach(t => { sums[t.ticker] = (sums[t.ticker] || 0) + t._amountLow; });
    const top = Object.entries(sums).sort((a, b) => b[1] - a[1]).slice(0, 10);

    return new Chart(document.getElementById(canvasId), {
      type: 'bar',
      data: {
        labels: top.map(([t]) => t),
        datasets: [{ label: 'Min. dollar volume', data: top.map(([, v]) => v), backgroundColor: '#5eead4', borderRadius: 3 }],
      },
      options: baseChartOptions({
        indexAxis: 'y',
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => `$${ctx.parsed.x.toLocaleString()}+` } } },
      }),
    });
  };
}

function registerMonthlyTotalChart() {
  chartTitles.monthlyTotal = 'Overall trade volume over time';
  chartMakers.monthlyTotal = (canvasId) => {
    const trades = tradesFor('monthlyTotal');
    const months = sortedMonths(trades);
    const perMonth = {};
    trades.forEach(t => { perMonth[t._month] = (perMonth[t._month] || 0) + 1; });

    return new Chart(document.getElementById(canvasId), {
      type: 'line',
      data: {
        labels: months.map(monthLabel),
        datasets: [{
          label: 'Trades',
          data: months.map(m => perMonth[m] || 0),
          borderColor: '#4f9dff',
          backgroundColor: 'rgba(79, 157, 255, 0.15)',
          tension: 0.25,
          pointRadius: 2,
          fill: true,
        }],
      },
      options: baseChartOptions({ plugins: { legend: { display: false } } }),
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
els.analyticsChamberFilter.addEventListener('change', () => {
  populateMemberSelect();
  rebuildAllCharts();
});

els.search.addEventListener('input', applyFilters);
els.stateFilter.addEventListener('change', applyFilters);
els.partyFilter.addEventListener('change', applyFilters);
els.chamberFilter.addEventListener('change', applyFilters);
els.typeFilter.addEventListener('change', applyFilters);
els.minAmountFilter.addEventListener('change', applyFilters);
els.dateFrom.addEventListener('change', applyFilters);
els.dateTo.addEventListener('change', applyFilters);
els.daysToFileFilter.addEventListener('change', applyFilters);
els.sortSelect.addEventListener('change', applyFilters);
els.clearFilters.addEventListener('click', clearFilters);
function goPrevPage() { if (currentPage > 1) { currentPage--; renderTable(); scrollToTable(); } }
function goNextPage() {
  const totalPages = Math.max(1, Math.ceil(filteredTrades.length / PAGE_SIZE));
  if (currentPage < totalPages) { currentPage++; renderTable(); scrollToTable(); }
}
function scrollToTable() {
  document.getElementById('trTable').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
els.prevPage.addEventListener('click', goPrevPage);
els.nextPage.addEventListener('click', goNextPage);
els.prevPageBottom.addEventListener('click', goPrevPage);
els.nextPageBottom.addEventListener('click', goNextPage);

loadData();
