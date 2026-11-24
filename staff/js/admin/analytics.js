/* Aggregation layer: pure functions, no DOM, no storage. Input is the raw booking list from AdminAPI.
   All dates are Manila (Asia/Manila) calendar dates written as 'YYYY-MM-DD' keys so the frontend and a future
   backend cut weeks, months and years at the same boundaries. */
const Analytics = {
  /* ---------- date helpers (UTC arithmetic on date keys; no local-timezone drift) ---------- */
  dt: key => { const [y, m, d] = key.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); },
  key: d => d.toISOString().slice(0, 10),
  addDays(key, n) { const d = Analytics.dt(key); d.setUTCDate(d.getUTCDate() + n); return Analytics.key(d); },
  addMonths(mk, n) { const [y, m] = mk.split('-').map(Number), d = new Date(Date.UTC(y, m - 1 + n, 1)); return d.toISOString().slice(0, 7); },
  monthsBetween(a, b) { const out = []; for (let m = a; m <= b; m = Analytics.addMonths(m, 1)) out.push(m); return out; },
  daysInMonth(mk) { const [y, m] = mk.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); },
  monthLabel(mk) { const [y, m] = mk.split('-').map(Number); return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', year: '2-digit' }); },
  monthLong(mk) { const [y, m] = mk.split('-').map(Number); return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' }); },
  /* Manila date key of an ISO timestamp. A timestamp with no offset is read as Manila time. */
  phtKey(iso) {
    let s = String(iso); if (/T\d\d:\d\d(:\d\d(\.\d+)?)?$/.test(s)) s += '+08:00';
    const d = new Date(s); if (isNaN(d)) return null;
    const p = Time.parts(d); return `${p.year}-${p.month}-${p.day}`;
  },

  /* ---------- period filter ---------- */
  /* period: 'week' (Mon-Sun) | 'month' | 'year' | 'custom'; anchor/from/to are date keys. Returns inclusive { start, end }. */
  range(period, anchor, from, to) {
    if (period === 'custom') { return from && to && from <= to ? { start: from, end: to, period } : null; }
    if (!anchor) return null;
    if (period === 'week') { const dow = (Analytics.dt(anchor).getUTCDay() + 6) % 7, start = Analytics.addDays(anchor, -dow); return { start, end: Analytics.addDays(start, 6), period }; }
    if (period === 'month') { const mk = anchor.slice(0, 7); return { start: mk + '-01', end: mk + '-' + String(Analytics.daysInMonth(mk)).padStart(2, '0'), period }; }
    const y = anchor.slice(0, 4); return { start: y + '-01-01', end: y + '-12-31', period };
  },
  prevRange(r) {
    if (r.period === 'month') return Analytics.range('month', Analytics.addMonths(r.start.slice(0, 7), -1) + '-01');
    if (r.period === 'year') return Analytics.range('year', (+r.start.slice(0, 4) - 1) + '-01-01');
    const len = Math.round((Analytics.dt(r.end) - Analytics.dt(r.start)) / 864e5) + 1, end = Analytics.addDays(r.start, -1);
    return { start: Analytics.addDays(end, -(len - 1)), end, period: r.period };
  },

  /* ---------- cleaning ---------- */
  /* Drops invalid and duplicate records; keeps only the first record of a repeated regNo so nothing is double-counted. */
  clean(rows) {
    const seen = new Set(), ok = []; let skipped = 0;
    for (const b of Array.isArray(rows) ? rows : []) {
      const key = b && typeof b.regNo === 'string' ? b.regNo.trim() : '';
      const regDay = b ? Analytics.phtKey(b.registeredAt) : null;
      const valid = key && !seen.has(key) && regDay && Number.isInteger(b.pax) && b.pax >= 1 && Number.isFinite(b.totalFee) && b.totalFee >= 0 && BOOKING_STATUSES.includes(b.status);
      if (!valid) { skipped++; continue; }
      seen.add(key); ok.push({ ...b, regNo: key, regDay });
    }
    return { rows: ok, skipped };
  },
  counted: rows => rows.filter(b => COUNTED_STATUSES.includes(b.status)),
  paid: rows => rows.filter(b => REVENUE_STATUSES.includes(b.status)),
  inRange: (rows, r) => rows.filter(b => b.regDay >= r.start && b.regDay <= r.end),

  /* ---------- KPIs ---------- */
  kpis(rows, r) {
    const set = Analytics.inRange(Analytics.counted(rows), r);
    return { bookings: set.length, passengers: set.reduce((s, b) => s + b.pax, 0), revenue: Analytics.inRange(Analytics.paid(rows), r).reduce((s, b) => s + b.totalFee, 0) };
  },
  /* % change versus the previous period, or null when the previous period had nothing to compare against. */
  change: (now, prev) => prev > 0 ? ((now - prev) / prev) * 100 : null,

  /* ---------- monthly series ---------- */
  /* Months shown by the monthly charts: the months of the filter range up to the current month (future months are
     never plotted as zeros), or the 12 months ending at the range end when that covers fewer than 3 months.
     Capped at the last 24 months. */
  monthWindow(r) {
    const now = Time.today().slice(0, 7), endM = r.end.slice(0, 7) < now ? r.end.slice(0, 7) : now, startM = r.start.slice(0, 7);
    let months = startM <= endM ? Analytics.monthsBetween(startM, endM) : [];
    if (months.length < 3) months = Analytics.monthsBetween(Analytics.addMonths(endM, -11), endM);
    return months.slice(-24);
  },
  monthlyBookings(rows, months) { const c = Object.fromEntries(months.map(m => [m, 0])); Analytics.counted(rows).forEach(b => { const m = b.regDay.slice(0, 7); if (m in c) c[m]++; }); return months.map(m => c[m]); },
  monthlyRevenue(rows, months) { const c = Object.fromEntries(months.map(m => [m, 0])); Analytics.paid(rows).forEach(b => { const m = b.regDay.slice(0, 7); if (m in c) c[m] += b.totalFee; }); return months.map(m => c[m]); },
  /* Heatmap: one row per month, one column per day of month, value = bookings registered that day. */
  heatmap(rows, months) {
    const grid = Object.fromEntries(months.map(m => [m, Array(31).fill(0)]));
    Analytics.counted(rows).forEach(b => { const m = b.regDay.slice(0, 7); if (m in grid) grid[m][+b.regDay.slice(8) - 1]++; });
    const matrix = months.map(m => grid[m]);
    return { months, matrix, max: Math.max(0, ...matrix.flat()) };
  },

  /* ---------- schedule demand ---------- */
  /* Passengers per departure time. The ferry runs fixed departure times, so each distinct time is one slot.
     Level is relative to the busiest slot: high >= 67%, medium >= 34%, otherwise low. */
  demandBySlot(rows, r) {
    const by = {};
    Analytics.counted(rows).filter(b => b.departDate >= r.start && b.departDate <= r.end && /^\d\d:\d\d$/.test(b.departTime || ''))
      .forEach(b => { by[b.departTime] = (by[b.departTime] || 0) + b.pax; });
    const slots = Object.keys(by).sort().map(t => ({ time: t, passengers: by[t] })), max = Math.max(0, ...slots.map(s => s.passengers));
    slots.forEach(s => { const f = s.passengers / max; s.level = f >= .67 ? 'High' : f >= .34 ? 'Medium' : 'Low'; });
    return { slots, max };
  },

  /* ---------- revenue by passenger category ---------- */
  /* Uses each passenger's recorded fare (so discounts are respected). Bookings without a passengers[] breakdown
     cannot be split by category and are reported in `unclassified` instead of guessed. */
  revenueByCategory(rows, r) {
    const set = Analytics.inRange(Analytics.paid(rows), r), by = {}; let unclassified = 0;
    set.forEach(b => {
      if (!Array.isArray(b.passengers) || !b.passengers.length) { unclassified++; return; }
      b.passengers.forEach(p => { if (p && p.category && Number.isFinite(p.fare)) by[p.category] = (by[p.category] || 0) + p.fare; });
    });
    return { rows: Object.entries(by).map(([category, revenue]) => ({ category, revenue })).sort((a, b) => b.revenue - a.revenue), unclassified };
  },

  /* ---------- history for the forecast ---------- */
  /* Complete months only: first booking month up to the last month that has ended (and has data). Gaps are zero. */
  historicalMonthly(rows) {
    const set = Analytics.counted(rows); if (!set.length) return [];
    const first = set.map(b => b.regDay.slice(0, 7)).sort()[0], last = set.map(b => b.regDay.slice(0, 7)).sort().pop();
    const thisMonth = Time.today().slice(0, 7), lastDone = Analytics.addMonths(thisMonth, -1), end = last < lastDone ? last : lastDone;
    if (end < first) return [];
    const months = Analytics.monthsBetween(first, end), counts = Analytics.monthlyBookings(rows, months);
    return months.map((month, i) => ({ month, value: counts[i] }));
  }
};
