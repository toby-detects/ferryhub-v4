(() => {
  const $ = id => document.getElementById(id), pad = n => String(n).padStart(2, '0');
  const today = Time.today(); let sel = today, [vy, vm] = [+today.slice(0, 4), +today.slice(5, 7) - 1], month = {}, slots = [], reqM = 0, reqD = 0;
  const port = () => UI.port(false), rem = s => Math.max(0, s.capacity - s.booked);

  function drawCal() {
    $('mt').textContent = new Date(Date.UTC(vy, vm, 1)).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' });
    const first = new Date(Date.UTC(vy, vm, 1)).getUTCDay(), n = new Date(Date.UTC(vy, vm + 1, 0)).getUTCDate();
    let h = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => `<div class="dow" aria-hidden="true">${d}</div>`).join('') + '<div class="blank"></div>'.repeat(first);
    for (let d = 1; d <= n; d++) {
      const key = `${vy}-${pad(vm + 1)}-${pad(d)}`, m = month[key];
      const c = !m ? '' : m.live === 0 && m.cancelled > 0 ? 'none' : m.live > 0 && m.live === m.full ? 'full' : '';
      const txt = !m ? '' : c === 'none' ? ', all slots cancelled' : c === 'full' ? ', all slots full' : ', seats available';
      h += `<button class="day ${c} ${key === today ? 'today' : ''}" data-d="${key}" aria-pressed="${key === sel}" aria-label="${Time.longDate(key)}${txt}"><span>${d}</span><span class="bar"></span></button>`;
    }
    $('cal').innerHTML = h;
  }
  async function loadMonth() {
    const id = ++reqM; try { const { days } = await Staff.api('schedule.month', { query: { port: port(), month: `${vy}-${pad(vm + 1)}` } }); if (id !== reqM) return; month = Object.fromEntries(days.map(d => [d.day, d])); }
    catch (e) { if (id === reqM) { month = {}; UI.toast(UI.err(e), 'warn'); } } if (id === reqM) drawCal();
  }
  function drawSlots() {
    $('sd').textContent = Time.longDate(sel);
    const msg = $('dayMsg'); msg.hidden = true;
    for (const k of ['available', 'full', 'cancelled']) {
      const g = slots.filter(s => s.status === k), label = { available: 'Available', full: 'Full', cancelled: 'Cancelled' }[k];
      $('s-' + k).innerHTML = g.length ? g.map(s => `<button class="slot ${k}" data-id="${s.time}"><span>${Time.label(s.time)}</span><span style="text-align:right">${label}<small>${k === 'cancelled' ? 'Not operating' : `${s.booked} of ${s.capacity} booked`}${s.registeredPax ? ` · ${s.registeredPax} registered` : ''}</small></span></button>`).join('') : '<p class="none-msg">None</p>';
    }
    if (!slots.length) { msg.hidden = false; msg.textContent = 'No departure times for this date. Add default times or a time for this date.'; }
  }
  async function loadDay() {
    const id = ++reqD; $('scope').textContent = `Select a date, then select a time slot to view or update it. Showing: ${UI.portLabel(port())}.`;
    try { const r = await Staff.api('schedule.day', { query: { port: port(), date: sel } }); if (id !== reqD) return; slots = r.slots; }
    catch (e) { if (id !== reqD) return; slots = []; UI.toast(UI.err(e), 'warn'); } drawSlots();
  }
  const refresh = () => { drawCal(); loadMonth(); loadDay(); };
  $('cal').onclick = e => { const b = e.target.closest('[data-d]'); if (b) { sel = b.dataset.d; drawCal(); loadDay(); } };
  $('prev').onclick = () => { vm--; if (vm < 0) { vm = 11; vy--; } drawCal(); loadMonth(); };
  $('next').onclick = () => { vm++; if (vm > 11) { vm = 0; vy++; } drawCal(); loadMonth(); };
  $('today').onclick = () => { sel = today; [vy, vm] = [+today.slice(0, 4), +today.slice(5, 7) - 1]; refresh(); };
  $('cb').onclick = () => UI.soon('There are no bookings to cancel yet.');
  document.addEventListener('fh:port', refresh); document.addEventListener('fh:validated', refresh);

  // ---- Slot dialog (existing slot, or a one-off new time for this date) ----
  const f = $('f'), dlg = $('dlg'); let cur = null;
  const rules = {
    time: v => cur ? '' : !v ? 'Choose a departure time.' : slots.some(s => s.time === v) ? 'That time already exists on this date. Select it from the list.' : '',
    capacity: v => !V.int(v) ? 'Enter a whole number, 0 or more.' : +v > 500 ? 'Capacity cannot exceed 500.' : '',
    booked: (v, fm) => !V.int(v) ? 'Enter a whole number, 0 or more.' : V.int(fm.elements.capacity.value) && +v > +fm.elements.capacity.value ? 'Booked passengers cannot exceed capacity.' : '',
    status: (v, fm) => { const c = fm.elements.capacity.value, n = fm.elements.booked.value; return v === 'available' && V.int(c) && V.int(n) && +c - +n <= 0 ? 'No seats left. Increase capacity or set the status to Full.' : ''; }
  };
  V.live(f, rules);
  const remain = () => { const c = f.elements.capacity.value, n = f.elements.booked.value; $('m-rem').textContent = V.int(c) && V.int(n) ? Math.max(0, +c - +n) : 'Enter valid numbers'; };
  f.addEventListener('input', e => { if (e.target.name === 'capacity' || e.target.name === 'booked') { remain(); const w = f.elements.status.closest('.field'); if (w.classList.contains('bad')) V.setErr(w, rules.status(f.elements.status.value, f)); } });
  function openSlot(s) {
    cur = s; V.clear(f); $('ferr').hidden = true; $('m-port').textContent = UI.portLabel(port()); $('m-date').textContent = Time.longDate(sel);
    $('timeField').hidden = !!s; $('dt').textContent = s ? 'Time slot ' + Time.label(s.time) : 'Add a time for this date';
    $('m-time').textContent = s ? Time.label(s.time) : 'Choose below'; $('m-reg').textContent = s ? s.registeredPax : 0;
    f.elements.time.value = ''; f.elements.status.value = s ? s.status : 'available'; f.elements.capacity.value = s ? s.capacity : (slots[0] ? slots[0].capacity : 40); f.elements.booked.value = s ? s.booked : 0; remain(); dlg.showModal();
  }
  for (const k of ['available', 'full', 'cancelled']) $('s-' + k).onclick = e => { const b = e.target.closest('[data-id]'); if (b) openSlot(slots.find(s => s.time === b.dataset.id)); };
  $('addSlot').onclick = () => openSlot(null);
  const shut = () => dlg.close(); $('x').onclick = shut; $('cancel').onclick = shut;
  f.onsubmit = async e => {
    e.preventDefault(); $('ferr').hidden = true; if (!V.run(f, rules)) return;
    const b = $('save'); b.disabled = true; b.textContent = 'Saving…';
    try {
      const time = cur ? cur.time : f.elements.time.value;
      await Staff.api('schedule.slot', { method: 'POST', body: { port: port(), date: sel, time, capacity: f.elements.capacity.value, booked: f.elements.booked.value, status: f.elements.status.value } });
      dlg.close(); UI.toast(`${Time.label(time)} slot saved.`, 'ok'); loadMonth(); loadDay();
    } catch (err) { $('ferr').hidden = false; $('ferr').textContent = UI.err(err); }
    finally { b.disabled = false; b.textContent = 'Save slot'; }
  };

  // ---- Default departure times (offered on every date) ----
  const tdlg = $('tdlg'), tf = $('tf'); let tpls = [], editing = null;
  const trules = { time: v => v ? '' : 'Choose a time.', capacity: v => !V.int(v) ? 'Enter a whole number, 0 or more.' : +v > 500 ? 'Capacity cannot exceed 500.' : '' };
  V.live(tf, trules);
  const newTpl = () => { editing = null; V.clear(tf); $('tferr').hidden = true; $('tft').textContent = 'Add a default time'; tf.elements.time.value = ''; tf.elements.capacity.value = 40; tf.elements.active.checked = true; };
  async function loadTpl() {
    try { tpls = (await Staff.api('schedule.templates', { query: { port: port() } })).templates; }
    catch (e) { $('trows').innerHTML = `<tr><td colspan="5">${UI.esc(UI.err(e))}</td></tr>`; return; }
    $('trows').innerHTML = tpls.map(t => `<tr><td><b>${Time.label(t.time)}</b></td><td>${t.capacity}</td><td><span class="badge ${t.active ? 's-active' : 's-disabled'}">${t.active ? 'Offered' : 'Off'}</span></td><td>${t.upcoming}</td><td><button class="iconbtn" data-t="${t.id}" aria-label="Edit ${Time.label(t.time)}"><img src="../assets/icons/edit.png" alt=""></button></td></tr>`).join('') || '<tr><td colspan="5">No default times yet.</td></tr>';
  }
  $('tplBtn').onclick = () => { newTpl(); loadTpl(); tdlg.showModal(); };
  $('tx').onclick = () => tdlg.close(); $('tnew').onclick = newTpl;
  $('trows').onclick = e => { const b = e.target.closest('[data-t]'); if (!b) return; editing = tpls.find(t => t.id === b.dataset.t); V.clear(tf); $('tferr').hidden = true; $('tft').textContent = 'Edit ' + Time.label(editing.time);
    tf.elements.time.value = editing.time; tf.elements.capacity.value = editing.capacity; tf.elements.active.checked = editing.active; };
  tf.onsubmit = async e => {
    e.preventDefault(); $('tferr').hidden = true; if (!V.run(tf, trules)) return;
    const b = $('tsave'); b.disabled = true;
    try { await Staff.api('schedule.template', { method: 'POST', body: { port: port(), id: editing ? editing.id : undefined, time: tf.elements.time.value, capacity: tf.elements.capacity.value, active: tf.elements.active.checked } });
      UI.toast('Default time saved.', 'ok'); newTpl(); await loadTpl(); loadMonth(); loadDay(); }
    catch (err) { $('tferr').hidden = false; $('tferr').textContent = UI.err(err); } finally { b.disabled = false; }
  };
  refresh();
})();
