// Region > Province > City/Municipality > Barangay (data: ../../data/ph, adapted from wilfredpine/philippine-address-selector, MIT).
const PHAddr = {
  cache: new Map(),
  load(path) {
    if (!PHAddr.cache.has(path)) PHAddr.cache.set(path, fetch('../../data/ph/' + path).then(r => { if (r.status === 404) return []; if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).catch(e => { PHAddr.cache.delete(path); throw e; }));
    return PHAddr.cache.get(path);
  },
  regions: () => PHAddr.load('region.json'),
  provinces: rc => PHAddr.load('province.json').then(a => a.filter(x => x.r === rc)),
  province: pc => PHAddr.load('province/' + encodeURIComponent(pc) + '.json'),
  cities: pc => PHAddr.province(pc).then(a => a.map(x => ({ c: x.c, n: x.n }))),
  barangays: (cc, pc) => PHAddr.province(pc).then(a => (a.find(x => x.c === cc) || { b: [] }).b)
};
// Wires four <select>s (ids rg, pv, ct, bg) to a state object { rc, rn, pc, pn, cc, cn, bc, bn }.
function bindAddress(root, st, onChange = () => {}) {
  const LV = [['rg', 'rc', 'rn', 'Choose region', () => PHAddr.regions()], ['pv', 'pc', 'pn', 'Choose province', s => PHAddr.provinces(s.rc)],
    ['ct', 'cc', 'cn', 'Choose city / municipality', s => PHAddr.cities(s.pc)], ['bg', 'bc', 'bn', 'Choose barangay', s => PHAddr.barangays(s.cc, s.pc)]];
  const sel = k => root.querySelector(`[name="${k}"]`), esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const blank = j => { const [k, ck, nk, ph] = LV[j], s = sel(k); st[ck] = st[nk] = ''; s.innerHTML = `<option value="">${ph}</option>`; s.disabled = true; delete s.dataset.err; };
  async function fill(i) {
    const [k, ck, nk, ph, load] = LV[i], s = sel(k); s.disabled = true; delete s.dataset.err; s.innerHTML = '<option value="">Loading…</option>';
    try {
      const items = await load(st);
      s.innerHTML = `<option value="">${items.length ? ph : 'No options available'}</option>` + items.map(x => `<option value="${esc(x.c)}">${esc(x.n)}</option>`).join('');
      s.disabled = !items.length;
      if (st[ck] && items.some(x => x.c === st[ck])) s.value = st[ck]; else st[ck] = st[nk] = '';
    } catch (e) { s.innerHTML = '<option value="">Could not load. Tap to retry.</option>'; s.disabled = false; s.dataset.err = String(i); }
  }
  LV.forEach(([k], i) => {
    sel(k).addEventListener('change', e => {
      const s = e.target, [, ck, nk] = LV[i]; st[ck] = s.value; st[nk] = s.value ? s.options[s.selectedIndex].text : '';
      for (let j = i + 1; j < 4; j++) blank(j);
      if (s.value && i < 3) fill(i + 1); onChange(i);
    });
    sel(k).addEventListener('mousedown', e => { if (e.target.dataset.err) { e.preventDefault(); fill(Number(e.target.dataset.err)); } });
  });
  return { async init() { for (let i = 0; i < 4; i++) { if (i === 0 || st[LV[i - 1][1]]) await fill(i); else blank(i); } } };
}
