// Announcements are read from a configurable source (js/config.js), so another system can supply them later.
(() => {
  const feed = document.getElementById('feed'), state = document.getElementById('state'), cfg = FH_CONFIG.ANNOUNCEMENTS || {};
  const safeImg = u => typeof u === 'string' && (/^https:\/\//i.test(u) || /^data:image\/(png|jpe?g|webp);base64,/i.test(u) || /^\/(?!\/)/.test(u)) ? u : '';
  const normalize = a => ({
    id: a.id, title: String(a.title || ''), body: String(a.body ?? a.content ?? ''),
    image: safeImg(a.imageUrl ?? a.image ?? a.image_url), date: a.publishedAt ?? a.date ?? a.published_at ?? a.updated ?? '',
    status: a.status
  });
  const fmt = d => { const t = Date.parse(d); return t ? new Date(t).toLocaleDateString(FH.lang() === 'tl' ? 'fil-PH' : 'en-PH', { timeZone: 'Asia/Manila', dateStyle: 'long' }) : ''; };
  let items = [];

  function draw() {
    feed.textContent = '';
    for (const a of items) {
      const el = document.createElement('article'); el.className = 'pill-card an-card';
      const h = document.createElement('h2'); h.textContent = a.title; el.append(h);
      const d = fmt(a.date); if (d) { const p = document.createElement('p'); p.className = 'an-date'; p.textContent = d; el.append(p); }
      if (a.image) { const i = document.createElement('img'); i.src = a.image; i.alt = ''; i.loading = 'lazy'; i.className = 'an-img'; el.append(i); }
      if (a.body) { const p = document.createElement('p'); p.className = 'an-body'; p.textContent = a.body; el.append(p); }
      feed.append(el);
    }
  }
  function show(key, retry) {
    state.hidden = !key; if (!key) return;
    state.innerHTML = `<p data-i18n="${key}">${FH.t(key)}</p>` + (retry ? `<button class="btn btn-g" id="retry" data-i18n="an.retry">${FH.t('an.retry')}</button>` : '');
    if (retry) document.getElementById('retry').onclick = load;
  }
  async function load() {
    show('an.loading');
    try {
      let list;
      if (cfg.source === 'url' && cfg.url) { const r = await fetch(cfg.url, { headers: { Accept: 'application/json' } }); if (!r.ok) throw new Error(r.status); list = await r.json(); }
      else list = await FH.api('/announcements');
      list = Array.isArray(list) ? list : (list.announcements || []);
      items = list.map(normalize).filter(a => a.title && (!a.status || String(a.status).toLowerCase() === 'active'));
      draw(); show(items.length ? '' : 'an.empty');
    } catch (e) { items = []; draw(); show('an.error', true); }
  }
  document.addEventListener('fh:lang', draw);
  FH.apply(); load();
})();
