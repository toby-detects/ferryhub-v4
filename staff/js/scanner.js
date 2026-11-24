// Validate Ticket: scan the passenger's QR with the camera (or type the registration number), review, then confirm.
const Scanner = (() => {
  let dlg, stream, raf, busy = false, ref = null;
  const $ = s => dlg.querySelector(s);
  const build = () => {
    dlg = document.createElement('dialog'); dlg.className = 'dlg scan'; dlg.setAttribute('aria-labelledby', 'sc-t');
    dlg.innerHTML = `<div class="dlg-head"><h2 id="sc-t">Validate Ticket</h2><button type="button" class="iconbtn" data-x aria-label="Close">&#10005;</button></div>
      <div class="scan-body">
        <div class="scan-cam" data-cam><video playsinline muted></video><div class="scan-frame" aria-hidden="true"></div></div>
        <p class="hint" data-hint>Point the camera at the passenger’s QR code.</p>
        <form class="scan-manual" data-manual novalidate><div class="field"><label for="sc-ref">Or type the registration number</label>
          <div class="row2"><input id="sc-ref" autocomplete="off" placeholder="e.g. RN112601" maxlength="64"><button class="btn btn-primary" type="submit">Find</button></div></div></form>
        <div data-result hidden></div><p class="err" data-err hidden role="alert"></p>
      </div>`;
    document.body.append(dlg);
    $('[data-x]').onclick = () => dlg.close();
    dlg.addEventListener('close', stop);
    $('[data-manual]').onsubmit = e => { e.preventDefault(); const v = $('#sc-ref').value.trim(); if (v) lookup(v); };
  };
  const setErr = m => { const e = $('[data-err]'); e.hidden = !m; e.textContent = m || ''; };
  const stop = () => { cancelAnimationFrame(raf); if (stream) stream.getTracks().forEach(t => t.stop()); stream = null; };
  async function startCamera() {
    const v = $('video'), cam = $('[data-cam]'), hint = $('[data-hint]');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { cam.hidden = true; hint.textContent = 'Camera is not available on this device or page. Type the registration number instead.'; return; }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      v.srcObject = stream; await v.play(); cam.hidden = false; hint.textContent = 'Point the camera at the passenger’s QR code.';
      const c = document.createElement('canvas'), x = c.getContext('2d', { willReadFrequently: true });
      const loop = () => {
        if (!stream) return;
        if (!busy && !ref && v.readyState >= 2 && v.videoWidth) {
          const w = Math.min(640, v.videoWidth), h = Math.round(w * v.videoHeight / v.videoWidth); c.width = w; c.height = h; x.drawImage(v, 0, 0, w, h);
          const r = jsQR(x.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' });
          if (r && r.data) { const t = parse(r.data); if (t) { lookup(t); } }
        }
        raf = requestAnimationFrame(loop);
      };
      loop();
    } catch (e) { cam.hidden = true; hint.textContent = 'Could not open the camera (' + (e.name === 'NotAllowedError' ? 'permission was denied' : 'not available') + '). Type the registration number instead.'; }
  }
  // QR holds .../ticket.html?t=<token>. A bare token or registration number also works.
  function parse(text) {
    text = String(text).trim();
    try { const u = new URL(text); const t = u.searchParams.get('t'); return t && /^[A-Za-z0-9_-]{4,64}$/.test(t) ? t : null; }
    catch (e) { return /^[A-Za-z0-9_-]{4,64}$/.test(text) ? text : null; }
  }
  // One card per passenger: name, category and age, email, and the ID they uploaded (private link, expires in 5 minutes).
  const idHtml = p => !p.idUrl ? '<span class="badge s-draft">No ID on file</span>'
    : p.idKind === 'pdf' ? `<a class="btn btn-line" href="${UI.esc(p.idUrl)}" target="_blank" rel="noopener noreferrer">Open ID (PDF)</a>`
    : `<a href="${UI.esc(p.idUrl)}" target="_blank" rel="noopener noreferrer" title="Open full size"><img class="pid-img" src="${UI.esc(p.idUrl)}" alt="ID of ${UI.esc(p.name)}" loading="lazy"></a>`;
  const emailHtml = p => p.email ? `<a href="mailto:${UI.esc(p.email)}">${UI.esc(p.email)}</a>` : `<i>${p.category === 'Child' ? 'Not required for children' : 'No email on file'}</i>`;
  const paxHtml = p => `<li class="pax2"><div class="pax2-head"><b>${p.position}. ${UI.esc(p.name)}</b><span>${UI.esc(p.category)}, ${p.age}</span></div>
      <div class="pax2-row"><span class="k">Email</span><span>${emailHtml(p)}</span></div><div class="pax2-id">${idHtml(p)}</div></li>`;
  const row = (a, b) => `<div><dt>${a}</dt><dd>${b}</dd></div>`;
  async function lookup(r) {
    if (busy) return; busy = true; setErr(''); $('[data-result]').hidden = true;
    try { const t = await Staff.api('ticket.preview', { query: { ref: r } }); ref = r; show(t); }
    catch (e) { setErr(e.status === 404 ? 'No ticket found for that code.' : UI.err(e)); ref = null; }
    finally { busy = false; }
  }
  function show(t) {
    const res = $('[data-result]'); const me = UI.profile();
    const warn = t.status === 'validated' ? `Already validated on ${Time.stamp(t.validatedAt)}${t.validatedBy ? ' by ' + UI.esc(t.validatedBy) : ''}.`
      : t.status === 'cancelled' ? 'This registration was cancelled.' : !t.isToday ? `This ticket is for ${Time.longDate(t.travelDate)}, not today.` : '';
    res.hidden = false; $('[data-manual]').hidden = true; $('[data-cam]').hidden = true; $('[data-hint]').hidden = true;
    res.innerHTML = `<div class="scan-card ${warn ? 'bad' : 'ok'}"><div class="scan-head"><b>${UI.esc(t.regNo)}</b><span class="badge ${t.status === 'validated' ? 's-active' : 's-draft'}">${t.status}</span></div>
      <dl class="scan-info">${row('Route', `${PORT_NAMES[t.portDeparture]} → ${PORT_NAMES[t.portArrival]}`)}${row('Departure', `${Time.longDate(t.travelDate)}, ${Time.label(t.departTime)}`)}${row('Registered', Time.stamp(t.registeredAt))}${row('Passengers', t.passengerCount)}</dl>
      <ul class="scan-pax">${t.passengers.map(paxHtml).join('')}</ul>
      ${warn ? `<p class="notice bad">${warn}</p>` : `<p class="hint">Confirming adds ${t.passengerCount} passenger${t.passengerCount > 1 ? 's' : ''} to the ${Time.label(t.departTime)} departure.</p>`}</div>
      <div class="dlg-actions scan-actions"><button class="btn btn-line" data-again>Scan another</button>${warn ? '' : '<button class="btn btn-primary" data-ok>Validate ticket</button>'}</div>`;
    res.querySelectorAll('img.pid-img').forEach(im => { im.onerror = () => { im.outerHTML = '<span class="badge s-disabled">ID could not be loaded</span>'; }; });
    res.querySelector('[data-again]').onclick = reset;
    const ok = res.querySelector('[data-ok]');
    if (ok) ok.onclick = async () => {
      ok.disabled = true; ok.textContent = 'Validating…'; setErr('');
      try {
        const r = await Staff.api('ticket.validate', { method: 'POST', body: { ref } });
        res.innerHTML = `<div class="scan-card ok"><div class="scan-head"><b>${UI.esc(r.regNo)}</b><span class="badge s-active">validated</span></div>
          <p class="done-msg">${r.passengers} passenger${r.passengers > 1 ? 's' : ''} added. This departure now has <b>${r.booked} of ${r.capacity}</b> seats booked.</p></div>
          <div class="dlg-actions scan-actions"><button class="btn btn-line" data-close>Close</button><button class="btn btn-primary" data-again>Scan next ticket</button></div>`;
        res.querySelector('[data-again]').onclick = reset; res.querySelector('[data-close]').onclick = () => dlg.close();
        UI.toast('Ticket ' + r.regNo + ' validated.', 'ok'); document.dispatchEvent(new Event('fh:validated'));
      } catch (e) { setErr(UI.err(e)); ok.disabled = false; ok.textContent = 'Validate ticket'; }
    };
  }
  function resetUI() { ref = null; setErr(''); $('[data-result]').hidden = true; $('[data-manual]').hidden = false; $('[data-hint]').hidden = false; $('#sc-ref').value = ''; if (stream) $('[data-cam]').hidden = false; }
  function reset() { resetUI(); if (!stream) startCamera(); }
  return { open() { if (!dlg) build(); resetUI(); dlg.showModal(); if (!stream) startCamera(); } };
})();
