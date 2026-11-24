(() => {
  const $ = id => document.getElementById(id);
  let data = [], cur = null;
  const st = { q: '', cat: '', cls: '', status: '', key: 'registered_at', dir: -1 };
  const COLS = [['', 'Edit'], ['reg_no', 'Registration No.', 1], ['full_name', 'Full Name', 1], ['age', 'Age'], ['address', 'Address'], ['email', 'Email'], ['classification', 'Local or Tourist'], ['category', 'Category'], ['dep', 'Departure', 1], ['status', 'Status'], ['', 'ID']];
  const addr = p => [p.street, p.barangay_name, p.city_name, p.province_name].filter(Boolean).join(', ');
  const dep = p => p.travel_date + ' ' + p.depart_time;
  $('fc').innerHTML += CATEGORIES.map(c => `<option>${c}</option>`).join('');
  $('fk').innerHTML += CLASSES.map(c => `<option>${c}</option>`).join('');
  $('cat').innerHTML = '<option value="">Select</option>' + CATEGORIES.map(c => `<option>${c}</option>`).join('');
  $('cl').innerHTML = '<option value="">Select</option>' + CLASSES.map(c => `<option>${c}</option>`).join('');

  function head() {
    $('thead').innerHTML = COLS.map(([k, l, s]) => {
      if (!k) return `<th scope="col"><span class="${l === 'Edit' ? 'sr' : ''}">${l === 'Edit' ? l : l}</span></th>`;
      const on = st.key === k, sort = on ? (st.dir > 0 ? 'ascending' : 'descending') : 'none';
      return `<th scope="col" aria-sort="${s ? sort : 'none'}">${s ? `<button data-k="${k}">${l}<span aria-hidden="true">${on ? (st.dir > 0 ? '▲' : '▼') : ''}</span></button>` : l}</th>`;
    }).join('');
  }
  function render() {
    const q = st.q.toLowerCase();
    const rows = data.filter(p => (!st.cat || p.category === st.cat) && (!st.cls || p.classification === st.cls) && (!st.status || p.status === st.status) &&
      (!q || [p.full_name, p.reg_no, addr(p), p.email || ''].some(x => x.toLowerCase().includes(q))))
      .sort((a, b) => { const g = p => st.key === 'dep' ? dep(p) : p[st.key]; const x = g(a), y = g(b); return (x > y ? 1 : x < y ? -1 : 0) * st.dir; });
    head();
    $('rows').innerHTML = rows.map(p => `<tr>
      <td><button class="iconbtn" data-id="${p.id}" aria-label="Edit ${UI.esc(p.full_name)}"><img src="../assets/icons/edit.png" alt=""></button></td>
      <td class="rn">${UI.esc(p.reg_no)}<br><small>#${p.position}</small></td><td>${UI.esc(p.full_name)}</td><td>${p.age}</td><td>${UI.esc(addr(p))}</td><td>${UI.esc(p.email || '—')}</td>
      <td><span class="badge neutral">${p.classification}</span></td><td><span class="badge">${p.category}</span></td>
      <td>${Time.shortDate(p.travel_date)}, ${Time.label(p.depart_time)}<br><small>${PORT_NAMES[p.port_departure]}</small></td>
      <td><span class="badge ${p.status === 'validated' ? 's-active' : p.status === 'cancelled' ? 's-disabled' : 's-draft'}">${p.status}</span></td>
      <td>${p.has_id ? '<span class="badge s-active">On file</span>' : '<span class="badge s-disabled">Missing</span>'}</td></tr>`).join('');
    $('empty').hidden = rows.length > 0; if (!rows.length) { $('empty').textContent = data.length ? 'No passengers match your search or filters.' : 'No registrations yet for this port.'; }
    $('count').textContent = `Showing ${rows.length} of ${data.length}`;
  }
  async function load() {
    const port = UI.port(true);
    $('scope').textContent = `Search, filter and update registered passengers. Showing: ${UI.portLabel(port)}.`;
    $('rows').innerHTML = ''; $('empty').hidden = false; $('empty').textContent = 'Loading passengers…'; $('count').textContent = '';
    try { data = (await Staff.api('passengers.list', { query: { port: port || 'ALL' } })).passengers; render(); }
    catch (e) { data = []; $('empty').innerHTML = `${UI.esc(UI.err(e))} <button class="btn btn-line" id="retry">Try again</button>`; $('retry').onclick = load; }
  }
  $('q').oninput = e => { st.q = e.target.value; render(); };
  $('fc').onchange = e => { st.cat = e.target.value; render(); };
  $('fk').onchange = e => { st.cls = e.target.value; render(); };
  $('fs').onchange = e => { st.status = e.target.value; render(); };
  $('reset').onclick = () => { st.q = st.cat = st.cls = st.status = ''; $('q').value = $('fc').value = $('fk').value = $('fs').value = ''; render(); };
  $('thead').onclick = e => { const b = e.target.closest('[data-k]'); if (!b) return; st.dir = st.key === b.dataset.k ? -st.dir : 1; st.key = b.dataset.k; render(); };
  document.addEventListener('fh:port', load); document.addEventListener('fh:validated', load);

  // ---- Edit dialog ----
  const f = $('f'), dlg = $('dlg'); let A = {}, ab = null;
  const rules = {
    full_name: v => !v.trim() ? 'Enter the passenger name.' : v.trim().length < 2 ? 'Enter the full name.' : /\d/.test(v) ? 'Name cannot contain numbers.' : '',
    age: (v, fm) => {
      if (!v.trim()) return 'Enter the age.'; if (!V.int(v) || +v < 1 || +v > 120) return 'Enter a valid age from 1 to 120.';
      const c = fm.elements.category.value; if (c === 'Senior Citizen' && +v < 60) return 'Senior citizens must be 60 or older.'; if (c === 'Child' && +v > 11) return 'Children must be 11 or younger.'; return '';
    },
    category: V.req('Select a category.'), classification: V.req('Select Local or Tourist.'),
    email: (v, fm) => fm.elements.category.value === 'Child' ? '' : !v.trim() ? 'Enter the email address.' : /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()) ? '' : 'Enter a valid email address.',
    rg: () => A.rc ? '' : 'Choose a region.', pv: () => A.pc ? '' : 'Choose a province.', ct: () => A.cc ? '' : 'Choose a city or municipality.', bg: () => A.bc ? '' : 'Choose a barangay.'
  };
  V.live(f, rules);
  const syncEmail = () => { const kid = f.elements.category.value === 'Child'; f.elements.email.disabled = kid; $('emStar').hidden = kid; if (kid) { f.elements.email.value = ''; V.setErr(f.elements.email.closest('.field'), ''); } };
  f.addEventListener('change', e => {
    if (e.target.name === 'category') { syncEmail(); if (f.elements.age.value) V.setErr(f.elements.age.closest('.field'), rules.age(f.elements.age.value, f)); }
    if (['rg', 'pv', 'ct', 'bg'].includes(e.target.name)) V.setErr(e.target.closest('.field'), rules[e.target.name]());
  });
  $('rows').onclick = async e => {
    const b = e.target.closest('[data-id]'); if (!b) return;
    cur = data.find(p => p.id === b.dataset.id); V.clear(f); $('ferr').hidden = true;
    $('dt').textContent = `Edit passenger ${cur.reg_no} #${cur.position}`;
    f.elements.regNo.value = cur.reg_no; f.elements.full_name.value = cur.full_name; f.elements.age.value = cur.age; f.elements.category.value = cur.category;
    f.elements.classification.value = cur.classification; f.elements.email.value = cur.email || ''; f.elements.street.value = cur.street || ''; syncEmail();
    A = { rc: cur.region_code, rn: cur.region_name, pc: cur.province_code, pn: cur.province_name, cc: cur.city_code, cn: cur.city_name, bc: cur.barangay_code, bn: cur.barangay_name };
    ab = bindAddress(f, A); ab.init();
    $('viewId').disabled = !cur.has_id; $('idNote').textContent = cur.has_id ? 'Opens in a new tab. The link works for about a minute.' : 'No ID file on record.';
    dlg.showModal();
  };
  $('viewId').onclick = async () => {
    const w = window.open('', '_blank'); if (w) w.document.title = 'Loading ID…';
    try { const { url } = await Staff.api('passengers.idurl', { query: { id: cur.id } }); if (w) w.location.href = url; else location.href = url; }
    catch (e) { if (w) w.close(); UI.toast(UI.err(e), 'warn'); }
  };
  const shut = () => dlg.close(); $('x').onclick = shut; $('cancel').onclick = shut;
  f.onsubmit = async e => {
    e.preventDefault(); $('ferr').hidden = true; if (!V.run(f, rules)) return;
    const btn = $('save'); btn.disabled = true; btn.textContent = 'Saving…';
    try {
      await Staff.api('passengers.update', { method: 'POST', body: { id: cur.id, full_name: f.elements.full_name.value, age: f.elements.age.value, category: f.elements.category.value, classification: f.elements.classification.value,
        email: f.elements.email.value, street: f.elements.street.value, region_code: A.rc, region_name: A.rn, province_code: A.pc, province_name: A.pn, city_code: A.cc, city_name: A.cn, barangay_code: A.bc, barangay_name: A.bn } });
      dlg.close(); UI.toast(`Passenger ${cur.reg_no} #${cur.position} updated.`, 'ok'); load();
    } catch (err) { $('ferr').hidden = false; $('ferr').textContent = UI.err(err); }
    finally { btn.disabled = false; btn.textContent = 'Save changes'; }
  };
  load();
})();
