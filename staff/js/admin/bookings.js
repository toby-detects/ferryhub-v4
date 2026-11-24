/* Booking Records controller. Data comes only from AdminAPI.getBookings(); filtering, sorting and paging happen here. */
(() => {
  const $ = id => document.getElementById(id), peso = v => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(v);
  const st = { all: [], skipped: 0, q: '', status: '', port: '', from: '', to: '', key: 'registeredAt', dir: -1, page: 1, size: 10, load: 'loading' };
  const COLS = [['regNo', 'Registration No.'], ['pax', 'Pax'], ['port', 'Port'], ['sched', 'Schedule'], ['registeredAt', 'Registration date'], ['totalFee', 'Total fee'], ['status', 'Status'], ['', 'Details']];
  const when = iso => new Date(/T\d\d:\d\d(:\d\d(\.\d+)?)?$/.test(iso) ? iso + '+08:00' : iso);
  const regLabel = b => { const p = Time.parts(when(b.registeredAt)); return `${Time.shortDate(b.regDay)} | ${Time.label(p.hour + ':' + p.minute)}`; };
  const feeLabel = b => b.feeMissing ? (b.totalFee > 0 ? peso(b.totalFee) + ' *' : 'Not set') : peso(b.totalFee);
  const schedLabel = b => `${Time.shortDate(b.departDate)} | ${Time.label(b.departTime)}`;
  const val = (b, k) => k === 'sched' ? b.departDate + ' ' + b.departTime : k === 'registeredAt' ? +when(b.registeredAt) : b[k];

  function head() {
    $('thead').innerHTML = COLS.map(([k, l]) => !k ? `<th scope="col">${l}</th>` :
      `<th scope="col" aria-sort="${st.key === k ? (st.dir > 0 ? 'ascending' : 'descending') : 'none'}"><button data-k="${k}">${l}<span aria-hidden="true">${st.key === k ? (st.dir > 0 ? '▲' : '▼') : ''}</span></button></th>`).join('');
  }
  function filtered() {
    const q = st.q.trim().toLowerCase();
    return st.all.filter(b => (!st.status || b.status === st.status) && (!st.port || b.port === st.port) &&
      (!st.from || b.departDate >= st.from) && (!st.to || b.departDate <= st.to) &&
      (!q || b.regNo.toLowerCase().includes(q) || String(b.port || '').toLowerCase().includes(q)))
      .sort((a, b) => { const x = val(a, st.key), y = val(b, st.key); return (x > y ? 1 : x < y ? -1 : 0) * st.dir; });
  }
  function setState(html) { const s = $('state'); s.hidden = !html; s.innerHTML = html || ''; }
  function render() {
    head();
    if (st.load === 'loading') { $('rows').innerHTML = ''; $('pager').hidden = true; return setState('<b>Loading booking records…</b>'); }
    if (st.load === 'error') { $('rows').innerHTML = ''; $('pager').hidden = true; return setState('<b>Could not load booking records.</b><button class="linkbtn" id="retry" type="button">Try again</button>'); }
    if (!st.all.length) { $('rows').innerHTML = ''; $('pager').hidden = true; return setState('<b>No booking records yet</b>Records appear here automatically as passengers register.'); }
    const rows = filtered(), pages = Math.max(1, Math.ceil(rows.length / st.size)); st.page = Math.min(st.page, pages);
    const from = (st.page - 1) * st.size, slice = rows.slice(from, from + st.size);
    $('rows').innerHTML = slice.map(b => `<tr><td class="rn">${UI.esc(b.regNo)}</td><td>${b.pax}</td><td>${UI.esc(b.port || '—')}</td><td>${schedLabel(b)}</td><td>${regLabel(b)}</td><td>${feeLabel(b)}</td>
      <td><span class="badge s-${b.status.toLowerCase()}">${b.status}</span></td><td><button class="linkbtn" data-id="${UI.esc(b.regNo)}" aria-label="View details for ${UI.esc(b.regNo)}">View</button></td></tr>`).join('');
    setState(rows.length ? '' : '<b>No bookings match your search or filters</b>Try a different search or press Reset.');
    $('pager').hidden = !rows.length;
    $('count').textContent = rows.length ? `Showing ${from + 1}-${from + slice.length} of ${rows.length}` : '';
    $('pg').textContent = `Page ${st.page} of ${pages}`; $('prev').disabled = st.page <= 1; $('next').disabled = st.page >= pages;
  }
  function detail(b) {
    const kv = [['Registration No.', UI.esc(b.regNo)], ['Status', `<span class="badge s-${b.status.toLowerCase()}">${b.status}</span>`], ['Passengers', b.pax], ['Port', UI.esc(b.port || '—')],
      ['Schedule', schedLabel(b)], ['Registered', regLabel(b)], ['Total fee', feeLabel(b)]];
    const ps = Array.isArray(b.passengers) && b.passengers.length ? `<div style="padding:0 1.4rem 1.2rem"><table class="mini"><thead><tr><th>Passenger category</th><th>Fare</th></tr></thead><tbody>${b.passengers.map(p => `<tr><td>${UI.esc(p.category)}</td><td>${p.fare == null ? 'Not set' : peso(p.fare)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="hint" style="padding:0 1.4rem 1.2rem">No per-passenger breakdown is recorded for this booking.</p>';
    $('dt').textContent = 'Booking ' + b.regNo;
    $('dbody').innerHTML = `<dl class="kv">${kv.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>${ps}`;
    $('dlg').showModal();
  }
  async function load() {
    st.load = 'loading'; render();
    try {
      const c = Analytics.clean(await AdminAPI.getBookings()); st.all = c.rows; st.skipped = c.skipped; st.load = 'ready';
      $('fp').innerHTML = '<option value="">All ports</option>' + [...new Set(st.all.map(b => b.port).filter(Boolean))].sort().map(p => `<option>${UI.esc(p)}</option>`).join('');
      $('skipNote').hidden = !st.skipped; $('skipNote').textContent = `${st.skipped} record${st.skipped === 1 ? ' was' : 's were'} skipped because of missing or invalid data or a repeated Booking ID.`;
    } catch (e) { console.error(e); st.load = 'error'; }
    render();
  }

  $('q').oninput = e => { st.q = e.target.value; st.page = 1; render(); };
  $('pills').onclick = e => { const b = e.target.closest('[data-s]'); if (!b) return; st.status = b.dataset.s; st.page = 1; document.querySelectorAll('.pill').forEach(p => p.setAttribute('aria-pressed', String(p === b))); render(); };
  $('fp').onchange = e => { st.port = e.target.value; st.page = 1; render(); };
  $('ff').onchange = e => { st.from = e.target.value; st.page = 1; render(); };
  $('ft').onchange = e => { st.to = e.target.value; st.page = 1; render(); };
  $('reset').onclick = () => { Object.assign(st, { q: '', status: '', port: '', from: '', to: '', page: 1 }); $('q').value = $('fp').value = $('ff').value = $('ft').value = ''; document.querySelectorAll('.pill').forEach(p => p.setAttribute('aria-pressed', String(p.dataset.s === ''))); render(); };
  $('thead').onclick = e => { const b = e.target.closest('[data-k]'); if (!b) return; st.dir = st.key === b.dataset.k ? -st.dir : 1; st.key = b.dataset.k; render(); };
  $('size').onchange = e => { st.size = +e.target.value; st.page = 1; render(); };
  $('prev').onclick = () => { st.page--; render(); }; $('next').onclick = () => { st.page++; render(); };
  $('state').onclick = e => { if (e.target.id === 'retry') load(); };
  $('rows').onclick = e => { const b = e.target.closest('[data-id]'); if (b) detail(st.all.find(x => x.regNo === b.dataset.id)); };
  $('x').onclick = $('close').onclick = () => $('dlg').close();
  load();
})();
