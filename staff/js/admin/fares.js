(() => {
  const $ = id => document.getElementById(id), f = $('f');
  const CATS = ['Regular', 'Student', 'Senior Citizen', 'PWD', 'Child'], LABEL = { PWD: 'Person with Disability', Child: 'Children' };
  const AMOUNT = /^\d{1,7}(\.\d{1,2})?$/;
  $('grid').innerHTML = CATS.map((c, i) => `<div class="field"><label for="fr${i}">${LABEL[c] || c}</label><div class="peso"><span aria-hidden="true">₱</span><input id="fr${i}" name="${c}" inputmode="decimal" placeholder="Not set" autocomplete="off"></div><p class="err" hidden></p></div>`).join('');
  const rules = Object.fromEntries(CATS.map(c => [c, v => v.trim() === '' || AMOUNT.test(v.trim()) ? '' : 'Enter an amount like 100 or 85.50.']));
  V.live(f, rules);
  async function load() {
    try { (await Staff.api('admin.fares')).fares.forEach(r => { f.elements[r.category].value = r.amount == null ? '' : Number(r.amount); }); }
    catch (e) { $('ferr').hidden = false; $('ferr').textContent = UI.err(e); }
  }
  f.onsubmit = async e => {
    e.preventDefault(); $('ferr').hidden = true; if (!V.run(f, rules)) return;
    const btn = $('save'); btn.disabled = true;
    try { await Staff.api('admin.fares.save', { method: 'POST', body: { fares: Object.fromEntries(CATS.map(c => [c, f.elements[c].value.trim()])) } }); UI.toast('Fares saved. They apply to new registrations.', 'ok'); load(); }
    catch (err) { $('ferr').hidden = false; $('ferr').textContent = UI.err(err); } finally { btn.disabled = false; }
  };
  $('backfill').onclick = async () => {
    if (!await UI.confirm('Apply current fares?', 'Passengers registered before fares were set will get today’s fares. Passengers that already have a fare are not changed.', 'Apply fares')) return;
    try { const r = await Staff.api('admin.fares.backfill', { method: 'POST', body: {} }); UI.toast(r.updated ? `${r.updated} passenger${r.updated === 1 ? '' : 's'} updated.` : 'Nothing to update.', 'ok'); }
    catch (err) { UI.toast(UI.err(err), 'warn'); }
  };
  load();
})();
