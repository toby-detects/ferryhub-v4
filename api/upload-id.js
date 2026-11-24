import { randomBytes } from 'node:crypto';
import { db, send, fail, UUID } from './_lib.js';

const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };
const MAX = 2 * 1024 * 1024;
const sniff = (b, t) => t === 'image/jpeg' ? b[0] === 0xff && b[1] === 0xd8
  : t === 'image/png' ? b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  : t === 'image/webp' ? b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP'
  : b.subarray(0, 4).toString() === '%PDF';

// POST /api/upload-id?k=<submission_key>&i=<passenger number>   body: the file (application/octet-stream)
// Only works for a registration created in the last 30 minutes, and never overwrites an existing ID.
export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method' });
  const { k, i } = req.query, pos = Number(i), type = String(req.headers['x-file-type'] || '');
  if (!UUID.test(String(k)) || !Number.isInteger(pos) || pos < 1 || pos > 20) return send(res, 400, { error: 'bad_request', message: 'Invalid request.' });
  if (!TYPES[type]) return send(res, 400, { error: 'file_type', message: 'Use a JPG, PNG, WEBP or PDF file.' });
  const buf = Buffer.isBuffer(req.body) ? req.body : null;
  if (!buf || !buf.length) return send(res, 400, { error: 'empty', message: 'No file received.' });
  if (buf.length > MAX) return send(res, 413, { error: 'too_large', message: 'The file must be 2 MB or smaller.' });
  if (!sniff(buf, type)) return send(res, 400, { error: 'file_type', message: 'The file does not match its type.' });
  try {
    const sb = db();
    const { data: reg } = await sb.from('registrations').select('id, registered_at').eq('submission_key', String(k).toLowerCase()).maybeSingle();
    if (!reg || Date.now() - Date.parse(reg.registered_at) > 30 * 60 * 1000) return send(res, 404, { error: 'not_found', message: 'Registration not found or the upload window has closed.' });
    const { data: pax } = await sb.from('passengers').select('id, id_path').eq('registration_id', reg.id).eq('position', pos).maybeSingle();
    if (!pax) return send(res, 404, { error: 'not_found', message: 'Passenger not found.' });
    if (pax.id_path) return send(res, 200, { ok: true, already: true });
    const path = `${reg.id}/${pos}-${randomBytes(6).toString('hex')}.${TYPES[type]}`;
    const up = await sb.storage.from('ids').upload(path, buf, { contentType: type, upsert: false });
    if (up.error) throw up.error;
    const { error } = await sb.from('passengers').update({ id_path: path }).eq('id', pax.id).is('id_path', null);
    if (error) throw error;
    send(res, 200, { ok: true });
  } catch (e) { fail(res, e); }
}
