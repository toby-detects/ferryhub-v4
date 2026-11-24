const Auth = {
  HOME: { staff: 'passenger-records.html', admin: 'admin-dashboard.html' },
  session() { const s = Staff.get(); return s && s.profile ? s.profile : null; },
  /* Guard for pages in /pages. A Staff session cannot open Admin pages and an Admin session cannot open Staff pages. */
  require(role = 'staff') {
    const s = Auth.session();
    if (!s) { location.replace('../index.html'); return false; }
    if (s.role !== role) { location.replace(Auth.HOME[s.role]); return false; }
    return true;
  }
};

(() => {
  const form = document.getElementById('loginForm'); if (!form) return;
  const $ = id => document.getElementById(id), note = $('lnote');
  if (Auth.session()) { location.replace('pages/' + Auth.HOME[Auth.session().role]); return; }
  let role = 'staff';
  const COPY = { staff: ['Staff Login', 'Sign in to manage passengers, announcements and schedules.'], admin: ['Admin Login', 'Sign in to view analytics, booking records and staff accounts.'] };
  const rules = { username: V.req('Enter your username.'), password: V.req('Enter your password.') };
  V.live(form, rules);
  const pick = r => {
    role = r; note.hidden = true;
    $('segAdmin').classList.toggle('on', r === 'admin'); $('segStaff').classList.toggle('on', r === 'staff');
    $('segAdmin').setAttribute('aria-pressed', String(r === 'admin')); $('segStaff').setAttribute('aria-pressed', String(r === 'staff'));
    V.clear(form); form.reset(); $('lt').textContent = COPY[r][0]; document.querySelector('.lcard .sub').textContent = COPY[r][1]; document.title = COPY[r][0] + ' | FerryHub';
  };
  $('segAdmin').onclick = () => pick('admin'); $('segStaff').onclick = () => pick('staff');
  const pw = form.elements.password, eye = $('eye');
  eye.onclick = () => {
    const show = pw.type === 'password'; pw.type = show ? 'text' : 'password';
    eye.setAttribute('aria-label', show ? 'Hide password' : 'Show password'); eye.setAttribute('aria-pressed', String(show)); eye.classList.toggle('show', show);
  };
  const btn = form.querySelector('[type=submit]');
  form.onsubmit = async e => {
    e.preventDefault(); note.hidden = true;
    if (!V.run(form, rules)) return;
    btn.disabled = true; btn.textContent = 'Signing in…';
    try {
      const out = await Staff.raw('login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: form.elements.username.value, password: pw.value, role }) });
      Staff.set(out); location.href = 'pages/' + Auth.HOME[out.profile.role];
    } catch (err) {
      note.hidden = false; note.className = 'notice bad'; note.textContent = err.message;
      if (err.status === 401) ['username', 'password'].forEach(n => form.elements[n].closest('.field').classList.add('bad'));
      pw.value = ''; pw.focus(); btn.disabled = false; btn.textContent = 'Login';
    }
  };
})();
