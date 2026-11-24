import { db, send, fail, PORTS } from './_lib.js';

// GET /api/ticket?t=<qr token>  ->  public, limited view. Never returns email, address or ID files.
export default async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: 'method' });
  const t = String(req.query.t || '');
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(t)) return send(res, 404, { error: 'not_found' });
  try {
    const sb = db();
    const { data: r } = await sb.from('registrations').select('id, reg_no, port_departure, port_arrival, travel_date, depart_time, registered_at, status, validated_at').eq('qr_token', t).maybeSingle();
    if (!r) return send(res, 404, { error: 'not_found' });
    const { data: pax, error } = await sb.from('passengers').select('position, full_name, category').eq('registration_id', r.id).order('position');
    if (error) throw error;
    send(res, 200, {
      regNo: r.reg_no, registeredAt: r.registered_at, status: r.status, validatedAt: r.validated_at,
      portDeparture: PORTS[r.port_departure], portArrival: PORTS[r.port_arrival],
      travelDate: r.travel_date, departTime: String(r.depart_time).slice(0, 5),
      passengers: pax.map(p => ({ position: p.position, name: p.full_name, category: p.category }))
    });
  } catch (e) { fail(res, e); }
}
