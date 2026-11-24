import { db, send, fail, validateRegistration } from './_lib.js';

// POST /api/register  (JSON)  ->  { regNo, token, registeredAt, existing, missingIds: [1,2] }
// Safe to repeat: the same submission_key always returns the same registration.
export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method' });
  const v = validateRegistration(req.body);
  if (v.error) return send(res, 400, { error: 'invalid', ...v.error });
  try {
    const { data, error } = await db().rpc('create_registration', { p: v.value });
    if (error) {
      if (String(error.message).includes('SLOT_UNAVAILABLE')) return send(res, 409, { error: 'slot_unavailable', field: 'depart_time', message: 'That departure time is no longer available. Please choose another.' });
      throw error;
    }
    send(res, 200, { regNo: data.reg_no, token: data.token, registeredAt: data.registered_at, existing: data.existing, missingIds: data.missing_ids });
  } catch (e) { fail(res, e); }
}
