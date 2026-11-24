-- FerryHub: Stage 1 schema. Run once in Supabase > SQL Editor.
-- Browser code never talks to these tables directly. Only the Vercel API (secret key) does.
create extension if not exists pgcrypto;

-- Ports -----------------------------------------------------------------
create table if not exists public.ports (
  code text primary key,
  name text not null,        -- short name used in forms
  long_name text not null    -- long name printed on the e-ticket
);
insert into public.ports (code, name, long_name) values
  ('ANILAO',  'Mabini Anilao', 'ANILAO, MABINI, BATANGAS'),
  ('TINGLOY', 'Tingloy',       'TINGLOY, BATANGAS')
on conflict (code) do nothing;

-- Schedule: default timetable per port + per-date slots -----------------
create table if not exists public.schedule_templates (
  id uuid primary key default gen_random_uuid(),
  port text not null references public.ports(code),
  depart_time time not null,
  capacity int not null default 40 check (capacity >= 0),
  active boolean not null default true,
  unique (port, depart_time)
);
insert into public.schedule_templates (port, depart_time) 
select p.code, t::time from public.ports p,
  unnest(array['05:30','07:00','08:30','10:00','11:30','13:00','14:30','16:00']) as t
on conflict (port, depart_time) do nothing;

-- A slot row exists only once staff change something for a date, or passengers are validated on it.
create table if not exists public.slots (
  id uuid primary key default gen_random_uuid(),
  port text not null references public.ports(code),
  travel_date date not null,
  depart_time time not null,
  capacity int not null check (capacity >= 0),
  booked int not null default 0 check (booked >= 0),
  status text not null default 'available' check (status in ('available','full','cancelled')),
  unique (port, travel_date, depart_time)
);

-- Registrations: one booking = one registration number = one QR code ----
create table if not exists public.registration_counters (
  ym text primary key,            -- 'MMYY' in Philippine time
  last_seq int not null default 0
);

create table if not exists public.registrations (
  id uuid primary key default gen_random_uuid(),
  reg_no text not null unique,
  submission_key uuid not null unique,     -- stops a refresh/double-click from creating a second record
  qr_token text not null unique,           -- long random value that goes in the QR link
  port_departure text not null references public.ports(code),
  port_arrival text not null references public.ports(code),
  travel_date date not null,
  depart_time time not null,
  passenger_count int not null check (passenger_count between 1 and 20),
  registered_at timestamptz not null default now(),
  consent_at timestamptz not null,
  status text not null default 'registered' check (status in ('registered','validated','cancelled')),
  validated_at timestamptz,
  check (port_departure <> port_arrival)
);
create index if not exists registrations_travel_idx on public.registrations (port_departure, travel_date, depart_time);

create table if not exists public.passengers (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null references public.registrations(id) on delete cascade,
  position int not null,
  full_name text not null,
  age int not null check (age between 1 and 120),
  category text not null check (category in ('Regular','Student','Senior Citizen','PWD','Child')),
  classification text not null check (classification in ('Local','Tourist')),
  email text,
  region_code text not null, region_name text not null,
  province_code text not null, province_name text not null,
  city_code text not null, city_name text not null,
  barangay_code text not null, barangay_name text not null,
  street text,
  id_path text,                             -- private file in the 'ids' storage bucket
  unique (registration_id, position),
  check (category = 'Child' or (email is not null and email <> ''))
);

-- Announcements (read by the public site; written later by the staff portal) --
create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null default '',
  image_url text,
  status text not null default 'Draft' check (status in ('Active','Draft','Disabled')),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Functions ---------------------------------------------------------------
create or replace function public.next_registration_no() returns text
language plpgsql security definer set search_path = public as $$
declare k text := to_char(now() at time zone 'Asia/Manila', 'MMYY'); n int;
begin
  insert into registration_counters (ym, last_seq) values (k, 1)
  on conflict (ym) do update set last_seq = registration_counters.last_seq + 1
  returning last_seq into n;
  return 'RN' || k || lpad(n::text, 2, '0');       -- e.g. RN112601
end $$;

