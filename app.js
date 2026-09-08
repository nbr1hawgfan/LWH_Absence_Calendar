// ============================================================================
// CONFIG - fill these in after publishing the three Export_ tabs to the web
// (Google Sheet -> File > Share > Publish to web -> pick the specific tab,
// output CSV). Each tab has a stable URL that doesn't change when the
// export re-runs, unlike a Drive file link.
// ============================================================================
const CONFIG = {
  PTO_REQUESTS_CSV_URL:  'https://docs.google.com/spreadsheets/d/e/2PACX-1vSuPdjvjICInergHmx_qGJF4mI_iYgsrmWeF1nCr-WTdz3jhqG0yZ9LPcL1M9vJWP9i7n-1-JD8Q3xb/pub?gid=491852524&single=true&output=csv',
  EMPLOYEES_CSV_URL:     'https://docs.google.com/spreadsheets/d/e/2PACX-1vSuPdjvjICInergHmx_qGJF4mI_iYgsrmWeF1nCr-WTdz3jhqG0yZ9LPcL1M9vJWP9i7n-1-JD8Q3xb/pub?gid=1288918784&single=true&output=csv',
  ABSENCE_TYPES_CSV_URL: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSuPdjvjICInergHmx_qGJF4mI_iYgsrmWeF1nCr-WTdz3jhqG0yZ9LPcL1M9vJWP9i7n-1-JD8Q3xb/pub?gid=2133598834&single=true&output=csv'
};

const TYPE_COLORS = {
  'Full Day PTO':    'var(--t-full-pto)',
  'Half Day PTO':    'var(--t-half-pto)',
  'Personal Day':    'var(--t-personal-day)',
  'Personal Time':   'var(--t-personal-time)',
  'Call-in':         'var(--t-callin)',
  'Late Unpaid':     'var(--t-late)',
  'Excused Unpaid':  'var(--t-excused)',
  'No Call No Show': 'var(--t-noshow)',
  'Disciplinary':    'var(--t-disciplinary)',
  'Bereavement':     'var(--t-bereavement)',
  'Comp Day':        'var(--t-comp)'
};
function colorFor(type) { return TYPE_COLORS[type] || 'var(--t-other)'; }

// ----------------------------------------------------------------------------
// CSV parsing (RFC4180-ish: handles quoted fields, embedded commas/quotes)
// ----------------------------------------------------------------------------
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else {
        field += c;
      }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\r') { /* skip */ }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else field += c;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

function csvToObjects(text) {
  const rows = parseCsv(text.trim());
  if (rows.length === 0) return [];
  const headers = rows[0];
  return rows.slice(1)
    .filter(r => r.length > 1 || (r[0] !== undefined && r[0] !== ''))
    .map(r => {
      const obj = {};
      headers.forEach((h, idx) => { obj[h] = r[idx] !== undefined ? r[idx] : ''; });
      return obj;
    });
}

