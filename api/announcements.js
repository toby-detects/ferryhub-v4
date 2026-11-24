import { db, send, fail } from './_lib.js';

// GET /api/announcements -> { announcements: [{ id, title, body, imageUrl, publishedAt }] }  (Active only)
export default async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: 'method' });
  try {
    const { data, error } = await db().from('announcements').select('id, title, body, image_url, published_at, created_at')
      .eq('status', 'Active').order('published_at', { ascending: false, nullsFirst: false }).limit(50);
    if (error) throw error;
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    res.status(200).json({ announcements: data.map(a => ({ id: a.id, title: a.title, body: a.body, imageUrl: a.image_url, publishedAt: a.published_at || a.created_at })) });
  } catch (e) { fail(res, e); }
}
