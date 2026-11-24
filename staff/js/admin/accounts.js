/* Account Management (Admin only). Staff accounts live in the FerryHub database; every change goes through /api/staff. */
(() => {
  const $ = id => document.getElementById(id), sel = new Set(), st = { q: '', status: '', port: '' };
  const PL = { ANILAO: 'Mabini Anilao', TINGLOY: 'Tingloy' };
  let all = [], busy = true, loadErr = '';
  const code = a => 'ST-' + String(a.seq).padStart(4, '0'), status = a => a.active ? 'Active' : 'Disabled';
  const when = iso => { const d = new Date(iso), p = Time.parts(d), key = `${p.year}-${p.month}-${p.day}`, t = Time.label(p.hour + ':' + p.minute);
    return key === Time.today() ? 'Today, ' + t : Time.shortDate(key).replace(', ' + p.year, p.year === Time.today().slice(0, 4) ? '' : ', ' + p.year) + ', ' + t; };
  const dateOnly = iso => { const p = Time.parts(new Date(iso)); return Time.shortDate(`${p.year}-${p.month}-${p.day}`); };
  const opts = Object.entries(PL).map(([c, n]) => `<option value="${c}">${n}</option>`).join('');
  $('po').innerHTML = '<option value="">Select port</option>' + opts;
  $('fp').innerHTML = '<option value="">All</option>' + opts;

  const visible = () => { const q = st.q.trim().toLowerCase();
    return all.filter(a => (!st.status || status(a) === st.status) && (!st.port || a.port === st.port) && (!q || code(a).toLowerCase().includes(q) || a.username.toLowerCase().includes(q))).sort((a, b) => b.seq - a.seq); };
  function render() {
    const rows = visible(); [...sel].forEach(id => { if (!all.some(a => a.id === id)) sel.delete(id); });
    const allOn = rows.length && rows.every(a => sel.has(a.id));
    $('thead').innerHTML = `<th scope="col"><input class="chk" type="checkbox" id="all" aria-label="Select all accounts" ${allOn ? 'checked' : ''}></th><th scope="col">ID</th><th scope="col">USERNAME</th><th scope="col">ROLE</th><th scope="col">DATE CREATED</th><th scope="col">LAST LOGIN</th><th scope="col">STATUS</th><th scope="col">PORT</th>`;
    $('rows').innerHTML = rows.map(a => `<tr><td><input class="chk" type="checkbox" data-id="${a.id}" aria-label="Select ${UI.esc(a.username)}" ${sel.has(a.id) ? 'checked' : ''}></td>
      <td class="rn">${code(a)}</td><td>${UI.esc(a.username)}</td><td>Staff</td><td>${a.createdAt ? dateOnly(a.createdAt) : '—'}</td><td>${a.lastLogin ? when(a.lastLogin) : 'Never'}</td>
      <td class="${a.active ? 'st-active' : 'st-disabled'}">${status(a)}</td><td>${UI.esc(PL[a.port] || '—')}</td></tr>`).join('');
    const s = $('state'); s.hidden = !busy && !loadErr && rows.length > 0;
    s.innerHTML = busy ? '<b>Loading accounts…</b>' : loadErr ? `<b>Could not load accounts</b>${UI.esc(loadErr)} <button class="linkbtn" id="retry" type="button">Try again</button>`
      : !all.length ? '<b>No staff accounts yet</b>Use “Add new account” to create one.' : '<b>No accounts match your search or filters</b>Try a different search.';
    if (loadErr) $('retry').onclick = load;
    $('count').textContent = busy || loadErr ? '' : `Showing ${rows.length} of ${all.length}`;
    $('del').disabled = sel.size === 0; $('upd').disabled = sel.size !== 1;
  }
  async function load() { busy = true; loadErr = ''; render(); try { all = (await Staff.api('accounts.list')).accounts; } catch (e) { all = []; loadErr = UI.err(e); } busy = false; render(); }

  /* ---------- dialog ---------- */
  const f = $('f'), dlg = $('dlg'); let mode = 'add', cur = null;
  const rules = {
    username: v => mode !== 'add' ? '' : !/^[a-z0-9._-]{3,30}$/i.test(v.trim()) ? 'Use 3 to 30 letters, numbers, dots, dashes or underscores.' : all.some(a => a.username === v.trim().toLowerCase()) ? 'That username is already taken.' : '',
    password: v => !v && mode === 'edit' ? '' : v.length < 8 ? 'Use at least 8 characters.' : v.length > 72 ? 'Use 72 characters or fewer.' : '',
    confirm: (v, fm) => fm.elements.password.value && fm.elements.password.value !== v ? 'Passwords do not match.' : '',
    port: V.req('Choose a port.')
  };
  V.live(f, rules);
  f.elements.password.addEventListener('input', () => { if (f.elements.confirm.value) V.setErr(f.elements.confirm.closest('.field'), rules.confirm(f.elements.confirm.value, f)); });
  function open(m, a) {
    mode = m; cur = a || null; V.clear(f); f.reset();
    $('dt').textContent = m === 'add' ? 'Add new account' : `Update ${a.username}`;
    $('save').textContent = m === 'add' ? 'Create account' : 'Save changes';
    f.elements.username.readOnly = m === 'edit';
    $('pwl').innerHTML = m === 'add' ? 'Password <i>*</i>' : 'New password (optional)';
    $('pwhint').textContent = m === 'add' ? 'Use at least 8 characters. Share the password with the staff member privately.' : 'Leave the password blank to keep it. Entering one resets the account password.';
    if (a) { f.elements.username.value = a.username; f.elements.port.value = a.port; f.elements.status.value = status(a); }
    dlg.showModal(); (m === 'add' ? f.elements.username : f.elements.password).focus();
  }
  f.onsubmit = async e => {
    e.preventDefault(); if (!V.run(f, rules)) return;
    const btn = $('save'); btn.disabled = true; const v = f.elements;
    try {
      if (mode === 'add') { await Staff.api('accounts.create', { method: 'POST', body: { username: v.username.value, password: v.password.value, port: v.port.value, active: v.status.value === 'Active' } }); UI.toast(`Account ${v.username.value.trim().toLowerCase()} created.`, 'ok'); }
      else {
        await Staff.api('accounts.update', { method: 'POST', body: { id: cur.id, port: v.port.value, active: v.status.value === 'Active' } });
        if (v.password.value) await Staff.api('accounts.reset', { method: 'POST', body: { id: cur.id, password: v.password.value } });
        UI.toast(`${cur.username} updated.`, 'ok');
      }
      dlg.close(); await load();
    } catch (err) { UI.toast(UI.err(err), 'warn'); }
    finally { btn.disabled = false; }
  };
  $('add').onclick = () => open('add');
  $('upd').onclick = () => { if (sel.size === 1) open('edit', all.find(a => a.id === [...sel][0])); else UI.toast('Select exactly one account to update.', 'warn'); };
  $('del').onclick = async () => {
    if (!sel.size) return;
    const n = sel.size;
    if (!await UI.confirm(`Delete ${n} account${n > 1 ? 's' : ''}?`, 'This permanently removes the selected Staff account' + (n > 1 ? 's' : '') + ' and blocks their access. Tickets they validated stay on record.')) return;
    try { await Staff.api('accounts.delete', { method: 'POST', body: { ids: [...sel] } }); sel.clear(); UI.toast(`${n} account${n > 1 ? 's' : ''} deleted.`, 'ok'); } catch (err) { UI.toast(UI.err(err), 'warn'); }
    await load();
  };
  $('x').onclick = $('cancel').onclick = () => dlg.close();

  /* ---------- list events ---------- */
  $('rows').onchange = e => { const c = e.target.closest('[data-id]'); if (!c) return; c.checked ? sel.add(c.dataset.id) : sel.delete(c.dataset.id); render(); };
  $('thead').onchange = e => { if (e.target.id !== 'all') return; visible().forEach(a => e.target.checked ? sel.add(a.id) : sel.delete(a.id)); render(); };
  $('q').oninput = e => { st.q = e.target.value; render(); };
  $('fs').onchange = e => { st.status = e.target.value; render(); };
  $('fp').onchange = e => { st.port = e.target.value; render(); };
  load();
})();