// Parses the canonical yyyy-MM-dd text the Export_ tabs always produce.
// No timezone ambiguity here since we build the Date from plain integer
// components rather than parsing a date string with new Date().
function parseIsoDate(s) {
  if (!s) return null;
  const parts = String(s).split('-');
  if (parts.length !== 3) return null;
  const y = parseInt(parts[0], 10), m = parseInt(parts[1], 10), d = parseInt(parts[2], 10);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

function expandBusinessDays(start, end) {
  const days = [];
  if (!start) return days;
  const e = end || start;
  let cur = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const last = new Date(e.getFullYear(), e.getMonth(), e.getDate());
  while (cur <= last) {
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6 && !isMajorHoliday(cur)) days.push(new Date(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}

// Ported from the tracker's own Code.gs isMajorHoliday() - same 6
// company holidays, same logic, so the calendar doesn't show someone
// as "out" on a day nobody was scheduled to work anyway.
function isMajorHoliday(date) {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const dayOfWeek = date.getDay();

  if (month === 1 && day === 1) return true;                                  // New Year's Day
  if (month === 5 && dayOfWeek === 1 && day >= 25 && day <= 31) return true;   // Memorial Day
  if (month === 7 && day === 4) return true;                                  // Independence Day
  if (month === 9 && dayOfWeek === 1 && day >= 1 && day <= 7) return true;     // Labor Day
  if (month === 11 && dayOfWeek === 4 && day >= 22 && day <= 28) return true;  // Thanksgiving
  if (month === 12 && day === 25) return true;                                // Christmas
  return false;
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ----------------------------------------------------------------------------
// State
// ----------------------------------------------------------------------------
let expandedRecords = [];   // {date, dept, name, type, status} - day-by-day, for the calendar
let rawRequests = [];       // {employeeId, dept, name, type, status, daysCount, year} - one per actual request, real DaysCount, for balance lookup
let employeesById = {};     // EmployeeID -> employee row, for the balance lookup tab
let activeTypes = new Set();
let viewYear, viewMonth;    // 0-indexed month, defaults to today
let currentView = 'calendar'; // 'calendar' | 'balances'

const els = {
  loading: document.getElementById('loadingScreen'),
  error: document.getElementById('errorScreen'),
  errorDetail: document.getElementById('errorDetail'),
  app: document.getElementById('app'),
  dataStatus: document.getElementById('dataStatus'),
  dataTimestamp: document.getElementById('dataTimestamp'),
  monthLabel: document.getElementById('monthLabel'),
  deptSelect: document.getElementById('deptSelect'),
  nameSearch: document.getElementById('nameSearch'),
  showPending: document.getElementById('showPending'),
  legend: document.getElementById('legend'),
  summary: document.getElementById('summary'),
  calBody: document.getElementById('calBody'),
  agendaView: document.getElementById('agendaView'),
  dayModal: document.getElementById('dayModal'),
  modalDate: document.getElementById('modalDate'),
  modalBody: document.getElementById('modalBody'),
  modalClose: document.getElementById('modalClose')
};

let lastByDay = {}; // populated each render() - day-of-month -> entries, for modal + agenda lookups

function openDayModal(day) {
  const entries = lastByDay[day];
  if (!entries || !entries.length) return;
  const d = new Date(viewYear, viewMonth, day);
  els.modalDate.textContent = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  els.modalBody.innerHTML = entries
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(e => {
      const suffix = e.status === 'Pending' ? ' (pending)' : '';
      return `<div class="modal-entry">
        <span class="dot" style="background:${colorFor(e.type)}"></span>
        <div class="info"><div class="name">${escapeHtml(e.name)}</div><div class="meta">${escapeHtml(e.dept)} — ${escapeHtml(e.type)}${suffix}</div></div>
      </div>`;
    }).join('');
  els.dayModal.classList.remove('hidden');
}
function closeDayModal() { els.dayModal.classList.add('hidden'); }
els.modalClose.addEventListener('click', closeDayModal);
els.dayModal.addEventListener('click', (e) => { if (e.target === els.dayModal) closeDayModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDayModal(); });

// ----------------------------------------------------------------------------
// Nav tab switching (Calendar / PTO Balances)
// ----------------------------------------------------------------------------
const calendarViewEl = document.getElementById('calendarView');
const balancesViewEl = document.getElementById('balancesView');
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    currentView = btn.dataset.view;
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b === btn));
    calendarViewEl.classList.toggle('hidden', currentView !== 'calendar');
    balancesViewEl.classList.toggle('hidden', currentView !== 'balances');
  });
});

// ----------------------------------------------------------------------------
// PTO Balances tab
// ----------------------------------------------------------------------------
const employeeSelect = document.getElementById('employeeSelect');
const balancesWrap = document.getElementById('balancesWrap');
document.getElementById('printBalanceBtn').addEventListener('click', () => window.print());
employeeSelect.addEventListener('change', () => renderBalanceCard(employeeSelect.value));

function buildEmployeeOptions(empRows) {
  const current = employeeSelect.value;
  const sorted = empRows.slice().sort((a, b) => a.Name.localeCompare(b.Name));
  employeeSelect.innerHTML = '<option value="">Select an employee…</option>' +
    sorted.map(e => `<option value="${escapeHtml(e.EmployeeID)}">${escapeHtml(e.Name)}</option>`).join('');
  if (current && employeesById[current]) {
    employeeSelect.value = current;
    renderBalanceCard(current);
  }
}

