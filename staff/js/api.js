// Talks to the FerryHub server (/api/staff). The login session lives only in this browser tab (sessionStorage).
const Staff = {
  KEY: 'fh_staff_auth',
  get() { try { return JSON.parse(sessionStorage.getItem(Staff.KEY)); } catch (e) { return null; } },
  set(v) { try { sessionStorage.setItem(Staff.KEY, JSON.stringify(v)); } catch (e) {} },
  clear() { try { sessionStorage.removeItem(Staff.KEY); sessionStorage.removeItem('fh_staff_port'); } catch (e) {} },
  home() { return (document.body.dataset.root || '') + 'index.html'; },
  logout() { Staff.clear(); location.href = Staff.home(); },
  async raw(action, { method = 'GET', query = {}, body, headers = {}, token } = {}) {
    const qs = new URLSearchParams({ a: action, ...query });
    let r;
    try { r = await fetch('/api/staff?' + qs, { method, body, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers } }); }
    catch (e) { const err = new Error('Could not reach the server. Check your connection and try again.'); err.status = 0; throw err; }
    let j = null; try { j = await r.json(); } catch (e) {}
    if (!r.ok) { const err = new Error((j && j.message) || 'Request failed.'); err.status = r.status; throw err; }
    return j;
  },
  // Authenticated call. Refreshes an expired session once, then asks the person to log in again.
  async api(action, { method = 'GET', query = {}, body, headers = {} } = {}) {
    const bin = body instanceof Blob;
    const send = () => Staff.raw(action, { method, query, token: (Staff.get() || {}).accessToken, headers: { ...(body && !bin ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body === undefined ? undefined : bin ? body : JSON.stringify(body) });
    if (!Staff.get()) { Staff.logout(); throw new Error('Please log in.'); }
    try { return await send(); }
    catch (e) {
      const s = Staff.get();
      if (e.status === 401 && s && s.refreshToken) {
        try { const t = await Staff.raw('refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: s.refreshToken }) }); Staff.set({ ...s, ...t }); return await send(); }
        catch (e2) { Staff.logout(); throw e2; }
      }
      if (e.status === 401) Staff.logout();
      throw e;
    }
  }
};
