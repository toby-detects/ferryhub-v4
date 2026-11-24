import { createClient } from '@supabase/supabase-js';

let client;
export function db() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) throw new Error('CONFIG_MISSING');
  client ??= createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}

export const PORTS = {
  ANILAO: { code: 'ANILAO', name: 'Mabini Anilao', long: 'ANILAO, MABINI, BATANGAS', other: 'TINGLOY' },
  TINGLOY: { code: 'TINGLOY', name: 'Tingloy', long: 'TINGLOY, BATANGAS', other: 'ANILAO' }
};
export const MAX_DAYS = 60;

export function send(res, code, body) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(code).json(body);
}
export function fail(res, e) {
  console.error(e);
  if (e && e.message === 'CONFIG_MISSING') return send(res, 500, { error: 'server_config', message: 'The server is not configured yet.' });
  return send(res, 500, { error: 'server', message: 'Something went wrong. Please try again.' });
}

// "Today" in the Philippines, as YYYY-MM-DD.
export function phToday(offsetDays = 0) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date()).map(x => [x.type, x.value]));
  const d = new Date(Date.UTC(+p.year, +p.month - 1, +p.day + offsetDays));
  return d.toISOString().slice(0, 10);
}
export const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + 'T00:00:00Z')) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;
export const dateInWindow = s => isDate(s) && s >= phToday() && s <= phToday(MAX_DAYS);
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const CATS = { regular: 'Regular', student: 'Student', senior: 'Senior Citizen', pwd: 'PWD', child: 'Child' };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Server-side check of a registration request. Returns { error } or { value } (clean data for create_registration).
export function validateRegistration(b) {
  const bad = (field, message) => ({ error: { field, message } });
  if (!b || typeof b !== 'object') return bad('body', 'Invalid request.');
  if (!UUID.test(String(b.submission_key || ''))) return bad('submission_key', 'Invalid submission key.');
  const dep = PORTS[b.port_departure];
  if (!dep) return bad('port_departure', 'Choose a valid Port of Departure.');
  if (!dateInWindow(b.travel_date)) return bad('travel_date', 'Choose a departure date from today up to ' + MAX_DAYS + ' days ahead.');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(b.depart_time || ''))) return bad('depart_time', 'Choose a departure time.');
  if (b.consent !== true) return bad('consent', 'Consent is required.');
  const list = b.passengers;
  if (!Array.isArray(list) || list.length < 1 || list.length > 20) return bad('passengers', 'A booking needs 1 to 20 passengers.');
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const p = list[i] || {}, n = i + 1, cat = CATS[p.category];
    if (!cat) return bad(`p${n}.category`, `Passenger ${n}: invalid category.`);
    const name = String(p.name || '').trim().replace(/\s+/g, ' ');
    if (name.length < 2 || name.length > 100 || /\d/.test(name)) return bad(`p${n}.name`, `Passenger ${n}: enter a valid full name.`);
    const age = Number(p.age);
    if (!Number.isInteger(age) || age < 1 || age > 120) return bad(`p${n}.age`, `Passenger ${n}: enter an age from 1 to 120.`);
    if (cat === 'Senior Citizen' && age < 60) return bad(`p${n}.age`, `Passenger ${n}: senior citizens must be 60 or older.`);
    if (cat === 'Child' && age > 11) return bad(`p${n}.age`, `Passenger ${n}: children must be 11 or younger.`);
    const cls = { local: 'Local', tourist: 'Tourist' }[p.classification];
    if (!cls) return bad(`p${n}.classification`, `Passenger ${n}: choose Local or Tourist.`);
    const email = String(p.email || '').trim().toLowerCase();
    if (cat !== 'Child' && (!email || email.length > 254 || !EMAIL.test(email))) return bad(`p${n}.email`, `Passenger ${n}: enter a valid email address.`);
    const a = p.address || {};
    const lv = ['region', 'province', 'city', 'barangay'].map(k => a[k] || {});
    const [rg, pv, ct, bg] = lv;
    for (const [k, x] of [['region', rg], ['province', pv], ['city', ct], ['barangay', bg]])
      if (!/^\d{2,9}$/.test(String(x.code || '')) || !String(x.name || '').trim() || String(x.name).length > 120) return bad(`p${n}.${k}`, `Passenger ${n}: choose your ${k}.`);
    // codes are hierarchical, so each must start with its parent's code
    if (!String(pv.code).startsWith(String(rg.code)) || !String(ct.code).startsWith(String(pv.code)) || !String(bg.code).startsWith(String(ct.code)))
      return bad(`p${n}.address`, `Passenger ${n}: the address selection does not match.`);
    const street = String(p.street || '').trim();
    if (street.length > 120) return bad(`p${n}.street`, `Passenger ${n}: house no. / street is too long.`);
    out.push({ full_name: name, age, category: cat, classification: cls, email: cat === 'Child' ? '' : email,
      region_code: String(rg.code), region_name: String(rg.name).trim(), province_code: String(pv.code), province_name: String(pv.name).trim(),
      city_code: String(ct.code), city_name: String(ct.name).trim(), barangay_code: String(bg.code), barangay_name: String(bg.name).trim(), street });
  }
  if (out.every(p => p.category === 'Child')) return bad('passengers', 'A booking needs at least one passenger who is not a child.');
  return { value: { submission_key: b.submission_key.toLowerCase(), port_departure: dep.code, port_arrival: dep.other, travel_date: b.travel_date, depart_time: b.depart_time, passengers: out } };
}