function renderBalanceCard(employeeId) {
  if (!employeeId) {
    balancesWrap.innerHTML = '<div class="balance-empty">Pick an employee above to see their current PTO balance and this year\'s absence history.</div>';
    return;
  }
  const emp = employeesById[employeeId];
  if (!emp) return;

  const balance = parseFloat(emp.PTOBalance) || 0;
  const allocation = parseFloat(emp.PTOAllocation) || 0;
  const isLow = balance < 2;
  const isInactive = String(emp.EmployeeStatus).toLowerCase() !== 'active';

  const thisYear = new Date().getFullYear();
  const usage = {};
  rawRequests.forEach(r => {
    if (r.employeeId !== employeeId || r.status !== 'Approved' || r.year !== thisYear) return;
    if (!usage[r.type]) usage[r.type] = { count: 0, days: 0 };
    usage[r.type].count++;
    usage[r.type].days += r.daysCount;
  });
  const usageTypes = Object.keys(usage).sort((a, b) => usage[b].days - usage[a].days);

  const usageHtml = usageTypes.length
    ? usageTypes.map(t => `
        <div class="balance-type-row">
          <span class="type-label"><span class="dot" style="background:${colorFor(t)}"></span>${escapeHtml(t)}</span>
          <span class="stats">${usage[t].count} request${usage[t].count === 1 ? '' : 's'} · ${usage[t].days.toFixed(1)} day${usage[t].days === 1 ? '' : 's'}</span>
        </div>`).join('')
    : `<div class="balance-no-usage">No absences recorded for ${thisYear} yet.</div>`;

  balancesWrap.innerHTML = `
    <div class="balance-card">
      <div class="balance-card-header">
        <div class="name">${escapeHtml(emp.Name)}</div>
        <div class="meta">${escapeHtml(emp.Department || 'Unassigned')} — reports to ${escapeHtml(emp.Manager || 'N/A')}</div>
        ${isInactive ? '<span class="status-tag">INACTIVE</span>' : ''}
      </div>
      <div class="balance-numbers">
        <div class="num-box"><div class="label">Annual Allocation</div><div class="value">${allocation.toFixed(1)}</div></div>
        <div class="num-box ${isLow ? 'low' : ''}"><div class="label">Current Balance</div><div class="value">${balance.toFixed(1)}${isLow ? ' ⚠' : ''}</div></div>
      </div>
      <div class="balance-section-title">${thisYear} Absences by Type</div>
      ${usageHtml}
    </div>
  `;
}

document.getElementById('prevMonth').addEventListener('click', () => { shiftMonth(-1); });
document.getElementById('nextMonth').addEventListener('click', () => { shiftMonth(1); });
document.getElementById('refreshBtn').addEventListener('click', () => loadData(true));
document.getElementById('printBtn').addEventListener('click', () => window.print());
document.getElementById('retryBtn').addEventListener('click', () => loadData(true));
[els.deptSelect, els.showPending].forEach(el => el.addEventListener('change', render));
els.nameSearch.addEventListener('input', render);

function shiftMonth(delta) {
  viewMonth += delta;
  if (viewMonth < 0) { viewMonth = 11; viewYear--; }
  if (viewMonth > 11) { viewMonth = 0; viewYear++; }
  render();
}

// ----------------------------------------------------------------------------
// Data loading
// ----------------------------------------------------------------------------
async function fetchCsv(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' fetching ' + url);
  return csvToObjects(await res.text());
}

