// Front-end settings. Nothing secret belongs in this file.
window.FH_CONFIG = {
  API_BASE: '/api',
  MAX_BOOKING_DAYS: 60,
  // Where the Announcements page reads from.
  //  source 'api' : this site's /api/announcements (Supabase table `announcements`, Active items only)
  //  source 'url' : any external JSON endpoint (needs CORS). Set `url` below.
  // Expected item shape (extra fields are ignored):
  //  { id, title, body, imageUrl, publishedAt, status }   status "Active" (case-insensitive) is shown; other values are hidden.
  ANNOUNCEMENTS: { source: 'api', url: '' }
};
