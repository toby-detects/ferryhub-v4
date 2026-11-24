# FerryHub: passenger site, staff portal and API

Static site (HTML/CSS/vanilla JS) + Vercel serverless functions in `/api` + Supabase (Postgres and private file storage).

## 1. Supabase (once)
1. Supabase dashboard > SQL Editor > New query > paste all of `supabase/01_schema.sql` > Run. It is safe to run twice.
2. Check: Table Editor shows `ports`, `schedule_templates`, `slots`, `registrations`, `passengers`, `announcements`, `registration_counters`; Storage shows a private bucket `ids`.
3. Project Settings > API keys: copy the **secret** key (`sb_secret_...`). Never put it in code or share it.

## 2. GitHub + Vercel
1. Put this folder in a GitHub repository (the `.gitignore` already skips `node_modules` and secrets).
2. Vercel > Add New > Project > import the repository. Framework preset: **Other**. Leave Build Command and Output Directory empty.
3. Before the first deploy, Settings > Environment Variables (Production, Preview, Development):
   - `SUPABASE_URL` = `https://lusaxphiqliaopjsrxzi.supabase.co`
   - `SUPABASE_SECRET_KEY` = your secret key
4. Deploy. Open the site, make a test registration, scan the QR with a phone.
5. Optional: add your photo as `assets/images/hero.jpg` (until then a sky-to-sea gradient shows).

## 3. How it works
- Booking: `/api/slots` returns open times for the chosen port and date (from `schedule_templates` / `slots`). Arrival is always the other port.
- Registration: `/api/register` validates everything again on the server, then one database transaction creates the registration (number `RN` + MM + YY + sequence, e.g. `RN112601`) and its passengers. A repeat with the same `submission_key` returns the same record, so refresh or double-click never duplicates. IDs go through `/api/upload-id` into the private `ids` bucket.
- QR code: contains only `https://<your-site>/pages/ticket.html?t=<long random token>`. `/api/ticket` returns a limited view (names, categories, ports, schedule, registered date). Email, address and ID files are never returned publicly.
- Registrations do not use seats. Seat counts change only when staff validate tickets (Stage 2).

## 4. Announcements (future integration)
`js/config.js` > `ANNOUNCEMENTS`. Default `source: 'api'` reads Active rows from the `announcements` table. To use another system set `source: 'url'` and `url` to a JSON endpoint (CORS enabled) returning an array, or `{ "announcements": [...] }`, of
`{ id, title, body, imageUrl, publishedAt, status }`. Only `status` "Active" (any case) is shown. Titles and bodies are shown as plain text.

## 5. Address data
`data/ph/` is split from https://github.com/wilfredpine/philippine-address-selector (MIT). One file per province (cities and barangays) loads when a province is chosen.


# Staff and Admin portals (`/staff/`)

Open `https://<your-site>/staff/`. Staff and Admin log in on the same page with a username and password (choose the matching tab). They are separate areas: a Staff login cannot open Admin pages and an Admin login cannot open Staff pages.

## One-time setup
1. Supabase > SQL Editor: run `supabase/02_staff.sql`, then `supabase/03_admin.sql` (each pasted as text, after `01_schema.sql`). Both are safe to run twice.
2. Create the first admin login: Supabase > Authentication > Users > Add user > Create new user (email + password, tick **Auto Confirm User**).
3. Make that user an admin (SQL Editor, with YOUR email):
   `insert into public.profiles (id, username, display_name, role) select id, 'admin', 'Administrator', 'admin' from auth.users where email = 'YOUR-ADMIN-EMAIL@example.com';`
4. Vercel > Settings > Environment Variables: `SUPABASE_URL`, `SUPABASE_SECRET_KEY` and `SUPABASE_PUBLISHABLE_KEY`. Redeploy after any change.
5. Log in on the **Admin** tab, open **Fares** and enter the fare for each passenger category, then Save. (No prices are built in.)
6. Open **Account Management** and create the Staff logins, choosing each one's port.

Optional variable: `STAFF_EMAIL_DOMAIN` (default `staff.ferryhub.app`). Staff logins are stored as `<username>@<that domain>` inside Supabase Auth.

## Admin area
- **Dashboard**: overall performance, booking trends, predictive analytics (needs 12 complete months of history) and revenue analytics, for both ports, in Manila time.
- **Booking Records**: one row per booking (registration number). Shows passenger categories and fares, never names, emails, addresses or IDs.
- **Account Management**: staff accounts only (create, update, disable, delete). Last login comes from Supabase.
- **Fares**: one fare per category. A passenger's fare is saved when they register, so changing a fare later does not change past bookings. "Apply current fares to earlier registrations" prices passengers who registered before fares were set.

## How the dashboard numbers are built
- A booking = one registration number. Status: registered online = **Confirmed**, validated by staff at the port = **Verified**, cancelled = **Cancelled**.
- Total Bookings and Total Passengers count Confirmed + Verified (not Cancelled), by the date the passenger registered.
- **Revenue counts Verified bookings only** (fares paid and verified at the ticketing station). To count Confirmed bookings as revenue too, edit `REVENUE_STATUSES` in `staff/js/admin/data-api.js`.
- Bookings registered before fares were set count as zero revenue until you apply fares; the dashboard shows a notice with a link.

## Staff area
- Staff see and change only their own port: Passenger Records, Announcement, Manage Schedule, and **Validate Ticket**.
- Validate Ticket (camera QR scan or type the registration number) shows every passenger with their **email and ID** (image, or a link for a PDF; links expire after 5 minutes). Confirming adds the booking's passengers to that departure's booked count. Own port only, only on the travel date, only once, and blocked when it would exceed capacity.
- Registering does not take seats. Seats count only when a ticket is validated.
- Default departure times (Manage Schedule > Default departure times) are what passengers can book. A time with upcoming registered passengers cannot be moved or switched off.
- Announcements are shared by both ports. Active ones appear on the passenger site.
- Reserved, not built: Trip Information Records, Register Passenger (shown as "Under Progress").
