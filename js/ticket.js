(() => {
  const $ = id => document.getElementById(id), state = $('state'), card = $('ticket');
  const token = new URLSearchParams(location.search).get('t') || '';
  let T = null;
  const loc = () => FH.lang() === 'tl' ? 'fil-PH' : 'en-US';
  const ticketUrl = () => location.origin + location.pathname + '?t=' + encodeURIComponent(token);

  // Draws a QR code (with the standard 4-module quiet zone) on a canvas of about `px` pixels.
  function qrCanvas(text, px) {
    const q = qrcode(0, 'M'); q.addData(text); q.make();
    const n = q.getModuleCount(), cell = Math.max(2, Math.floor(px / (n + 8))), size = cell * (n + 8);
    const c = document.createElement('canvas'); c.width = c.height = size;
    const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, size, size); x.fillStyle = '#000';
    for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (q.isDark(r, k)) x.fillRect((k + 4) * cell, (r + 4) * cell, cell, cell);
    return c;
  }
  const schedule = () => {
    const d = new Date(T.travelDate + 'T00:00:00Z').toLocaleDateString(loc(), { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).replace(',', '');
    return `${d} ${FH.timeLabel(T.departTime)}`;
  };
  const regAt = () => new Date(T.registeredAt).toLocaleString(loc(), { timeZone: 'Asia/Manila', dateStyle: 'long', timeStyle: 'short' });

  function fill() {
    $('regNo').textContent = T.regNo; $('name').textContent = T.passengers[0]?.name || '';
    $('dep').textContent = T.portDeparture.long; $('arr').textContent = T.portArrival.long;
    $('sched').textContent = schedule(); $('regAt').textContent = regAt();
    $('pc').textContent = T.passengers.length; $('valid').hidden = T.status !== 'validated';
    $('plist').innerHTML = '';
    T.passengers.forEach(p => { const li = document.createElement('li'); li.innerHTML = '<span></span><i data-i18n=""></i>'; li.firstChild.textContent = p.name;
      const k = { Regular: 'regular', Student: 'student', 'Senior Citizen': 'senior', PWD: 'pwd', Child: 'child' }[p.category]; li.lastChild.dataset.i18n = 'cat.' + k; li.lastChild.textContent = FH.t('cat.' + k); $('plist').append(li); });
  }
  function msg(key, retry, home) {
    card.hidden = true; state.hidden = false;
    state.innerHTML = `<p data-i18n="${key}">${FH.t(key)}</p>` + (retry ? `<button class="btn btn-g" id="retry" data-i18n="tk.retry">${FH.t('tk.retry')}</button>` : '') +
      (home ? `<a class="btn btn-line" href="../index.html" data-i18n="tk.home">${FH.t('tk.home')}</a>` : '');
    if (retry) $('retry').onclick = load;
  }
  async function load() {
    if (!token) return msg('tk.noToken', false, true);
    msg('tk.loading');
    try {
      T = await FH.api('/ticket?t=' + encodeURIComponent(token));
      state.hidden = true; card.hidden = false; fill(); FH.apply();
      try { const c = qrCanvas(ticketUrl(), 380); const t = $('qr'); t.width = c.width; t.height = c.height; t.getContext('2d').drawImage(c, 0, 0); t.setAttribute('aria-label', 'QR code ' + T.regNo); }
      catch (e) { $('dlErr').hidden = false; }
    } catch (e) { e.status === 404 ? msg('tk.notFound', false, true) : msg('tk.error', true, true); }
  }

  const wrap = (ctx, text, max) => { const out = []; let line = ''; for (const w of text.split(' ')) { const t = line ? line + ' ' + w : w; if (ctx.measureText(t).width > max && line) { out.push(line); line = w; } else line = t; } if (line) out.push(line); return out; };
  const loadImg = src => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; });

  // PNG: logo, registration number, QR, the e-ticket message and the registered date. No personal details.
  $('dl').onclick = async () => {
    try {
      await document.fonts.ready;
      const W = 1000, pad = 60, qrPx = 640, logo = await loadImg('../assets/images/logo-dark.png'), qr = qrCanvas(ticketUrl(), qrPx);
      const FONT = '"Manrope", system-ui, sans-serif', m = document.createElement('canvas').getContext('2d'); m.font = `500 28px ${FONT}`;
      const lines = wrap(m, FH.t('tk.sub'), W - pad * 2 - 40), logoH = 90, logoW = logo.width / logo.height * logoH;
      const H = pad + logoH + 50 + qr.height + 50 + 60 + lines.length * 40 + 30 + 40 + pad;
      const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d');
      x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);
      let y = pad; x.drawImage(logo, pad, y, logoW, logoH);
      x.textAlign = 'right'; x.fillStyle = '#0E2A47'; x.font = `500 26px ${FONT}`; x.fillText(FH.t('tk.regNo').toUpperCase(), W - pad, y + 34);
      x.font = `800 44px ${FONT}`; x.fillText(T.regNo, W - pad, y + 84);
      y += logoH + 50; x.drawImage(qr, (W - qr.width) / 2, y); y += qr.height + 50;
      x.textAlign = 'center'; x.font = `800 38px ${FONT}`; x.fillText(FH.t('tk.dlMsg'), W / 2, y + 30); y += 60;
      x.font = `500 28px ${FONT}`; x.fillStyle = '#1b2733'; lines.forEach(l => { y += 40; x.fillText(l, W / 2, y); });
      y += 30 + 40; x.fillStyle = '#566872'; x.fillText(`${FH.t('tk.registered')}: ${regAt()}`, W / 2, y);
      const blob = await new Promise(r => c.toBlob(r, 'image/png')), a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = `FerryHub-${T.regNo}.png`; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } catch (e) { $('dlErr').hidden = false; }
  };
  document.addEventListener('fh:lang', () => { if (T) { fill(); } });
  FH.apply(); load();
})();
