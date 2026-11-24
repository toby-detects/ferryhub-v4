-- FerryHub: Admin dashboard data. Run AFTER 01_schema.sql and 02_staff.sql. Safe to run twice.
-- Adds fares (so revenue can be counted), account numbers, safe account deletion, and passenger ID access for the ticket scanner.

-- ---- Fares: one price per passenger category. Empty until the admin sets them (no prices are invented). ----
create table if not exists public.fares (
  category text primary key check (category in ('Regular','Student','Senior Citizen','PWD','Child')),
  amount numeric(10,2) not null check (amount >= 0),
  updated_at timestamptz not null default now()
);
alter table public.fares enable row level security;
-- The fare each passenger had when they registered (later fare changes never rewrite history).
alter table public.passengers add column if not exists fare numeric(10,2) check (fare >= 0);

-- Readable account number for the admin screen (ST-0001, ...).
alter table public.profiles add column if not exists seq bigint generated always as identity;

-- Deleting a staff account must not be blocked by tickets they validated.
alter table public.registrations drop constraint if exists registrations_validated_by_fkey;
alter table public.registrations add constraint registrations_validated_by_fkey foreign key (validated_by) references public.profiles(id) on delete set null;
alter table public.validation_log drop constraint if exists validation_log_validated_by_fkey;
alter table public.validation_log add constraint validation_log_validated_by_fkey foreign key (validated_by) references public.profiles(id) on delete set null;

-- ---- Registration now records each passenger's fare ----
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
        region_code, region_name, province_code, province_name, city_code, city_name, barangay_code, barangay_name, street, fare)
      values (r.id, i, pax->>'full_name', (pax->>'age')::int, pax->>'category', pax->>'classification', nullif(pax->>'email',''),
        pax->>'region_code', pax->>'region_name', pax->>'province_code', pax->>'province_name',
        pax->>'city_code', pax->>'city_name', pax->>'barangay_code', pax->>'barangay_name', nullif(pax->>'street',''),
        (select f.amount from fares f where f.category = pax->>'category'));
    end loop;
  end if;
  return jsonb_build_object('reg_no', r.reg_no, 'token', r.qr_token, 'registered_at', r.registered_at, 'existing', existing,
    'missing_ids', coalesce((select jsonb_agg(position order by position) from passengers where registration_id = r.id and id_path is null), '[]'::jsonb));
end $$;

-- ---- Ticket preview for staff: now also carries each passenger's ID file path (the API turns it into a short-lived link) ----
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
    'passengers', (select jsonb_agg(jsonb_build_object('position', position, 'name', full_name, 'age', age, 'category', category, 'email', email, 'idPath', id_path) order by position)
                   from passengers where registration_id = r.id));
end $$;

-- ---- Admin dashboard: one record per booking. Status: registered = Confirmed, validated = Verified. ----
create or replace function public.admin_bookings() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(to_jsonb(x) order by x."registeredAt" desc), '[]'::jsonb) from (
    select r.reg_no as "regNo", r.passenger_count as pax, po.name as port, r.travel_date as "departDate",
           to_char(r.depart_time, 'HH24:MI') as "departTime",
           to_char(r.registered_at at time zone 'Asia/Manila', 'YYYY-MM-DD"T"HH24:MI:SS') || '+08:00' as "registeredAt",
           coalesce(f.total, 0)::float8 as "totalFee", (f.unpriced > 0) as "feeMissing",
           case r.status when 'validated' then 'Verified' when 'cancelled' then 'Cancelled' else 'Confirmed' end as status,
           f.pax as passengers
    from registrations r
    join ports po on po.code = r.port_departure
    cross join lateral (
      select jsonb_agg(jsonb_build_object('category', x.category, 'fare', x.fare) order by x.position) as pax,
             sum(x.fare) as total, count(*) filter (where x.fare is null) as unpriced
      from passengers x where x.registration_id = r.id) f
    order by r.registered_at desc limit 50000
  ) x;
$$;

create or replace function public.admin_fares() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_agg(jsonb_build_object('category', c.category, 'amount', f.amount) order by c.ord)
  from (values ('Regular', 1), ('Student', 2), ('Senior Citizen', 3), ('PWD', 4), ('Child', 5)) as c(category, ord)
  left join fares f on f.category = c.category;
$$;

create or replace function public.admin_save_fares(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare k text; v numeric;
begin
  for k in select * from jsonb_object_keys(p) loop
    if k not in ('Regular','Student','Senior Citizen','PWD','Child') then raise exception 'BAD_CATEGORY'; end if;
    if p->>k is null or p->>k = '' then
      delete from fares where category = k;
    else
      if p->>k !~ '^\d{1,7}(\.\d{1,2})?$' then raise exception 'BAD_FARE'; end if;
      v := (p->>k)::numeric;
      insert into fares (category, amount) values (k, v) on conflict (category) do update set amount = excluded.amount, updated_at = now();
    end if;
  end loop;
end $$;

-- Gives today's fares to earlier passengers that were registered before fares existed. Returns how many were updated.
create or replace function public.admin_backfill_fares() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update passengers p set fare = f.amount from fares f where p.fare is null and f.category = p.category;
  get diagnostics n = row_count; return n;
end $$;

do $$ declare f text; begin
  foreach f in array array['create_registration(jsonb)','staff_ticket(text,text,text)','admin_bookings()','admin_fares()','admin_save_fares(jsonb)','admin_backfill_fares()'] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop; end $$;
