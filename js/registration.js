(() => {
  const B = FH.load();
  if (!B || !B.counts || !B.from || !B.time) { location.replace('booking.html'); return; }
  B.passengers = FH.sync(B.counts, B.passengers || []);
  if (!B.passengers.length) { location.replace('booking.html'); return; }
  B.to = FH.PORTS[B.from].other;
  B.submissionKey ||= (crypto.randomUUID ? crypto.randomUUID() : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)));
  const P = B.passengers, FILES = {}, form = document.getElementById('pform'), cardsEl = document.getElementById('cards');
  const FIELDS = ['name', 'age', 'cls', 'email', 'rg', 'pv', 'ct', 'bg', 'id'];
  const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const persist = () => FH.save(B);
  const card = i => form.querySelector(`.pcard[data-i="${i}"]`);
  const fld = (i, f) => card(i).querySelector(`[data-f="${f}"]`);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let busy = false;

  const check = p => {
    const e = {}, n = p.name.trim(), a = Number(p.age);
    if (n.length < 2) e.name = n ? 'err.name' : 'err.required'; else if (/\d/.test(n)) e.name = 'err.name';
    if (p.age === '') e.age = 'err.required';
    else if (!Number.isInteger(a) || a < 1 || a > 120) e.age = 'err.age';
    else if (p.cat === 'senior' && a < 60) e.age = 'err.senior';
    else if (p.cat === 'child' && a > 11) e.age = 'err.child';
    if (!p.cls) e.cls = 'err.cls';
    if (p.cat !== 'child') { const m = p.email.trim(); if (!m) e.email = 'err.required'; else if (!EMAIL.test(m)) e.email = 'err.email'; }
    if (!p.rc) e.rg = 'err.region'; if (!p.pc) e.pv = 'err.province'; if (!p.cc) e.ct = 'err.city'; if (!p.bc) e.bg = 'err.barangay';
    if (!p.idName) e.id = 'err.id';
    return e;
  };
  const err = (i, f, show = true) => FH.setErr(fld(i, f), show ? check(P[i])[f] || null : null);
  const complete = i => !Object.keys(check(P[i])).length;

  const refresh = i => {
    const ok = complete(i), b = card(i).querySelector('.badge');
    card(i).classList.toggle('done', ok);
    b.dataset.i18n = ok ? 'reg.completed' : 'reg.incomplete'; b.textContent = FH.t(b.dataset.i18n);
    const done = P.filter((_, k) => complete(k)).length;
    document.getElementById('done').textContent = done;
    document.getElementById('bar').style.width = (done / P.length * 100) + '%';
  };

  const drawFile = i => {
    const w = fld(i, 'id'), has = !!P[i].idName, bt = w.querySelector('[data-pick]');
    w.querySelector('.fname').textContent = P[i].idName || '';
    w.querySelector('.ok').hidden = !has;
    bt.dataset.i18n = has ? 'reg.replace' : 'reg.upload'; bt.textContent = FH.t(bt.dataset.i18n);
  };

  const select = (i, k, label, extra = '') => `<div class="field" data-f="${k}"><label for="${k}${i}"><span data-i18n="${label}"></span> <i>*</i></label>
      <select id="${k}${i}" ${extra}><option value="" data-i18n="reg.choose"></option></select><p class="err" hidden></p></div>`;

  const cardHtml = (i, p) => {
    const n = i + 1, id = k => `${k}${i}`;
    return `
    <details class="pcard" data-i="${i}" open>
      <summary><img src="../assets/icons/${FH.ICON[p.cat]}.png" alt="">
        <span class="ptitle"><b><span data-i18n="reg.passenger"></span> ${n}</b><span class="pcat" data-i18n="cat.${p.cat}"></span></span>
        <span class="badge" data-i18n="reg.incomplete"></span></summary>
      <div class="pbody">
        <div class="field" data-f="name"><label for="${id('n')}"><span data-i18n="reg.name"></span> <i>*</i></label>
          <input id="${id('n')}" type="text" autocomplete="off" data-i18n-ph="reg.namePh"><p class="err" hidden></p></div>
        <div class="field" data-f="age"><label for="${id('a')}"><span data-i18n="reg.age"></span> <i>*</i></label>
          <input id="${id('a')}" type="number" min="1" max="120" inputmode="numeric" data-i18n-ph="reg.agePh"><p class="err" hidden></p></div>
        <div class="field ro"><label><span data-i18n="reg.cat"></span></label><div class="chip" data-i18n="cat.${p.cat}"></div></div>
        <div class="field" data-f="cls"><label for="${id('c')}"><span data-i18n="reg.cls"></span> <i>*</i></label>
          <select id="${id('c')}"><option value="" data-i18n="reg.select"></option>
            <option value="local" data-i18n="reg.local"></option><option value="tourist" data-i18n="reg.tourist"></option></select><p class="err" hidden></p></div>
        ${p.cat === 'child'
          ? `<div class="field wide"><p class="hint" data-i18n="reg.emailChild"></p></div>`
          : `<div class="field wide" data-f="email"><label for="${id('e')}"><span data-i18n="reg.email"></span> <i>*</i></label>
          <input id="${id('e')}" type="email" autocomplete="email" inputmode="email" data-i18n-ph="reg.emailPh"><p class="err" hidden></p></div>`}
        <div class="addr">
          <p class="addrhead" data-i18n="reg.address"></p>
          ${select(i, 'rg', 'reg.region')}${select(i, 'pv', 'reg.province', 'disabled')}${select(i, 'ct', 'reg.city', 'disabled')}${select(i, 'bg', 'reg.barangay', 'disabled')}
          <div class="field wide" data-f="street"><label for="${id('s')}"><span data-i18n="reg.street"></span></label>
            <input id="${id('s')}" type="text" maxlength="120" autocomplete="off" data-i18n-ph="reg.streetPh"></div>
        </div>
        <div class="field wide" data-f="id"><label><span data-i18n="reg.id"></span> <i>*</i> <small>(${n} · <span data-i18n="cat.${p.cat}"></span>)</small></label>
          <div class="drop"><input type="file" id="${id('f')}" accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf" hidden>
            <button type="button" class="btn-line" data-pick data-i18n="reg.upload"></button>
            <span class="fname"></span><span class="ok" hidden data-i18n="reg.uploaded"></span></div>
          <small class="help" data-i18n="reg.idHelp"></small><p class="err" hidden></p></div>
      </div>
    </details>`;
  };

  // ---- Cascading address selects: Region > Province > City/Municipality > Barangay ----
  const LV = [
    ['rg', 'rc', 'rn', 'reg.chooseRegion', () => PHAddr.regions()],
    ['pv', 'pc', 'pn', 'reg.chooseProvince', p => PHAddr.provinces(p.rc)],
    ['ct', 'cc', 'cn', 'reg.chooseCity', p => PHAddr.cities(p.pc)],
    ['bg', 'bc', 'bn', 'reg.chooseBarangay', p => PHAddr.barangays(p.cc, p.pc)]
  ];
  const sel = (i, k) => fld(i, k).querySelector('select');
  async function populate(i, idx) {
    const [k, ck, nk, ph, load] = LV[idx], s = sel(i, k);
    s.disabled = true; delete s.dataset.err; s.innerHTML = `<option value="">${FH.t('reg.loading')}</option>`;
    try {
      const items = await load(P[i]);
      s.innerHTML = `<option value="" data-i18n="${ph}">${FH.t(ph)}</option>` + items.map(x => `<option value="${esc(x.c)}">${esc(x.n)}</option>`).join('');
      s.disabled = !items.length;
      if (!items.length) s.options[0].textContent = FH.t('reg.noOptions');
      if (P[i][ck] && items.some(x => x.c === P[i][ck])) s.value = P[i][ck]; else P[i][ck] = P[i][nk] = '';
    } catch (e) {
      s.innerHTML = `<option value="">${FH.t('reg.loadError')}</option>`; s.disabled = false; s.dataset.err = String(idx);
    }
  }
  function clearBelow(i, idx) {
    for (let j = idx + 1; j < LV.length; j++) {
      const [k, ck, nk, ph] = LV[j], s = sel(i, k);
      P[i][ck] = P[i][nk] = ''; delete s.dataset.err; s.disabled = true;
      s.innerHTML = `<option value="" data-i18n="${ph}">${FH.t(ph)}</option>`; FH.setErr(fld(i, k), null);
    }
  }
  async function initAddress(i) {
    await populate(i, 0);
    for (let idx = 1; idx < LV.length; idx++) { if (P[i][LV[idx - 1][1]]) await populate(i, idx); else { clearBelow(i, idx - 1); break; } }
  }

  // ---- Build the cards ----
  cardsEl.innerHTML = P.map((p, i) => cardHtml(i, p)).join('');
  if (B.reg && B.reg.missing) B.reg.missing.forEach(pos => { if (P[pos - 1]) P[pos - 1].idName = ''; });
  P.forEach((p, i) => {
    fld(i, 'name').querySelector('input').value = p.name;
    fld(i, 'age').querySelector('input').value = p.age;
    fld(i, 'cls').querySelector('select').value = p.cls;
    if (p.cat !== 'child') fld(i, 'email').querySelector('input').value = p.email;
    fld(i, 'street').querySelector('input').value = p.street;
    drawFile(i); refresh(i);
  });
  document.getElementById('tot').textContent = P.length;
  FH.apply();
  P.forEach((_, i) => initAddress(i));

  const target = e => { const c = e.target.closest('.pcard'), w = e.target.closest('.field'); return c && w && w.dataset.f ? [Number(c.dataset.i), w.dataset.f, w] : null; };
  const TEXT = { name: 'name', age: 'age', email: 'email', street: 'street' };

  form.addEventListener('input', e => {
    const t = target(e); if (!t || !TEXT[t[1]]) return;
    P[t[0]][TEXT[t[1]]] = e.target.value; persist();
    if (t[2].classList.contains('bad')) err(t[0], t[1]);
    refresh(t[0]);
  });
  form.addEventListener('change', e => {
    const t = target(e); if (!t) return;
    const [i, f] = t, idx = LV.findIndex(l => l[0] === f);
    if (f === 'cls') { P[i].cls = e.target.value; err(i, f); }
    if (idx >= 0) {
      const [, ck, nk] = LV[idx], s = e.target;
      P[i][ck] = s.value; P[i][nk] = s.value ? s.options[s.selectedIndex].text : '';
      clearBelow(i, idx); err(i, f);
      if (s.value && idx < LV.length - 1) populate(i, idx + 1).then(() => refresh(i));
    }
    if (f === 'id' && e.target.type === 'file') {
      const file = e.target.files[0]; if (!file) return;
      const ok = /^(image\/(jpeg|png)|application\/pdf)$/.test(file.type) && file.size <= 15 * 1048576 && (file.type !== 'application/pdf' || file.size <= 2 * 1048576);
      if (!ok) { e.target.value = ''; FH.setErr(t[2], 'err.file'); return; }
      FILES[i] = file; P[i].idName = file.name; drawFile(i); err(i, 'id');
    }
    persist(); refresh(i);
  });
  document.getElementById('consent').addEventListener('change', e => FH.setErr(document.querySelector('[data-f="consent"]'), e.target.checked ? null : 'err.consent'));
  form.addEventListener('focusout', e => { const t = target(e); if (t && FIELDS.includes(t[1]) && t[1] !== 'id') err(t[0], t[1]); });
  form.addEventListener('mousedown', e => {   // retry a dropdown that failed to load
    const s = e.target.closest('select[data-err]'); if (!s) return;
    e.preventDefault(); const i = Number(s.closest('.pcard').dataset.i); populate(i, Number(s.dataset.err));
  });
  form.addEventListener('click', e => { const b = e.target.closest('[data-pick]'); if (b && !b.disabled) b.closest('.drop').querySelector('input').click(); });

  const note = (k, bad, raw) => {
    const n = document.getElementById('result'); n.hidden = false; n.className = 'note ' + (bad ? 'bad' : 'good');
    if (raw) { delete n.dataset.i18n; n.textContent = raw; } else { n.dataset.i18n = k; n.textContent = FH.t(k); }
    n.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };
  const btn = form.querySelector('[type=submit]');
  const setBusy = (on, key = 'reg.submit') => { busy = on; btn.disabled = on; btn.dataset.i18n = key; btn.textContent = FH.t(key); };

  // After the registration exists, details are frozen so the saved record always matches what was submitted.
  function lock() {
    const open = new Set(B.reg.missing || []);
    form.querySelectorAll('input:not([type=file]),select,textarea').forEach(el => { el.disabled = true; });
    P.forEach((_, i) => { const b = card(i).querySelector('[data-pick]'); b.disabled = !open.has(i + 1); });
    const l = document.getElementById('locked'); l.hidden = false;
  }

  async function prepare(file) {    // shrink photos before upload; PDFs go as they are
    if (file.type === 'application/pdf') return file;
    const bmp = await createImageBitmap(file), s = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    let blob; for (const q of [0.82, 0.65, 0.5, 0.35]) { blob = await new Promise(r => c.toBlob(r, 'image/jpeg', q)); if (blob.size <= 1.5 * 1048576) break; }
    if (blob.size > 2 * 1048576) throw new Error('too large');
    return blob;
  }

  const payload = () => ({
    submission_key: B.submissionKey, port_departure: B.from, travel_date: B.date, depart_time: B.time, consent: true,
    passengers: P.map(p => ({ category: p.cat, name: p.name, age: Number(p.age), classification: p.cls, email: p.email, street: p.street,
      address: { region: { code: p.rc, name: p.rn }, province: { code: p.pc, name: p.pn }, city: { code: p.cc, name: p.cn }, barangay: { code: p.bc, name: p.bn } } }))
  });

  async function submit() {
    setBusy(true, 'reg.submitting');
    try {
      const out = await FH.api('/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload()) });
      B.reg = { token: out.token, regNo: out.regNo, missing: out.missingIds }; persist(); lock();
      setBusy(true, 'reg.uploading');
      for (const pos of [...out.missingIds]) {
        const f = FILES[pos - 1]; if (!f) continue;
        try {
          const blob = await prepare(f);
          await FH.api(`/upload-id?k=${encodeURIComponent(B.submissionKey)}&i=${pos}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-File-Type': blob.type }, body: blob });
          B.reg.missing = B.reg.missing.filter(x => x !== pos); persist();
        } catch (e) { /* stays in the missing list; the person can retry */ }
      }
      if (B.reg.missing.length) {
        B.reg.missing.forEach(pos => { P[pos - 1].idName = ''; delete FILES[pos - 1]; drawFile(pos - 1); FH.setErr(fld(pos - 1, 'id'), 'err.id'); refresh(pos - 1); });
        lock(); setBusy(false); note('reg.retryIds', true); return;
      }
      note('reg.goTicket', false);
      try { sessionStorage.removeItem('fh_booking'); } catch (e) {}
      location.href = 'ticket.html?t=' + encodeURIComponent(out.token);
    } catch (e) {
      setBusy(false);
      if (e.status && e.status < 500 && e.body && e.body.message) note('', true, e.body.message); else note('reg.serverError', true);
    }
  }

  form.addEventListener('submit', async e => {
    e.preventDefault(); if (busy) return;
    let first = null;
    P.forEach((p, i) => {
      const er = check(p);
      FIELDS.forEach(f => { if (!fld(i, f)) return; FH.setErr(fld(i, f), er[f] || null); if (er[f] && !first) first = [i, f]; });
      refresh(i);
    });
    const cw = document.querySelector('[data-f="consent"]'), consent = document.getElementById('consent').checked;
    FH.setErr(cw, consent ? null : 'err.consent');
    if (P.every(p => p.cat === 'child')) { note('err.noAdult', true); return; }
    if (first) {
      card(first[0]).open = true;
      const el = fld(first[0], first[1]);
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el.querySelector('input:not([hidden]),select,textarea,button')?.focus({ preventScroll: true });
      note('reg.fix', true); return;
    }
    if (!consent) { cw.scrollIntoView({ block: 'center', behavior: 'smooth' }); document.getElementById('consent').focus({ preventScroll: true }); return; }
    submit();
  });

  const sum = () => {
    document.getElementById('trip').innerHTML =
      `<b>${FH.portName(B.from)} → ${FH.portName(B.to)}</b><span>${FH.fmtDate(B.date)}, ${FH.timeLabel(B.time)}</span>` +
      FH.CATS.filter(c => B.counts[c]).map(c => `<span class="chip"><span data-i18n="cat.${c}">${FH.t('cat.' + c)}</span> × ${B.counts[c]}</span>`).join('');
  };
  sum();
  document.addEventListener('fh:lang', () => { sum(); document.querySelectorAll('#trip [data-i18n]').forEach(e => { e.textContent = FH.t(e.dataset.i18n); }); });
  persist();
  if (B.reg) { if (!B.reg.missing || !B.reg.missing.length) { try { sessionStorage.removeItem('fh_booking'); } catch (e) {} location.replace('ticket.html?t=' + encodeURIComponent(B.reg.token)); } else lock(); }
})();
