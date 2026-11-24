import { randomBytes } from 'node:crypto';
import { db, send, PORTS, UUID, isDate } from './_lib.js';

// One function for the whole staff portal (Vercel's free plan allows only 12 functions).
// Call it as /api/staff?a=<action>. Every action except login/refresh needs "Authorization: Bearer <access token>".
// All data rules live in the database functions (supabase/02_staff.sql); this file checks who is calling and which port they may touch.

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const bad = m => new HttpError(400, m);
const ERR = {
  NOT_FOUND: [404, 'Not found.'], FORBIDDEN: [403, 'You cannot change records of the other port.'],
  WRONG_PORT: [403, 'This ticket belongs to the other port.'], ALREADY_VALIDATED: [409, 'This ticket was already validated.'],
  CANCELLED: [409, 'This registration was cancelled.'], WRONG_DATE: [409, 'This ticket is not for today’s date.'],
  SLOT_CANCELLED: [409, 'This departure was cancelled.'], OVER_CAPACITY: [409, 'Not enough seats left in this departure. Raise its capacity in Manage Schedule, then validate again.'],
  HAS_REGISTRATIONS: [409, 'Passengers are already registered for this time. Change the time only after those trips, or cancel the slot for a date instead.'],
  TIME_EXISTS: [409, 'That departure time already exists for this port.'], NO_SEATS: [400, 'No seats are left. Increase the capacity or set the status to Full.'],
  BOOKED_OVER_CAPACITY: [400, 'Booked passengers cannot exceed capacity.'], BAD_CAPACITY: [400, 'Capacity must be a whole number from 0 to 500.'],
  BAD_BOOKED: [400, 'Booked passengers must be a whole number, 0 or more.'], BAD_STATUS: [400, 'Invalid status.'], BAD_TIME: [400, 'Enter a valid departure time.'],
  BAD_NAME: [400, 'Enter a valid full name (no numbers).'], BAD_AGE: [400, 'Enter an age from 1 to 120.'], BAD_AGE_SENIOR: [400, 'Senior citizens must be 60 or older.'],
  BAD_AGE_CHILD: [400, 'Children must be 11 or younger.'], BAD_CATEGORY: [400, 'Choose a valid category.'], BAD_CLASS: [400, 'Choose Local or Tourist.'],
  BAD_EMAIL: [400, 'Enter a valid email address.'], BAD_ADDRESS: [400, 'Choose the complete address (region, province, city, barangay).'],
  BAD_FARE: [400, 'A fare must be a number from 0 to 9,999,999 with at most 2 decimals, or left empty.']
};
const mapErr = e => { const k = String((e && e.message) || '').trim(); return ERR[k] ? new HttpError(...ERR[k]) : e; };
async function rpc(fn, args) { const { data, error } = await db().rpc(fn, args); if (error) throw mapErr(error); return data; }

const authKey = () => process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_SECRET_KEY;
async function authCall(grant, body) {
  const r = await fetch(`${process.env.SUPABASE_URL}/auth/v1/token?grant_type=${grant}`, { method: 'POST', headers: { apikey: authKey(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, j };
}
const pub = p => ({ id: p.id, username: p.username, displayName: p.display_name || p.username, role: p.role, port: p.port });
const PROFILE = 'id, username, display_name, role, port, active';

async function getActor(req) {
  const h = String(req.headers.authorization || ''), jwt = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!jwt) throw new HttpError(401, 'Please log in.');
  const { data, error } = await db().auth.getUser(jwt);
  if (error || !data.user) throw new HttpError(401, 'Your session expired. Please log in again.');
  const { data: p } = await db().from('profiles').select(PROFILE).eq('id', data.user.id).maybeSingle();
  if (!p || !p.active) throw new HttpError(403, 'This account is not active.');
  return p;
}
// Staff are always limited to their own port. Admins choose a port (or ALL where allowed).
function portOf(a, wanted, allowAll = false) {
  if (a.role === 'staff') return a.port;
  if (allowAll && (!wanted || wanted === 'ALL')) return null;
  if (PORTS[wanted]) return wanted;
  throw bad('Choose a port.');
}
const needAdmin = a => { if (a.role !== 'admin') throw new HttpError(403, 'Only an administrator can do this.'); };
const time = t => { if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(t || ''))) throw bad('Enter a valid departure time.'); return t; };
const int = (v, name) => { const n = Number(v); if (!Number.isInteger(n)) throw bad(`${name} must be a whole number.`); return n; };