-- Open departure times for a port and date (not cancelled, not full, not already departed).
create or replace function public.public_slots(p_port text, p_date date)
returns table (depart_time time, remaining int)
language sql stable security definer set search_path = public as $$
  with t as (select st.depart_time, st.capacity from schedule_templates st where st.port = p_port and st.active),
  u as (select t.depart_time from t union select s.depart_time from slots s where s.port = p_port and s.travel_date = p_date),
  x as (
    select u.depart_time,
           coalesce(s.capacity, t.capacity, 0) as cap,
           coalesce(s.booked, 0) as booked,
           coalesce(s.status, 'available') as st
    from u left join t on t.depart_time = u.depart_time
           left join slots s on s.port = p_port and s.travel_date = p_date and s.depart_time = u.depart_time
  )
  select x.depart_time, x.cap - x.booked from x
  where x.st = 'available' and x.cap - x.booked > 0
    and (p_date > (now() at time zone 'Asia/Manila')::date
         or (p_date = (now() at time zone 'Asia/Manila')::date and x.depart_time > (now() at time zone 'Asia/Manila')::time))
  order by x.depart_time;
$$;

-- Creates the registration and all passengers in ONE transaction. Safe to call twice with the same key.
create or replace function public.create_registration(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_key uuid := (p->>'submission_key')::uuid;
  v_port text := p->>'port_departure';
  v_arr text := p->>'port_arrival';
  v_date date := (p->>'travel_date')::date;
  v_time time := (p->>'depart_time')::time;
  r registrations%rowtype; pax jsonb; i int := 0; existing boolean := false;
begin
  perform pg_advisory_xact_lock(hashtext(v_key::text));
  select * into r from registrations where submission_key = v_key;
  if found then
    existing := true;
  else
    if not exists (select 1 from public_slots(v_port, v_date) s where s.depart_time = v_time) then
      raise exception 'SLOT_UNAVAILABLE';
    end if;
    insert into registrations (reg_no, submission_key, qr_token, port_departure, port_arrival, travel_date, depart_time, passenger_count, consent_at)
    values (next_registration_no(), v_key, translate(encode(gen_random_bytes(24), 'base64'), '+/=', '-_'),
            v_port, v_arr, v_date, v_time, jsonb_array_length(p->'passengers'), now())
    returning * into r;
    for pax in select * from jsonb_array_elements(p->'passengers') loop
      i := i + 1;
      insert into passengers (registration_id, position, full_name, age, category, classification, email,
        region_code, region_name, province_code, province_name, city_code, city_name, barangay_code, barangay_name, street)
      values (r.id, i, pax->>'full_name', (pax->>'age')::int, pax->>'category', pax->>'classification', nullif(pax->>'email',''),
        pax->>'region_code', pax->>'region_name', pax->>'province_code', pax->>'province_name',
        pax->>'city_code', pax->>'city_name', pax->>'barangay_code', pax->>'barangay_name', nullif(pax->>'street',''));
    end loop;
  end if;
  return jsonb_build_object('reg_no', r.reg_no, 'token', r.qr_token, 'registered_at', r.registered_at, 'existing', existing,
    'missing_ids', coalesce((select jsonb_agg(position order by position) from passengers where registration_id = r.id and id_path is null), '[]'::jsonb));
end $$;

-- Security: nothing here is reachable from the browser ------------------------
alter table public.ports enable row level security;
alter table public.schedule_templates enable row level security;
alter table public.slots enable row level security;
alter table public.registration_counters enable row level security;
alter table public.registrations enable row level security;
alter table public.passengers enable row level security;
alter table public.announcements enable row level security;
-- Only published announcements may be read with the public (publishable) key.
drop policy if exists "public reads active announcements" on public.announcements;
create policy "public reads active announcements" on public.announcements for select to anon, authenticated using (status = 'Active');

revoke execute on function public.next_registration_no() from public, anon, authenticated;
revoke execute on function public.public_slots(text, date) from public, anon, authenticated;
revoke execute on function public.create_registration(jsonb) from public, anon, authenticated;
grant execute on function public.next_registration_no() to service_role;
grant execute on function public.public_slots(text, date) to service_role;
grant execute on function public.create_registration(jsonb) to service_role;

-- Private storage for passenger IDs (2 MB per file; images are shrunk in the browser) ----
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ids', 'ids', false, 2097152, array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do update set public = false, file_size_limit = 2097152,
  allowed_mime_types = array['image/jpeg','image/png','image/webp','application/pdf'];
