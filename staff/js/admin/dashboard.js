/* Dashboard controller: reads filters, asks AdminAPI for records, asks Analytics/Forecast for numbers,
   asks Charts for markup, and writes it to the page. No queries or maths live here. */
(() => {
  const $ = id => document.getElementById(id), C = Charts;
  const st = { tab: 'overall', period: 'month', anchor: Time.today(), from: '', to: '', horizon: 6, rows: [], skipped: 0, state: 'loading' };
  const empty = (title, msg) => `<div class="chart-empty"><div><b>${title}</b>${msg}</div></div>`;
  const card = (title, sub, body) => `<article class="cardp"><h2>${title}</h2><p class="sub">${sub}</p>${body}</article>`;
  const legendLine = items => `<div class="legend">${items.map(i => `<span><i class="sw ${i.dash ? 'dash' : ''}" style="color:${i.color}"></i>${i.label}</span>`).join('')}</div>`;

  /* ---------- filters ---------- */
  function range() {
    const r = Analytics.range(st.period, st.anchor, st.from, st.to), err = $('filterErr');
    const msg = st.period === 'custom' && !r ? (st.from && st.to ? 'The start date must be on or before the end date.' : 'Choose a start and end date.') : (!r ? 'Choose a date.' : '');
    err.hidden = !msg; err.textContent = msg; return r;
  }
  function syncFilterUI() {
    const custom = st.period === 'custom';
    $('anchorWrap').hidden = custom; $('fromWrap').hidden = !custom; $('toWrap').hidden = !custom;
    $('anchorLabel').textContent = { week: 'Week of', month: 'Month of', year: 'Year of' }[st.period] || '';
  }

  /* ---------- panels ---------- */
  const fmtDelta = c => c == null ? '<span class="delta">No prior data</span>' : `<span class="delta ${c > 0 ? 'up' : c < 0 ? 'down' : ''}">${c > 0 ? '▲' : c < 0 ? '▼' : ''} ${Math.abs(c).toFixed(1)}%</span>`;
  function overall(r) {
    const a = Analytics.kpis(st.rows, r), b = Analytics.kpis(st.rows, Analytics.prevRange(r));
    const k = (title, now, prev, f) => `<div class="kpi"><h2>${title}</h2><div class="val"><span class="num">${f(now)}</span>${fmtDelta(Analytics.change(now, prev))}</div><p class="prev">${f(prev)} previous period</p></div>`;
    return `<div class="kpis">${k('Total Bookings', a.bookings, b.bookings, C.int)}${k('Total Passengers', a.passengers, b.passengers, C.int)}${k('Total Revenue', a.revenue, b.revenue, C.peso)}</div>`;
  }
  function trends(r) {
    const months = Analytics.monthWindow(r), counts = Analytics.monthlyBookings(st.rows, months), has = counts.some(v => v > 0);
    const note = months.length ? `${Analytics.monthLabel(months[0])} to ${Analytics.monthLabel(months.at(-1))}` : '';
    const line = has ? C.line({ labels: months.map(Analytics.monthLabel), series: [{ name: 'Bookings', values: counts, color: C.C.line }], yTitle: 'Bookings' }) : empty('No bookings in this period', 'The line chart appears once booking records exist for these months.');
    const hm = Analytics.heatmap(st.rows, months);
    const heat = hm.max > 0 ? `<div class="heatwrap">${C.heatmap(hm)}</div>${C.heatLegend(hm.max)}` : empty('No bookings in this period', 'Each cell is one day; darker cells mean more bookings.');
    const d = Analytics.demandBySlot(st.rows, r), lvl = { High: C.ramp(1), Medium: C.ramp(.6), Low: C.ramp(.25) };
    const top = d.slots.slice().sort((x, y) => y.passengers - x.passengers)[0];
    const sched = d.slots.length ? C.bar({ bars: d.slots.map(s => ({ label: Time.label(s.time), value: s.passengers, color: lvl[s.level], note: s.level + ' demand' })), yTitle: 'Passengers' })
      + `<div class="legend">${['High', 'Medium', 'Low'].map(l => `<span><i class="dot" style="background:${lvl[l]}"></i>${l} demand</span>`).join('')}<span>Most used: <b>${Time.label(top.time)}</b> (${C.int(top.passengers)} passengers)</span></div>`
      : empty('No departures in this period', 'Passenger demand per departure time appears once bookings exist for the selected dates.');
    return card('Monthly Booking Trends', 'Bookings registered per month. ' + note, line) + card('Monthly Heatmap', 'Bookings registered per day, one row per month. ' + note, heat)
      + card('Frequently Utilized Schedule', 'Passengers per departure time, for departures in the selected period.', sched);
  }
  function predict() {
    const ctl = `<div class="field" style="max-width:220px;margin-bottom:.8rem"><label for="hz">Forecast horizon</label><select id="hz">${[3, 6, 12].map(n => `<option value="${n}" ${n === st.horizon ? 'selected' : ''}>${n} months</option>`).join('')}</select></div>`;
    const res = Forecast.run(Analytics.historicalMonthly(st.rows), st.horizon);
    if (res.status !== 'ok') {
      const why = res.have === 0 ? 'There is no booking history yet.' : `Only ${res.have} complete month${res.have === 1 ? '' : 's'} of history; at least ${res.need} are needed.`;
      return card('Actual vs. Predicted Monthly Bookings', 'k-Nearest Neighbors regression forecast.', ctl + empty('Predictive analytics is not available yet', why + ' Forecasts will appear once enough booking history is provided.'))
        + card('Model Evaluation', 'Accuracy on the most recent months held out for testing.', empty('No evaluation yet', 'MAE and RMSE are calculated once a model can be trained.'));
    }
    const hist = res.history.slice(-36), n = hist.length, labels = [...hist.map(p => p.month), ...res.forecast.map(p => p.month)].map(Analytics.monthLabel);
    const actual = [...hist.map(p => p.value), ...res.forecast.map(() => null)];
    const pred = [...hist.map((p, i) => i === n - 1 ? p.value : null), ...res.forecast.map(p => p.value)];
    const chart = C.line({ labels, forecastFrom: n, yTitle: 'Bookings', series: [{ name: 'Actual', values: actual, color: C.C.line }, { name: 'Predicted', values: pred, color: C.C.forecast, dashed: true }] })
      + legendLine([{ label: 'Actual (historical)', color: C.C.line }, { label: 'Predicted (forecast)', color: C.C.forecast, dash: true }]);
    const m = res.metrics, f1 = v => v.toFixed(1);
    const metrics = `<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr))">
      <div class="metric"><span>Mean Absolute Error (MAE)</span><b>${f1(m.mae)}</b><small>bookings per month</small></div>
      <div class="metric"><span>Root Mean Squared Error (RMSE)</span><b>${f1(m.rmse)}</b><small>bookings per month</small></div></div>
      <p class="hint" style="margin-top:.8rem">k-NN regression with k = ${m.k}, using the previous ${res.window} months plus month of year. Trained on the first ${m.trainMonths} months and tested on the most recent ${m.testMonths}. Lower is better.</p>`;
    return card('Actual vs. Predicted Monthly Bookings', 'Uses all complete months of history. The date filter does not apply here.', ctl + chart) + card('Model Evaluation', 'Accuracy on the most recent months held out for testing.', metrics);
  }
  function revenue(r) {
    const months = Analytics.monthWindow(r), rev = Analytics.monthlyRevenue(st.rows, months), has = rev.some(v => v > 0);
    const line = has ? C.line({ labels: months.map(Analytics.monthLabel), series: [{ name: 'Revenue', values: rev, color: C.C.line }], fmt: C.pesoShort, yTitle: 'Revenue (₱)', integer: false }) : empty('No revenue in this period', 'Monthly revenue appears once paid bookings exist for these months.');
    const cat = Analytics.revenueByCategory(st.rows, r);
    let bars = cat.rows.length ? C.bar({ bars: cat.rows.map(c => ({ label: c.category, value: c.revenue, color: C.C.line })), fmt: C.pesoShort, yTitle: 'Revenue (₱)', integer: false })
      + `<table class="mini" style="margin-top:.8rem"><thead><tr><th>Passenger category</th><th>Revenue</th></tr></thead><tbody>${cat.rows.map(c => `<tr><td>${Charts.esc(c.category)}</td><td>${C.peso(c.revenue)}</td></tr>`).join('')}</tbody></table>`
      : empty('No category revenue in this period', 'Revenue by passenger category appears once Verified bookings have fares. Set fares under Fares.');
    if (cat.unclassified) bars += `<p class="hint" style="margin-top:.6rem">${cat.unclassified} booking${cat.unclassified === 1 ? '' : 's'} had no per-passenger fare breakdown and ${cat.unclassified === 1 ? 'is' : 'are'} not included in this chart.</p>`;
    return card('Monthly Revenue Trends', 'Revenue from Verified bookings (fares paid and verified at the ticketing station), per month.', line) + card('Passenger Category Revenue Distribution', 'Fares recorded per passenger, for Verified bookings registered in the selected period.', bars);
  }

  /* ---------- render ---------- */
  function render() {
    const r = range(), n = $('notice'), P = id => $('p-' + id);
    syncFilterUI();
    if (st.state === 'loading') { n.innerHTML = ''; ['overall', 'trends', 'predict', 'revenue'].forEach(id => { P(id).innerHTML = '<div class="skeleton" aria-busy="true"></div>'; }); return; }
    if (st.state === 'error') { n.innerHTML = '<p class="dash-note" role="alert">Could not load booking data. <button class="linkbtn" id="retry" type="button">Try again</button></p>'; $('retry').onclick = load; ['overall', 'trends', 'predict', 'revenue'].forEach(id => { P(id).innerHTML = ''; }); return; }
    const msgs = [];
    if (!st.rows.length) msgs.push('No bookings have been registered yet, so the charts are empty. They fill in automatically as passengers register.');
    const unpriced = st.rows.filter(b => b.feeMissing).length;
    if (unpriced) msgs.push(`${unpriced} booking${unpriced === 1 ? ' has' : 's have'} no fare recorded because fares were not set when ${unpriced === 1 ? 'it was' : 'they were'} registered, so ${unpriced === 1 ? 'its' : 'their'} revenue counts as zero. <a href="admin-fares.html">Set fares</a> and apply them to earlier registrations.`);
    if (st.skipped) msgs.push(`${st.skipped} record${st.skipped === 1 ? ' was' : 's were'} skipped because of missing or invalid data or a repeated Booking ID.`);
    n.innerHTML = msgs.map(m => `<p class="dash-note">${m}</p>`).join('');
    $('rangeText').textContent = r ? (r.start === r.end ? Time.longDate(r.start) : `${Time.shortDate(r.start)} to ${Time.shortDate(r.end)} (Manila time)`) : 'Choose a valid date range.';
    const noRange = empty('Choose a valid date range', 'Pick dates above to see this section.');
    P('overall').innerHTML = r ? overall(r) : noRange;
    P('trends').innerHTML = r ? trends(r) : noRange;
    P('predict').innerHTML = predict();
    P('revenue').innerHTML = r ? revenue(r) : noRange;
  }
  $('p-predict').onchange = e => { if (e.target.id !== 'hz') return; st.horizon = +e.target.value; $('p-predict').innerHTML = predict(); $('hz').focus(); };

  async function load() {
    st.state = 'loading'; render();
    try { const c = Analytics.clean(await AdminAPI.getBookings()); st.rows = c.rows; st.skipped = c.skipped; st.state = 'ready'; }
    catch (e) { console.error(e); st.state = 'error'; }
    render();
  }

  /* ---------- events ---------- */
  const tabs = [...document.querySelectorAll('.tab')];
  function show(id, focus) {
    st.tab = id;
    tabs.forEach(t => { const on = t.dataset.tab === id; t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1; if (on && focus) t.focus(); });
    ['overall', 'trends', 'predict', 'revenue'].forEach(p => { $('p-' + p).hidden = p !== id; });
  }
  tabs.forEach((t, i) => {
    t.onclick = () => show(t.dataset.tab);
    t.onkeydown = e => { const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0; if (d) { e.preventDefault(); show(tabs[(i + d + tabs.length) % tabs.length].dataset.tab, true); } };
  });
  $('period').onchange = e => { st.period = e.target.value; render(); };
  $('anchor').onchange = e => { st.anchor = e.target.value; render(); };
  $('from').onchange = e => { st.from = e.target.value; render(); };
  $('to').onchange = e => { st.to = e.target.value; render(); };
  $('refresh').onclick = async () => { await load(); UI.toast('Dashboard data refreshed.', 'ok'); };
  $('anchor').value = st.anchor; show('overall'); load();
})();