const handlers = {
  async login(req) {
    const b = req.body || {}, username = String(b.username || '').trim().toLowerCase(), password = String(b.password || ''), want = b.role === 'admin' ? 'admin' : 'staff';
    const fail = () => new HttpError(401, 'Incorrect username or password.');
    if (!username || !password) throw fail();
    const { data: p } = await db().from('profiles').select(PROFILE).eq('username', username).maybeSingle();
    if (!p || !p.active) throw fail();
    const { data: u } = await db().auth.admin.getUserById(p.id);
    if (!u || !u.user) throw fail();
    const t = await authCall('password', { email: u.user.email, password });
    if (!t.ok) throw fail();
    if (p.role !== want) throw new HttpError(403, p.role === 'admin' ? 'This is an Admin account. Use the Admin tab.' : 'This is a Staff account. Use the Staff tab.');
    return { accessToken: t.j.access_token, refreshToken: t.j.refresh_token, expiresAt: t.j.expires_at, profile: pub(p) };
  },
  async refresh(req) {
    const t = await authCall('refresh_token', { refresh_token: String((req.body || {}).refreshToken || '') });
    if (!t.ok) throw new HttpError(401, 'Your session expired. Please log in again.');
    return { accessToken: t.j.access_token, refreshToken: t.j.refresh_token, expiresAt: t.j.expires_at };
  },
  async me(req, a) { return { profile: pub(a) }; },

  // ---- Passenger records ----
  async 'passengers.list'(req, a) { return { passengers: await rpc('staff_passengers', { p_role: a.role, p_port: portOf(a, req.query.port, true) }) }; },
  async 'passengers.update'(req, a) {
    const b = req.body || {}; if (!UUID.test(String(b.id))) throw bad('Invalid passenger.');
    await rpc('staff_update_passenger', { p_role: a.role, p_port: a.port, p_id: b.id, p: b }); return { ok: true };
  },
  async 'passengers.idurl'(req, a) {
    if (!UUID.test(String(req.query.id))) throw bad('Invalid passenger.');
    const path = await rpc('staff_passenger_idpath', { p_role: a.role, p_port: a.port, p_id: req.query.id });
    if (!path) throw new HttpError(404, 'No ID file found.');
    const { data, error } = await db().storage.from('ids').createSignedUrl(path, 60);
    if (error) throw error; return { url: data.signedUrl };
  },

  // ---- Schedule ----
  async 'schedule.month'(req, a) {
    const m = String(req.query.month || ''); if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) throw bad('Invalid month.');
    const rows = await rpc('staff_month_summary', { p_port: portOf(a, req.query.port), p_month: m + '-01' });
    return { days: rows.map(r => ({ day: r.day, live: r.live, full: r.full_count, cancelled: r.cancelled })) };
  },
  async 'schedule.day'(req, a) {
    if (!isDate(req.query.date)) throw bad('Invalid date.');
    const rows = await rpc('staff_day_slots', { p_port: portOf(a, req.query.port), p_date: req.query.date });
    return { slots: rows.map(r => ({ time: String(r.depart_time).slice(0, 5), capacity: r.capacity, booked: r.booked, status: r.status, fromTemplate: r.from_template, registeredPax: r.registered_pax })) };
  },
  async 'schedule.slot'(req, a) {
    const b = req.body || {}; if (!isDate(b.date)) throw bad('Invalid date.');
    await rpc('staff_save_slot', { p_port: portOf(a, b.port), p_date: b.date, p_time: time(b.time), p_capacity: int(b.capacity, 'Capacity'), p_booked: int(b.booked, 'Booked passengers'), p_status: String(b.status) });
    return { ok: true };
  },
  async 'schedule.templates'(req, a) {
    const rows = await rpc('staff_templates', { p_port: portOf(a, req.query.port) });
    return { templates: rows.map(r => ({ id: r.id, time: String(r.depart_time).slice(0, 5), capacity: r.capacity, active: r.active, upcoming: r.upcoming_registrations })) };
  },
  async 'schedule.template'(req, a) {
    const b = req.body || {}; if (b.id && !UUID.test(String(b.id))) throw bad('Invalid time.');
    await rpc('staff_save_template', { p_port: portOf(a, b.port), p_id: b.id || null, p_time: time(b.time), p_capacity: int(b.capacity, 'Capacity'), p_active: b.active !== false });
    return { ok: true };
  },

  // ---- Tickets ----
  async 'ticket.preview'(req, a) {
    const ref = String(req.query.ref || '').trim(); if (!/^[A-Za-z0-9_-]{4,64}$/.test(ref)) throw new HttpError(404, 'Not found.');
    const t = await rpc('staff_ticket', { p_role: a.role, p_port: a.port, p_ref: ref });
    // Each passenger's ID is shown through a private link that expires after 5 minutes. File paths never leave the server.
    const store = db().storage.from('ids');
    t.passengers = await Promise.all((t.passengers || []).map(async ({ idPath, ...p }) => {
      let idUrl = null, idKind = null;
      if (idPath) { const { data } = await store.createSignedUrl(idPath, 300); if (data) { idUrl = data.signedUrl; idKind = /\.pdf$/i.test(idPath) ? 'pdf' : 'image'; } }
      return { ...p, hasId: !!idPath, idUrl, idKind };
    }));
    return t;
  },
  async 'ticket.validate'(req, a) {
    const ref = String((req.body || {}).ref || '').trim(); if (!/^[A-Za-z0-9_-]{4,64}$/.test(ref)) throw new HttpError(404, 'Not found.');
    return await rpc('validate_ticket', { p_role: a.role, p_port: a.port, p_user: a.id, p_ref: ref });
  },

  // ---- Announcements (shared by both ports; shown on the public Announcements page when Active) ----
  async 'announcements.list'() {
    const { data, error } = await db().from('announcements').select('id, title, body, image_url, status, published_at, created_at, updated_at').order('created_at', { ascending: false }).limit(200);
    if (error) throw error; return { announcements: data };
  },
  async 'announcements.save'(req, a) {
    const b = req.body || {}, title = String(b.title || '').trim(), body = String(b.body || '').trim(), status = b.status;
    if (title.length < 3 || title.length > 100) throw bad('Enter a title of 3 to 100 characters.');
    if (body.length < 10 || body.length > 5000) throw bad('Enter the announcement text (10 to 5000 characters).');
    if (!['Active', 'Draft', 'Disabled'].includes(status)) throw bad('Choose a status.');
    const base = process.env.SUPABASE_URL + '/storage/v1/object/public/announcement-images/';
    const img = b.imageUrl ? String(b.imageUrl) : null;
    if (img && !img.startsWith(base)) throw bad('Invalid image.');
    const row = { title, body, status, image_url: img, updated_at: new Date().toISOString() };
    if (b.id) {
      if (!UUID.test(String(b.id))) throw bad('Invalid announcement.');
      const { data: cur } = await db().from('announcements').select('published_at').eq('id', b.id).maybeSingle();
      if (!cur) throw new HttpError(404, 'Not found.');
      if (status === 'Active' && !cur.published_at) row.published_at = new Date().toISOString();
      const { error } = await db().from('announcements').update(row).eq('id', b.id); if (error) throw error;
    } else {
      if (status === 'Active') row.published_at = new Date().toISOString();
      const { error } = await db().from('announcements').insert({ ...row, created_by: a.id }); if (error) throw error;
    }
    return { ok: true };
  },
  async 'announcements.delete'(req) {
    const ids = (req.body || {}).ids; if (!Array.isArray(ids) || !ids.length || ids.length > 100 || !ids.every(i => UUID.test(String(i)))) throw bad('Invalid selection.');
    const { error } = await db().from('announcements').delete().in('id', ids); if (error) throw error; return { ok: true };
  },
  async 'announcements.image'(req) {
    const type = String(req.headers['x-file-type'] || ''), ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[type], buf = req.body;
    if (!ext) throw bad('Use a JPG, PNG or WEBP image.');
    if (!Buffer.isBuffer(buf) || !buf.length) throw bad('No image received.');
    if (buf.length > 2 * 1024 * 1024) throw new HttpError(413, 'The image must be 2 MB or smaller.');
    const path = `${randomBytes(12).toString('hex')}.${ext}`, st = db().storage.from('announcement-images');
    const { error } = await st.upload(path, buf, { contentType: type, upsert: false }); if (error) throw error;
    return { url: st.getPublicUrl(path).data.publicUrl };
  },

  // ---- Admin: booking data for the dashboard, fares ----
  async 'admin.bookings'(req, a) { needAdmin(a); return { bookings: await rpc('admin_bookings', {}) }; },
  async 'admin.fares'(req, a) { needAdmin(a); return { fares: await rpc('admin_fares', {}) }; },
  async 'admin.fares.save'(req, a) { needAdmin(a); const b = req.body || {}; if (!b.fares || typeof b.fares !== 'object') throw bad('Invalid fares.'); await rpc('admin_save_fares', { p: b.fares }); return { ok: true }; },
  async 'admin.fares.backfill'(req, a) { needAdmin(a); return { updated: await rpc('admin_backfill_fares', {}) }; },

  // ---- Accounts (admin only; the Admin screen lists Staff accounts) ----
  async 'accounts.list'(req, a) {
    needAdmin(a);
    const { data, error } = await db().from('profiles').select(PROFILE + ', created_at, seq').eq('role', 'staff').order('seq'); if (error) throw error;
    const last = {};
    try { const r = await db().auth.admin.listUsers({ page: 1, perPage: 1000 }); (r.data.users || []).forEach(u => { last[u.id] = u.last_sign_in_at; }); } catch (e) { /* last login is optional */ }
    return { accounts: data.map(p => ({ ...pub(p), seq: Number(p.seq), active: p.active, createdAt: p.created_at, lastLogin: last[p.id] || null })) };
  },
  async 'accounts.create'(req, a) {
    needAdmin(a);
    const b = req.body || {}, username = String(b.username || '').trim().toLowerCase(), password = String(b.password || ''), port = b.port, name = String(b.displayName || '').trim(), active = b.active !== false;
    if (!/^[a-z0-9._-]{3,30}$/.test(username)) throw bad('Username: 3 to 30 letters, numbers, dots, dashes or underscores.');
    if (password.length < 8 || password.length > 72) throw bad('Password must be 8 to 72 characters.');
    if (!PORTS[port]) throw bad('Choose the staff member’s port.');
    if (name.length > 60) throw bad('Name is too long.');
    const { data: dup } = await db().from('profiles').select('id').eq('username', username).maybeSingle(); if (dup) throw new HttpError(409, 'That username is already taken.');
    const email = `${username}@${process.env.STAFF_EMAIL_DOMAIN || 'staff.ferryhub.app'}`;
    const { data: u, error } = await db().auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw new HttpError(400, 'Could not create the login: ' + error.message);
    const { error: pe } = await db().from('profiles').insert({ id: u.user.id, username, display_name: name || null, role: 'staff', port, active });
    if (pe) { await db().auth.admin.deleteUser(u.user.id); throw pe; }
    if (!active) await db().auth.admin.updateUserById(u.user.id, { ban_duration: '876000h' });
    return { ok: true };
  },
  async 'accounts.delete'(req, a) {
    needAdmin(a);
    const ids = (req.body || {}).ids; if (!Array.isArray(ids) || !ids.length || ids.length > 100 || !ids.every(i => UUID.test(String(i)))) throw bad('Invalid selection.');
    const { data } = await db().from('profiles').select('id, role').in('id', ids);
    if (!data || data.length !== ids.length || data.some(p => p.role !== 'staff')) throw bad('Only existing Staff accounts can be deleted.');
    for (const id of ids) { const { error } = await db().auth.admin.deleteUser(id); if (error) throw new HttpError(400, 'Could not delete: ' + error.message); }
    return { deleted: ids.length };
  },
  async 'accounts.update'(req, a) {
    needAdmin(a);
    const b = req.body || {}; if (!UUID.test(String(b.id))) throw bad('Invalid account.');
    const { data: p } = await db().from('profiles').select(PROFILE).eq('id', b.id).maybeSingle(); if (!p) throw new HttpError(404, 'Not found.');
    const row = {};
    if (b.port !== undefined) { if (p.role !== 'staff' || !PORTS[b.port]) throw bad('Choose a valid port.'); row.port = b.port; }
    if (b.displayName !== undefined) { const n = String(b.displayName).trim(); if (n.length > 60) throw bad('Name is too long.'); row.display_name = n || null; }
    if (b.active !== undefined) {
      if (b.id === a.id && !b.active) throw bad('You cannot deactivate your own account.');
      row.active = !!b.active;
    }
    if (!Object.keys(row).length) return { ok: true };
    const { error } = await db().from('profiles').update(row).eq('id', b.id); if (error) throw error;
    if (row.active !== undefined) await db().auth.admin.updateUserById(b.id, { ban_duration: row.active ? 'none' : '876000h' });
    return { ok: true };
  },
  async 'accounts.reset'(req, a) {
    needAdmin(a);
    const b = req.body || {}, pw = String(b.password || ''); if (!UUID.test(String(b.id))) throw bad('Invalid account.');
    if (pw.length < 8 || pw.length > 72) throw bad('Password must be 8 to 72 characters.');
    const { error } = await db().auth.admin.updateUserById(b.id, { password: pw }); if (error) throw new HttpError(400, error.message);
    return { ok: true };
  }
};
const READ = new Set(['admin.bookings', 'admin.fares', 'me', 'passengers.list', 'passengers.idurl', 'schedule.month', 'schedule.day', 'schedule.templates', 'ticket.preview', 'announcements.list', 'accounts.list']);

export default async function handler(req, res) {
  const a = String(req.query.a || ''), fn = handlers[a];
  if (!fn) return send(res, 404, { error: 'unknown_action', message: 'Unknown action.' });
  if (req.method !== (READ.has(a) ? 'GET' : 'POST')) return send(res, 405, { error: 'method' });
  try {
    const actor = a === 'login' || a === 'refresh' ? null : await getActor(req);
    send(res, 200, await fn(req, actor));
  } catch (e) {
    if (e instanceof HttpError) return send(res, e.status, { error: 'request', message: e.message });
    console.error(e);
    send(res, 500, { error: 'server', message: e && e.message === 'CONFIG_MISSING' ? 'The server is not configured yet.' : 'Something went wrong. Please try again.' });
  }
}
