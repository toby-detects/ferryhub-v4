(() => {
  const $ = id => document.getElementById(id), sel = new Set(), PH = '../assets/images/announcement-placeholder.svg';
  let list = [], filter = 'All', q = '', editing = null, img = null;   // img: current image URL ('' / null = none)
  const visible = () => list.filter(a => (filter === 'All' || a.status === filter) && a.title.toLowerCase().includes(q.toLowerCase()));
  const tabs = () => { $('tabs').innerHTML = ['All', 'Active', 'Draft', 'Disabled'].map(t => `<button class="tab" data-t="${t}" aria-pressed="${filter === t}">${t} (${t === 'All' ? list.length : list.filter(a => a.status === t).length})</button>`).join(''); };
  const tools = () => {
    $('del').disabled = !sel.size; $('sel').textContent = sel.size ? ` (${sel.size})` : '';
    const v = visible(), n = v.filter(a => sel.has(a.id)).length; $('all').checked = v.length > 0 && n === v.length; $('all').indeterminate = n > 0 && n < v.length;
  };
  function render() {
    const v = visible(); tabs();
    $('rows').innerHTML = v.map(a => `<tr>
      <td><input type="checkbox" class="cb" data-id="${a.id}" ${sel.has(a.id) ? 'checked' : ''} aria-label="Select ${UI.esc(a.title)}"></td>
      <td><b style="font-family:Manrope,system-ui,sans-serif">${UI.esc(a.title)}</b></td>
      <td><img class="thumb" src="${UI.esc(a.image_url || PH)}" alt=""></td>
      <td><span class="badge s-${a.status.toLowerCase()}">${a.status}</span></td><td>${Time.stamp(a.created_at)}</td><td>${Time.stamp(a.updated_at)}</td>
      <td style="white-space:nowrap"><button class="iconbtn" data-e="${a.id}" aria-label="Edit ${UI.esc(a.title)}"><img src="../assets/icons/edit.png" alt=""></button>
      <button class="iconbtn" data-x="${a.id}" aria-label="Delete ${UI.esc(a.title)}"><img src="../assets/icons/trash.png" alt=""></button></td></tr>`).join('');
    $('empty').hidden = v.length > 0; if (!v.length) $('empty').textContent = list.length ? 'No announcements match.' : 'No announcements yet. Select “Add new announcement”.'; tools();
  }
  async function load() {
    $('empty').hidden = false; $('empty').textContent = 'Loading…';
    try { list = (await Staff.api('announcements.list')).announcements; sel.clear(); render(); }
    catch (e) { list = []; $('rows').innerHTML = ''; $('empty').hidden = false; $('empty').innerHTML = `${UI.esc(UI.err(e))} <button class="btn btn-line" id="retry">Try again</button>`; $('retry').onclick = load; }
  }
  $('tabs').onclick = e => { const b = e.target.closest('[data-t]'); if (b) { filter = b.dataset.t; sel.clear(); render(); } };
  $('q').oninput = e => { q = e.target.value; sel.clear(); render(); };
  $('all').onchange = e => { visible().forEach(a => e.target.checked ? sel.add(a.id) : sel.delete(a.id)); render(); };
  $('rows').onchange = e => { if (e.target.dataset.id) { e.target.checked ? sel.add(e.target.dataset.id) : sel.delete(e.target.dataset.id); tools(); } };
  async function remove(ids) {
    const one = ids.length === 1 ? list.find(a => a.id === ids[0]).title : '';
    if (!await UI.confirm('Delete announcement' + (ids.length > 1 ? 's' : '') + '?', one ? `"${one}" will be permanently removed from the passenger site.` : `${ids.length} announcements will be permanently removed.`)) return;
    try { await Staff.api('announcements.delete', { method: 'POST', body: { ids } }); UI.toast('Deleted.', 'ok'); load(); } catch (e) { UI.toast(UI.err(e), 'warn'); }
  }
  $('rows').onclick = e => { const x = e.target.closest('[data-x]'), ed = e.target.closest('[data-e]'); if (x) remove([x.dataset.x]); if (ed) open(ed.dataset.e); };
  $('del').onclick = () => remove([...sel]); $('add').onclick = () => open(null);
  $('upd').onclick = () => sel.size === 1 ? open([...sel][0]) : UI.toast('Select exactly one announcement to update.', 'warn');

  const f = $('f'), dlg = $('dlg');
  const rules = { title: v => v.trim().length < 3 ? 'Enter a title (at least 3 characters).' : '', body: v => v.trim().length < 10 ? 'Enter the announcement text (at least 10 characters).' : '', status: V.req('Choose a status.') };
  V.live(f, rules);
  const preview = () => { $('pv').src = img || PH; $('imn').textContent = img ? 'Image attached.' : 'No image. A blank placeholder is shown here.'; $('rmimg').hidden = !img; };
  function open(id) {
    editing = id ? list.find(a => a.id === id) : null; V.clear(f); f.reset(); f.elements.image.value = ''; $('ferr').hidden = true;
    $('dt').textContent = editing ? 'Update announcement' : 'Add announcement'; img = editing ? editing.image_url : null;
    if (editing) { f.elements.title.value = editing.title; f.elements.body.value = editing.body; f.elements.status.value = editing.status; }
    preview(); dlg.showModal();
  }
  // Photos are shrunk to a banner size in the browser, then stored in public file storage (not inside the database).
  async function shrink(file) {
    const url = URL.createObjectURL(file);
    const im = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = url; });
    const s = Math.min(1, 1280 / im.width), c = document.createElement('canvas'); c.width = Math.round(im.width * s); c.height = Math.round(im.height * s);
    c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
    return new Promise(r => c.toBlob(r, 'image/jpeg', 0.82));
  }
  f.elements.image.onchange = async e => {
    const w = e.target.closest('.field'), file = e.target.files[0]; if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { V.setErr(w, 'Use a JPG, PNG or WEBP image.'); e.target.value = ''; return; }
    if (file.size > 15 * 1048576) { V.setErr(w, 'The image must be 15 MB or smaller.'); e.target.value = ''; return; }
    $('imn').textContent = 'Uploading…';
    try { const blob = await shrink(file); const r = await Staff.api('announcements.image', { method: 'POST', body: blob, headers: { 'Content-Type': 'application/octet-stream', 'X-File-Type': 'image/jpeg' } }); img = r.url; V.setErr(w, ''); }
    catch (err) { V.setErr(w, UI.err(err)); e.target.value = ''; }
    preview();
  };
  $('rmimg').onclick = () => { img = null; f.elements.image.value = ''; preview(); };
  const shut = () => dlg.close(); $('x').onclick = shut; $('cancel').onclick = shut;
  f.onsubmit = async e => {
    e.preventDefault(); $('ferr').hidden = true; if (!V.run(f, rules)) return;
    const b = $('save'); b.disabled = true; b.textContent = 'Saving…';
    try {
      await Staff.api('announcements.save', { method: 'POST', body: { id: editing ? editing.id : undefined, title: f.elements.title.value, body: f.elements.body.value, status: f.elements.status.value, imageUrl: img || null } });
      dlg.close(); UI.toast(editing ? 'Announcement updated.' : 'Announcement added.', 'ok'); load();
    } catch (err) { $('ferr').hidden = false; $('ferr').textContent = UI.err(err); }
    finally { b.disabled = false; b.textContent = 'Save'; }
  };
  load();
})();
