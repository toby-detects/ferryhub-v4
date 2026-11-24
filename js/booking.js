(() => {
  const PORTS = ['ANILAO', 'TINGLOY'];
  const MAX = 20;
  const $ = s => document.querySelector(s);
  const saved = FH.load() || {};
  const S = {
    from: PORTS.includes(saved.from) ? saved.from : '', date: saved.date || '', time: saved.time || '',
    counts: Object.assign({ regular: 1, student: 0, senior: 0, pwd: 0, child: 0 }, saved.counts || {})
  };
  const total = () => FH.CATS.reduce((a, c) => a + S.counts[c], 0);
  const wrap = f => $(`[data-f="${f}"]`);
  const today = FH.phToday(), maxDate = FH.phToday(FH_CONFIG.MAX_BOOKING_DAYS);
  const arrival = () => S.from ? FH.PORTS[S.from].other : '';
  const drawArrival = () => { $('#to').value = arrival() ? FH.portName(arrival()) : ''; };

  $('#from').innerHTML = `<option value="" data-i18n="book.port">${FH.t('book.port')}</option>` +
    PORTS.map(c => `<option value="${c}"${c === S.from ? ' selected' : ''}>${FH.portName(c)}</option>`).join('');
  $('#date').min = today; $('#date').max = maxDate; $('#date').value = S.date;
  drawArrival();

  // Departure times come from the chosen port's real schedule for the chosen date.
  let reqId = 0;
  async function loadTimes() {
    const sel = $('#time'), note = $('#timeNote'), id = ++reqId;
    const set = (key, disabled = true) => { sel.innerHTML = `<option value="" data-i18n="${key}">${FH.t(key)}</option>`; sel.disabled = disabled; };
    note.textContent = ''; note.removeAttribute('data-i18n');
    if (!S.from || !S.date || S.date < today || S.date > maxDate) { S.time = ''; set('book.pickPortDate'); return; }
    set('book.loadingTimes');
    try {
      const { slots } = await FH.api(`/slots?port=${S.from}&date=${S.date}`);
      if (id !== reqId) return;
      if (!slots.length) { S.time = ''; set('book.noTimes'); note.dataset.i18n = 'book.noTimesDay'; note.textContent = FH.t('book.noTimesDay'); return; }
      if (!slots.some(x => x.time === S.time)) S.time = '';
      sel.disabled = false;
      sel.innerHTML = `<option value="" data-i18n="book.selTime">${FH.t('book.selTime')}</option>` +
        slots.map(x => `<option value="${x.time}"${x.time === S.time ? ' selected' : ''}>${FH.timeLabel(x.time)}</option>`).join('');
    } catch (e) {
      if (id !== reqId) return;
      S.time = ''; set('book.noTimes'); note.dataset.i18n = 'book.timesError'; note.textContent = FH.t('book.timesError');
    }
  }
  document.addEventListener('fh:lang', () => { if (!$('#from').disabled) { const v = $('#from').value; $('#from').innerHTML = `<option value="" data-i18n="book.port">${FH.t('book.port')}</option>` + PORTS.map(c => `<option value="${c}"${c === v ? ' selected' : ''}>${FH.portName(c)}</option>`).join(''); } });

  // Passenger selector
  const list = $('#paxList');
  list.innerHTML = FH.CATS.map(c => `
    <li><img src="../assets/icons/${FH.ICON[c]}.png" alt=""><span data-i18n="cat.${c}"></span>
      <button type="button" class="step" data-c="${c}" data-d="-1" aria-label="−">−</button>
      <output id="n-${c}">0</output>
      <button type="button" class="step plus" data-c="${c}" data-d="1" aria-label="+">+</button></li>`).join('');
  const drawPax = () => {
    FH.CATS.forEach(c => { $('#n-' + c).textContent = S.counts[c]; });
    $('#paxTotal').textContent = total(); $('#paxTotal2').textContent = total();
    list.querySelectorAll('.step').forEach(b => {
      b.disabled = b.dataset.d === '-1' ? S.counts[b.dataset.c] <= 0 : total() >= MAX;
    });
  };
  list.onclick = e => {
    const b = e.target.closest('.step'); if (!b || b.disabled) return;
    S.counts[b.dataset.c] += Number(b.dataset.d);
    drawPax(); FH.setErr(wrap('pax'), null);
  };
  const pop = $('#paxPop'), btn = $('#paxBtn');
  btn.onclick = () => { pop.hidden = !pop.hidden; btn.setAttribute('aria-expanded', String(!pop.hidden)); };
  document.addEventListener('click', e => { if (!e.target.closest('.pax')) { pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); } });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') pop.hidden = true; });

  $('#from').onchange = e => { S.from = e.target.value; drawArrival(); FH.setErr(wrap('from'), null); loadTimes(); };
  $('#date').onchange = e => { S.date = e.target.value; FH.setErr(wrap('date'), null); loadTimes(); };
  $('#time').onchange = e => { S.time = e.target.value; FH.setErr(wrap('time'), null); };

  $('#go').onclick = () => {
    const onlyKids = total() > 0 && total() === S.counts.child;
    const errs = [
      ['from', !S.from && 'err.from'],
      ['date', !S.date ? 'err.date' : S.date < today ? 'err.datepast' : S.date > maxDate ? 'err.dateRange' : null],
      ['time', !S.time && 'err.time'], ['pax', !total() ? 'err.pax' : onlyKids ? 'err.noAdult' : null]
    ];
    errs.forEach(([f, k]) => FH.setErr(wrap(f), k || null));
    const bad = errs.find(e => e[1]);
    if (bad) { const el = wrap(bad[0]); el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.querySelector('select,input,button')?.focus({ preventScroll: true }); return; }
    const old = saved.passengers || [];
    if (FH.wouldDrop(S.counts, old) && !confirm(FH.t('book.confirmDrop'))) return;
    const keep = saved.submissionKey && saved.from === S.from && saved.date === S.date && saved.time === S.time;
    FH.save({ ...S, to: arrival(), passengers: FH.sync(S.counts, old), submissionKey: keep ? saved.submissionKey : undefined, reg: keep ? saved.reg : undefined });
    location.href = 'registration-form.html';
  };

  drawPax();
  FH.apply();
  loadTimes();
})();