async function loadData(isRefresh) {
  els.error.classList.add('hidden');
  els.app.classList.add('hidden');
  els.loading.classList.remove('hidden');
  els.dataStatus.textContent = 'Loading…';

  try {
    const [reqRows, empRows, typeRows] = await Promise.all([
      fetchCsv(CONFIG.PTO_REQUESTS_CSV_URL),
      fetchCsv(CONFIG.EMPLOYEES_CSV_URL),
      fetchCsv(CONFIG.ABSENCE_TYPES_CSV_URL)
    ]);

    const employeesByIdLocal = {};
    empRows.forEach(e => { employeesByIdLocal[e.EmployeeID] = e; });
    employeesById = employeesByIdLocal;

    const activeTypeNames = typeRows
      .filter(t => String(t.Active).toUpperCase() === 'TRUE')
      .map(t => t.AbsenceTypeName);

    const records = [];
    const raw = [];
    reqRows.forEach(r => {
      const status = r.Status;
      if (status !== 'Approved' && status !== 'Pending') return; // skip Denied/Cancelled
      const emp = employeesByIdLocal[r.EmployeeID];
      const dept = emp ? emp.Department : 'Unknown';
      const name = r.EmployeeName || (emp ? emp.Name : 'Unknown');
      const start = parseIsoDate(r.StartDate);
      const end = parseIsoDate(r.EndDate);

      expandBusinessDays(start, end).forEach(d => {
        records.push({ date: d, dept: dept, name: name, type: r.AbsenceType, status: status });
      });

      // Kept separate from the day-expanded records above: this uses the
      // real DaysCount from the request itself (0.5 for a half day, the
      // actual count for a multi-day request), not "one day per weekday
      // in range" - the calendar's expansion would badly overcount usage
      // for a balance-facing number (e.g. a wide date-range request that's
      // really only 2 real days would show as 10).
      if (start) {
        raw.push({
          employeeId: r.EmployeeID, dept: dept, name: name, type: r.AbsenceType,
          status: status, daysCount: parseFloat(r.DaysCount) || 0, year: start.getFullYear()
        });
      }
    });

    expandedRecords = records;
    rawRequests = raw;
    activeTypes = new Set(Object.keys(TYPE_COLORS).concat(activeTypeNames).concat(records.map(r => r.type)));

    buildDeptOptions(empRows);
    buildLegend(activeTypeNames.length ? activeTypeNames : [...new Set(records.map(r => r.type))]);
    buildEmployeeOptions(empRows);

    if (viewYear === undefined) {
      const today = new Date();
      viewYear = today.getFullYear();
      viewMonth = today.getMonth();
    }

    els.dataStatus.textContent = records.length + ' absence days loaded';
    els.dataTimestamp.textContent = 'as of ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    els.loading.classList.add('hidden');
    els.app.classList.remove('hidden');
    render();
  } catch (err) {
    els.loading.classList.add('hidden');
    els.error.classList.remove('hidden');
    els.errorDetail.textContent = err.message || String(err);
  }
}

function buildDeptOptions(empRows) {
  const depts = [...new Set(empRows.map(e => e.Department).filter(Boolean))].sort();
  const current = els.deptSelect.value || 'ALL';
  els.deptSelect.innerHTML = '<option value="ALL">All Departments</option>' +
    depts.map(d => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('');
  els.deptSelect.value = depts.includes(current) ? current : 'ALL';
}

function buildLegend(types) {
  const sorted = [...new Set(types)].sort();
  els.legend.innerHTML = sorted.map(t => `
    <span class="legend-chip" data-type="${escapeHtml(t)}">
      <span class="dot" style="background:${colorFor(t)}"></span>${escapeHtml(t)}
    </span>
  `).join('');
  els.legend.querySelectorAll('.legend-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const t = chip.dataset.type;
      if (activeTypes.has(t)) { activeTypes.delete(t); chip.classList.add('off'); }
      else { activeTypes.add(t); chip.classList.remove('off'); }
      render();
    });
  });
}

