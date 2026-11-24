import { db, send, fail, PORTS, isDate, dateInWindow } from './_lib.js';

// GET /api/slots?port=ANILAO&date=2026-11-18  ->  { slots: [{ time: "07:00", remaining: 40 }] }
export default async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: 'method' });
  const { port, date } = req.query;
  if (!PORTS[port] || !isDate(date)) return send(res, 400, { error: 'bad_request', message: 'Invalid port or date.' });
  if (!dateInWindow(date)) return send(res, 200, { slots: [] });
  try {
    const { data, error } = await db().rpc('public_slots', { p_port: port, p_date: date });
    if (error) throw error;
    send(res, 200, { slots: (data || []).map(r => ({ time: String(r.depart_time).slice(0, 5), remaining: r.remaining })) });
  } catch (e) { fail(res, e); }
}
