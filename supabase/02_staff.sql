-- FerryHub Stage 2: staff accounts by port, editable schedules, ticket validation. Run AFTER 01_schema.sql.
-- All of this is reached only through the Vercel API (secret key). Nothing here is open to the browser.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9._-]{3,30}$'),
  display_name text,
  role text not null check (role in ('admin','staff')),
  port text references public.ports(code),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (role = 'admin' or port is not null)
);

alter table public.registrations add column if not exists validated_by uuid references public.profiles(id);
alter table public.announcements add column if not exists created_by uuid;

create table if not exists public.validation_log (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null references public.registrations(id),
  validated_by uuid references public.profiles(id),
  port text not null,
  passengers int not null,
  travel_date date not null,
  depart_time time not null,
  validated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
alter table public.validation_log enable row level security;

-- Public bucket for announcement banners (anyone may view; only the API writes).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('announcement-images', 'announcement-images', true, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = true, file_size_limit = 2097152, allowed_mime_types = array['image/jpeg','image/png','image/webp'];

-- ---- Schedule -------------------------------------------------------------------------
-- Effective slots of a port on a date: default times + date-specific changes + one-off times.
create or replace function public.staff_day_slots(p_port text, p_date date)
returns table (depart_time time, capacity int, booked int, status text, from_template boolean, registered_pax int)
language sql stable security definer set search_path = public as $$
  with t as (select st.depart_time, st.capacity from schedule_templates st where st.port = p_port and st.active),
  u as (
    select t.depart_time from t
    union select s.depart_time from slots s where s.port = p_port and s.travel_date = p_date
    union select r.depart_time from registrations r where r.port_departure = p_port and r.travel_date = p_date and r.status <> 'cancelled'
  )
  select u.depart_time,
         coalesce(s.capacity, t.capacity, 0),
         coalesce(s.booked, 0),
         case when coalesce(s.status, 'available') = 'available' and coalesce(s.capacity, t.capacity, 0) - coalesce(s.booked, 0) <= 0
              then 'full' else coalesce(s.status, 'available') end,
         (t.depart_time is not null),
         coalesce((select sum(r.passenger_count)::int from registrations r
                   where r.port_departure = p_port and r.travel_date = p_date and r.depart_time = u.depart_time and r.status = 'registered'), 0)
  from u left join t on t.depart_time = u.depart_time
         left join slots s on s.port = p_port and s.travel_date = p_date and s.depart_time = u.depart_time
  order by u.depart_time;
$$;

create or replace function public.staff_month_summary(p_port text, p_month date)
returns table (day date, live int, full_count int, cancelled int)
language sql stable security definer set search_path = public as $$
  select d::date,
         (count(*) filter (where x.status <> 'cancelled'))::int,
         (count(*) filter (where x.status = 'full'))::int,
         (count(*) filter (where x.status = 'cancelled'))::int
  from generate_series(date_trunc('month', p_month)::date, (date_trunc('month', p_month) + interval '1 month - 1 day')::date, interval '1 day') d
  cross join lateral staff_day_slots(p_port, d::date) x
  group by d order by d;
$$;

create or replace function public.staff_save_slot(p_port text, p_date date, p_time time, p_capacity int, p_booked int, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_capacity is null or p_capacity < 0 or p_capacity > 500 then raise exception 'BAD_CAPACITY'; end if;
  if p_booked is null or p_booked < 0 then raise exception 'BAD_BOOKED'; end if;
  if p_booked > p_capacity then raise exception 'BOOKED_OVER_CAPACITY'; end if;
  if p_status not in ('available','full','cancelled') then raise exception 'BAD_STATUS'; end if;
  if p_status = 'available' and p_capacity - p_booked <= 0 then raise exception 'NO_SEATS'; end if;
  insert into slots (port, travel_date, depart_time, capacity, booked, status)
  values (p_port, p_date, p_time, p_capacity, p_booked, p_status)
  on conflict (port, travel_date, depart_time) do update set capacity = excluded.capacity, booked = excluded.booked, status = excluded.status;
end $$;

create or replace function public.staff_templates(p_port text)
returns table (id uuid, depart_time time, capacity int, active boolean, upcoming_registrations int)
language sql stable security definer set search_path = public as $$
  select st.id, st.depart_time, st.capacity, st.active,
    (select count(*)::int from registrations r where r.port_departure = st.port and r.depart_time = st.depart_time
       and r.travel_date >= (now() at time zone 'Asia/Manila')::date and r.status = 'registered')
  from schedule_templates st where st.port = p_port order by st.depart_time;
$$;

-- Default departure times. A time that has upcoming registered passengers cannot be moved or switched off.
create or replace function public.staff_save_template(p_port text, p_id uuid, p_time time, p_capacity int, p_active boolean)
returns void language plpgsql security definer set search_path = public as $$
declare cur schedule_templates%rowtype; n int;
begin
  if p_capacity is null or p_capacity < 0 or p_capacity > 500 then raise exception 'BAD_CAPACITY'; end if;
  if p_time is null then raise exception 'BAD_TIME'; end if;
  if p_id is null then
    insert into schedule_templates (port, depart_time, capacity, active) values (p_port, p_time, p_capacity, coalesce(p_active, true));
  else
    select * into cur from schedule_templates where id = p_id and port = p_port;
    if not found then raise exception 'NOT_FOUND'; end if;
    select count(*) into n from registrations r where r.port_departure = cur.port and r.depart_time = cur.depart_time
      and r.travel_date >= (now() at time zone 'Asia/Manila')::date and r.status = 'registered';
    if n > 0 and (p_time <> cur.depart_time or (cur.active and not coalesce(p_active, true))) then raise exception 'HAS_REGISTRATIONS'; end if;
    update schedule_templates set depart_time = p_time, capacity = p_capacity, active = coalesce(p_active, true) where id = p_id;
  end if;
exception when unique_violation then raise exception 'TIME_EXISTS';
end $$;

-- ---- Passengers ------------------------------------------------------------------------
create or replace function public.staff_passengers(p_role text, p_port text) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
    select p.id, p.position, p.full_name, p.age, p.category, p.classification, p.email,
           p.region_code, p.region_name, p.province_code, p.province_name, p.city_code, p.city_name, p.barangay_code, p.barangay_name, p.street,
           (p.id_path is not null) as has_id, r.reg_no, r.port_departure, r.port_arrival, r.travel_date, to_char(r.depart_time, 'HH24:MI') as depart_time, r.registered_at, r.status
    from passengers p join registrations r on r.id = p.registration_id
    where (p_role = 'admin' and (p_port is null or r.port_departure = p_port)) or (p_role = 'staff' and r.port_departure = p_port)
    order by r.registered_at desc, p.position limit 3000
  ) x;
$$;

create or replace function public.staff_passenger_idpath(p_role text, p_port text, p_id uuid) returns text
language sql stable security definer set search_path = public as $$
  select p.id_path from passengers p join registrations r on r.id = p.registration_id
  where p.id = p_id and (p_role = 'admin' or r.port_departure = p_port);
$$;

create or replace function public.staff_update_passenger(p_role text, p_port text, p_id uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare cur record; cat text := p->>'category'; a int; nm text := btrim(coalesce(p->>'full_name', '')); em text := lower(btrim(coalesce(p->>'email', '')));
begin
  select r.port_departure into cur from passengers x join registrations r on r.id = x.registration_id where x.id = p_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  if p_role <> 'admin' and cur.port_departure <> p_port then raise exception 'FORBIDDEN'; end if;
  if length(nm) < 2 or length(nm) > 100 or nm ~ '\d' then raise exception 'BAD_NAME'; end if;
  if coalesce(p->>'age', '') !~ '^\d{1,3}$' then raise exception 'BAD_AGE'; end if;
  a := (p->>'age')::int;
  if a < 1 or a > 120 then raise exception 'BAD_AGE'; end if;
  if cat not in ('Regular','Student','Senior Citizen','PWD','Child') then raise exception 'BAD_CATEGORY'; end if;
  if cat = 'Senior Citizen' and a < 60 then raise exception 'BAD_AGE_SENIOR'; end if;
  if cat = 'Child' and a > 11 then raise exception 'BAD_AGE_CHILD'; end if;
  if coalesce(p->>'classification', '') not in ('Local','Tourist') then raise exception 'BAD_CLASS'; end if;
  if cat <> 'Child' and (em !~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$' or length(em) > 254) then raise exception 'BAD_EMAIL'; end if;
  if coalesce(p->>'region_code', '') = '' or coalesce(p->>'barangay_name', '') = '' or coalesce(p->>'province_name', '') = '' or coalesce(p->>'city_name', '') = ''
     or not starts_with(p->>'province_code', p->>'region_code') or not starts_with(p->>'city_code', p->>'province_code') or not starts_with(p->>'barangay_code', p->>'city_code')
     then raise exception 'BAD_ADDRESS'; end if;
  update passengers set full_name = regexp_replace(nm, '\s+', ' ', 'g'), age = a, category = cat, classification = p->>'classification',
    email = case when cat = 'Child' then null else em end,
    region_code = p->>'region_code', region_name = p->>'region_name', province_code = p->>'province_code', province_name = p->>'province_name',
    city_code = p->>'city_code', city_name = p->>'city_name', barangay_code = p->>'barangay_code', barangay_name = p->>'barangay_name',
    street = nullif(btrim(coalesce(p->>'street', '')), '')
  where id = p_id;
end $$;

-- ---- Tickets ---------------------------------------------------------------------------
-- p_ref is the QR token or the registration number.
create or replace function public.staff_ticket(p_role text, p_port text, p_ref text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r registrations%rowtype; vname text;
begin
  select * into r from registrations where qr_token = p_ref or reg_no = upper(btrim(p_ref)) limit 1;
  if not found then raise exception 'NOT_FOUND'; end if;
  if p_role <> 'admin' and r.port_departure <> p_port then raise exception 'WRONG_PORT'; end if;
  select coalesce(display_name, username) into vname from profiles where id = r.validated_by;
  return jsonb_build_object('regNo', r.reg_no, 'status', r.status, 'portDeparture', r.port_departure, 'portArrival', r.port_arrival,
    'travelDate', r.travel_date, 'departTime', to_char(r.depart_time, 'HH24:MI'), 'registeredAt', r.registered_at,
    'validatedAt', r.validated_at, 'validatedBy', vname, 'isToday', r.travel_date = (now() at time zone 'Asia/Manila')::date,
    'passengerCount', r.passenger_count,
    'passengers', (select jsonb_agg(jsonb_build_object('position', position, 'name', full_name, 'age', age, 'category', category, 'email', email, 'hasId', id_path is not null) order by position)
                   from passengers where registration_id = r.id));
end $$;

-- Validates a booking at the port: adds its passengers to the slot's booked count, once, atomically.
create or replace function public.validate_ticket(p_role text, p_port text, p_user uuid, p_ref text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r registrations%rowtype; s slots%rowtype; cap int; today date := (now() at time zone 'Asia/Manila')::date;
begin
  select * into r from registrations where qr_token = p_ref or reg_no = upper(btrim(p_ref)) limit 1 for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if p_role <> 'admin' and r.port_departure <> p_port then raise exception 'WRONG_PORT'; end if;
  if r.status = 'validated' then raise exception 'ALREADY_VALIDATED'; end if;
  if r.status = 'cancelled' then raise exception 'CANCELLED'; end if;
  if r.travel_date <> today then raise exception 'WRONG_DATE'; end if;
  select capacity into cap from schedule_templates where port = r.port_departure and depart_time = r.depart_time;
  insert into slots (port, travel_date, depart_time, capacity) values (r.port_departure, r.travel_date, r.depart_time, coalesce(cap, 0))
  on conflict (port, travel_date, depart_time) do nothing;
  select * into s from slots where port = r.port_departure and travel_date = r.travel_date and depart_time = r.depart_time for update;
  if s.status = 'cancelled' then raise exception 'SLOT_CANCELLED'; end if;
  if s.capacity - s.booked < r.passenger_count then raise exception 'OVER_CAPACITY'; end if;
  update slots set booked = booked + r.passenger_count,
    status = case when booked + r.passenger_count >= capacity then 'full' else status end
  where id = s.id returning * into s;
  update registrations set status = 'validated', validated_at = now(), validated_by = p_user where id = r.id;
  insert into validation_log (registration_id, validated_by, port, passengers, travel_date, depart_time)
  values (r.id, p_user, r.port_departure, r.passenger_count, r.travel_date, r.depart_time);
  return jsonb_build_object('regNo', r.reg_no, 'passengers', r.passenger_count, 'booked', s.booked, 'capacity', s.capacity);
end $$;

do $$ declare f text; begin
  foreach f in array array[
    'staff_day_slots(text,date)','staff_month_summary(text,date)','staff_save_slot(text,date,time,int,int,text)','staff_templates(text)',
    'staff_save_template(text,uuid,time,int,boolean)','staff_passengers(text,text)','staff_passenger_idpath(text,text,uuid)',
    'staff_update_passenger(text,text,uuid,jsonb)','staff_ticket(text,text,text)','validate_ticket(text,text,uuid,text)'] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop; end $$;

-- ---- FIRST ADMIN (run once, after creating the user in Supabase > Authentication > Users) ----
-- Replace the email below with the email you used for that user, then run just this statement:
--   insert into public.profiles (id, username, display_name, role)
--   select id, 'admin', 'Administrator', 'admin' from auth.users where email = 'YOUR-ADMIN-EMAIL@example.com';