// ----------------------------------------------------------------------------
// Render
// ----------------------------------------------------------------------------
function render() {
  const dept = els.deptSelect.value;
  const search = els.nameSearch.value.trim().toLowerCase();
  const includePending = els.showPending.checked;

  const filtered = expandedRecords.filter(r =>
    r.date.getFullYear() === viewYear &&
    r.date.getMonth() === viewMonth &&
    (dept === 'ALL' || r.dept === dept) &&
    activeTypes.has(r.type) &&
    (includePending || r.status === 'Approved') &&
    (!search || r.name.toLowerCase().includes(search))
  );

  const monthDate = new Date(viewYear, viewMonth, 1);
  els.monthLabel.textContent = monthDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const uniqueNames = new Set(filtered.map(r => r.name));
  els.summary.innerHTML = `<strong>${filtered.length}</strong> absence day${filtered.length === 1 ? '' : 's'} across <strong>${uniqueNames.size}</strong> employee${uniqueNames.size === 1 ? '' : 's'} this month.`;

  const byDay = {};
  filtered.forEach(r => {
    const key = r.date.getDate();
    (byDay[key] = byDay[key] || []).push(r);
  });
  lastByDay = byDay;

  const firstOfMonth = new Date(viewYear, viewMonth, 1);
  const startDow = firstOfMonth.getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const gridStart = new Date(viewYear, viewMonth, 1 - startDow);
  const today = new Date();
  const totalCells = Math.ceil((startDow + daysInMonth) / 7) * 7;

  let html = '';
  let cursor = new Date(gridStart);
  for (let i = 0; i < totalCells; i++) {
    if (i % 7 === 0) html += '<tr>';
    const inMonth = cursor.getMonth() === viewMonth;
    const isWeekend = cursor.getDay() === 0 || cursor.getDay() === 6;
    const isToday = cursor.getFullYear() === today.getFullYear() && cursor.getMonth() === today.getMonth() && cursor.getDate() === today.getDate();
    const dayEntries = inMonth ? (byDay[cursor.getDate()] || []) : [];

    let cls = [];
    if (!inMonth) cls.push('outside');
    if (isWeekend) cls.push('weekend');
    if (isToday) cls.push('today');
    if (inMonth && dayEntries.length) cls.push('has-entries');

    const dayAttr = inMonth ? ` data-day="${cursor.getDate()}"` : '';
    html += `<td class="${cls.join(' ')}"${dayAttr}>`;
    html += `<div class="daynum"><span>${cursor.getDate()}</span><span class="count ${dayEntries.length ? '' : 'zero'}">${dayEntries.length}</span></div>`;

    if (dayEntries.length) {
      dayEntries.sort((a, b) => a.name.localeCompare(b.name)).forEach(e => {
        const pendingCls = e.status === 'Pending' ? ' pending' : '';
        const suffix = e.status === 'Pending' ? ' (pending)' : '';
        html += `<div class="entry${pendingCls}"><span class="dot" style="background:${colorFor(e.type)}"></span><span class="name">${escapeHtml(e.name)}</span> — <span class="type">${escapeHtml(e.type)}${suffix}</span></div>`;
      });
    } else if (inMonth && !isWeekend) {
      html += '<div class="empty-cell-hint">—</div>';
    }

    html += '</td>';
    if (i % 7 === 6) html += '</tr>';
    cursor.setDate(cursor.getDate() + 1);
  }
  els.calBody.innerHTML = html;
  els.calBody.querySelectorAll('td.has-entries').forEach(td => {
    td.addEventListener('click', () => openDayModal(parseInt(td.dataset.day, 10)));
  });

  renderAgenda(byDay, today);
}

// Mobile agenda view: a scannable list of only the days that actually
// have someone out, rather than a cramped 7-column grid that doesn't
// work well on a phone.
function renderAgenda(byDay, today) {
  const dayNumbers = Object.keys(byDay).map(Number).sort((a, b) => a - b);

  if (dayNumbers.length === 0) {
    els.agendaView.innerHTML = '<div class="agenda-empty">No absences matching the current filters this month.</div>';
    return;
  }

  els.agendaView.innerHTML = dayNumbers.map(day => {
    const d = new Date(viewYear, viewMonth, day);
    const isToday = d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
    const entries = byDay[day].slice().sort((a, b) => a.name.localeCompare(b.name));
    const dateLabel = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

    const entryHtml = entries.map(e => {
      const pendingCls = e.status === 'Pending' ? ' pending' : '';
      const suffix = e.status === 'Pending' ? ' (pending)' : '';
      return `<div class="agenda-entry${pendingCls}">
        <span class="dot" style="background:${colorFor(e.type)}"></span>
        <div><div class="name">${escapeHtml(e.name)}</div><div class="meta">${escapeHtml(e.dept)} — ${escapeHtml(e.type)}${suffix}</div></div>
      </div>`;
    }).join('');

    return `<div class="agenda-day${isToday ? ' today' : ''}">
      <div class="agenda-day-header"><span class="date">${dateLabel}</span><span class="count">${entries.length}</span></div>
      <div class="agenda-entry-list">${entryHtml}</div>
    </div>`;
  }).join('');
}

loadData(false);
