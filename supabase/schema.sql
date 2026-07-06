create extension if not exists pgcrypto;

create table if not exists public.businesses (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null check (slug in ('scds', 'graphics')),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.payers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  full_name text not null,
  phone text,
  email text,
  type text not null check (type in ('student', 'client')),
  created_at timestamptz not null default now()
);

create table if not exists public.items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  payer_id uuid not null references public.payers(id),
  title text not null,
  total_amount numeric(14, 2) not null check (total_amount >= 0),
  due_date date,
  installment_count integer not null default 1 check (installment_count >= 1),
  installment_amount numeric(14, 2) not null default 0 check (installment_amount >= 0),
  installment_frequency text not null default 'once' check (installment_frequency in ('once', 'weekly', 'monthly')),
  balance_closed boolean not null default false,
  balance_closed_at timestamptz,
  balance_closed_reason text,
  created_at timestamptz not null default now()
);

alter table public.items add column if not exists installment_count integer not null default 1 check (installment_count >= 1);
alter table public.items add column if not exists installment_amount numeric(14, 2) not null default 0 check (installment_amount >= 0);
alter table public.items add column if not exists installment_frequency text not null default 'once' check (installment_frequency in ('once', 'weekly', 'monthly'));
alter table public.items add column if not exists balance_closed boolean not null default false;
alter table public.items add column if not exists balance_closed_at timestamptz;
alter table public.items add column if not exists balance_closed_reason text;

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  payer_id uuid not null references public.payers(id),
  item_id uuid not null references public.items(id),
  amount numeric(14, 2) not null check (amount >= 0),
  method text not null check (method in ('M-Pesa', 'Cash', 'Bank Transfer')),
  mpesa_code text,
  date date not null default current_date,
  status text not null check (status in ('Paid', 'Partial', 'Pending')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  is_deleted boolean not null default false,
  deleted_at timestamptz
);

alter table public.payments add column if not exists deleted_at timestamptz;

create table if not exists public.payment_audit_log (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id),
  action text not null check (action in ('created', 'edited', 'deleted', 'restored')),
  changed_fields jsonb not null default '[]'::jsonb,
  previous_values jsonb not null default '{}'::jsonb,
  changed_at timestamptz not null default now(),
  changed_by uuid references auth.users(id)
);

create table if not exists public.app_state_snapshots (
  id text primary key default 'primary',
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  constraint app_state_payload_shape check (
    jsonb_typeof(payload->'payers') = 'array'
    and jsonb_typeof(payload->'items') = 'array'
    and jsonb_typeof(payload->'payments') = 'array'
    and jsonb_typeof(payload->'auditLog') = 'array'
    and coalesce(jsonb_typeof(payload->'roles'), 'object') = 'object'
  )
);

create table if not exists public.user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin', 'staff')),
  created_at timestamptz not null default now()
);

create or replace function public.prevent_payment_hard_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Hard deletes are disabled. Set is_deleted = true instead.';
end;
$$;

drop trigger if exists payments_no_hard_delete on public.payments;
create trigger payments_no_hard_delete
before delete on public.payments
for each row execute function public.prevent_payment_hard_delete();

create or replace function public.touch_payment_and_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  changed text[] := '{}';
  previous jsonb := '{}'::jsonb;
  audit_action text;
begin
  if tg_op = 'INSERT' then
    insert into public.payment_audit_log(payment_id, action, changed_fields, previous_values, changed_by)
    values (new.id, 'created', to_jsonb(array['amount', 'method', 'status']), '{}'::jsonb, auth.uid());
    return new;
  end if;

  if old.amount is distinct from new.amount then
    changed := changed || 'amount';
    previous := previous || jsonb_build_object('amount', old.amount);
  end if;
  if old.method is distinct from new.method then
    changed := changed || 'method';
    previous := previous || jsonb_build_object('method', old.method);
  end if;
  if old.mpesa_code is distinct from new.mpesa_code then
    changed := changed || 'mpesa_code';
    previous := previous || jsonb_build_object('mpesa_code', old.mpesa_code);
  end if;
  if old.date is distinct from new.date then
    changed := changed || 'date';
    previous := previous || jsonb_build_object('date', old.date);
  end if;
  if old.status is distinct from new.status then
    changed := changed || 'status';
    previous := previous || jsonb_build_object('status', old.status);
  end if;
  if old.notes is distinct from new.notes then
    changed := changed || 'notes';
    previous := previous || jsonb_build_object('notes', old.notes);
  end if;
  if old.is_deleted is distinct from new.is_deleted then
    changed := changed || 'is_deleted';
    previous := previous || jsonb_build_object('is_deleted', old.is_deleted);
  end if;
  if old.deleted_at is distinct from new.deleted_at then
    changed := changed || 'deleted_at';
    previous := previous || jsonb_build_object('deleted_at', old.deleted_at);
  end if;

  new.updated_at := now();

  if array_length(changed, 1) is not null then
    audit_action := case
      when old.is_deleted = false and new.is_deleted = true then 'deleted'
      when old.is_deleted = true and new.is_deleted = false then 'restored'
      else 'edited'
    end;

    insert into public.payment_audit_log(payment_id, action, changed_fields, previous_values, changed_by)
    values (new.id, audit_action, to_jsonb(changed), previous, auth.uid());
  end if;

  return new;
end;
$$;

create or replace function public.touch_app_state_snapshot()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

drop trigger if exists app_state_snapshot_touch on public.app_state_snapshots;
create trigger app_state_snapshot_touch
before insert or update on public.app_state_snapshots
for each row execute function public.touch_app_state_snapshot();

drop trigger if exists payments_audit_insert on public.payments;
create trigger payments_audit_insert
after insert on public.payments
for each row execute function public.touch_payment_and_audit();

drop trigger if exists payments_audit_update on public.payments;
create trigger payments_audit_update
before update on public.payments
for each row execute function public.touch_payment_and_audit();

create or replace view public.payer_balances as
select
  i.business_id,
  i.payer_id,
  i.id as item_id,
  i.title,
  i.total_amount,
  i.installment_count,
  i.installment_amount,
  i.installment_frequency,
  i.balance_closed,
  i.balance_closed_at,
  i.balance_closed_reason,
  coalesce(sum(p.amount) filter (where p.is_deleted = false), 0) as total_paid,
  i.total_amount - coalesce(sum(p.amount) filter (where p.is_deleted = false), 0) as balance
from public.items i
left join public.payments p on p.item_id = i.id
where i.balance_closed = false
  and exists (
    select 1
    from public.payments active_payment
    where active_payment.item_id = i.id
      and active_payment.is_deleted = false
  )
group by i.business_id, i.payer_id, i.id, i.title, i.total_amount, i.installment_count, i.installment_amount, i.installment_frequency, i.balance_closed, i.balance_closed_at, i.balance_closed_reason;

create or replace view public.overdue_balances as
select
  pb.business_id,
  pb.payer_id,
  py.full_name as payer_name,
  py.phone,
  py.email,
  pb.item_id,
  pb.title as item_title,
  i.due_date,
  pb.balance,
  current_date - i.due_date as days_overdue
from public.payer_balances pb
join public.items i on i.id = pb.item_id
join public.payers py on py.id = pb.payer_id
where pb.balance > 0
  and i.due_date < current_date;

create or replace view public.monthly_income as
select
  business_id,
  date_trunc('month', date)::date as month,
  count(*) as transaction_count,
  sum(amount) as total_collected
from public.payments
where is_deleted = false
group by business_id, date_trunc('month', date);

create or replace view public.audit_history as
select
  l.id,
  l.payment_id,
  l.action,
  l.changed_fields,
  l.previous_values,
  l.changed_at,
  l.changed_by,
  p.date,
  p.amount,
  py.full_name as payer_name,
  b.name as business_name,
  i.title as item_title
from public.payment_audit_log l
join public.payments p on p.id = l.payment_id
join public.payers py on py.id = p.payer_id
join public.businesses b on b.id = p.business_id
join public.items i on i.id = p.item_id;

alter table public.businesses enable row level security;
alter table public.payers enable row level security;
alter table public.items enable row level security;
alter table public.payments enable row level security;
alter table public.payment_audit_log enable row level security;
alter table public.app_state_snapshots enable row level security;
alter table public.user_roles enable row level security;

create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select auth.role() = 'authenticated'
    and (
      exists (
        select 1
        from public.user_roles r
        where r.user_id = auth.uid()
          and r.role = 'admin'
      )
      or not exists (select 1 from public.user_roles)
    )
$$;

create or replace function public.is_staff_or_admin()
returns boolean
language sql
stable
as $$
  select auth.role() = 'authenticated'
    and (
      exists (
        select 1
        from public.user_roles r
        where r.user_id = auth.uid()
          and r.role in ('admin', 'staff')
      )
      or not exists (select 1 from public.user_roles)
    )
$$;

drop policy if exists "admin read businesses" on public.businesses;
drop policy if exists "admin write businesses" on public.businesses;
drop policy if exists "admin read payers" on public.payers;
drop policy if exists "admin write payers" on public.payers;
drop policy if exists "admin read items" on public.items;
drop policy if exists "admin write items" on public.items;
drop policy if exists "admin read payments" on public.payments;
drop policy if exists "admin write payments" on public.payments;
drop policy if exists "admin read audit" on public.payment_audit_log;
drop policy if exists "audit insert via trigger" on public.payment_audit_log;
drop policy if exists "admin read app state" on public.app_state_snapshots;
drop policy if exists "admin write app state" on public.app_state_snapshots;
drop policy if exists "online app state read" on public.app_state_snapshots;
drop policy if exists "online app state write" on public.app_state_snapshots;
drop policy if exists "admin read user roles" on public.user_roles;
drop policy if exists "admin write user roles" on public.user_roles;

create policy "admin read businesses" on public.businesses for select using (public.is_staff_or_admin());
create policy "admin write businesses" on public.businesses for all using (public.is_admin()) with check (public.is_admin());
create policy "admin read payers" on public.payers for select using (public.is_staff_or_admin());
create policy "admin write payers" on public.payers for all using (public.is_admin()) with check (public.is_admin());
create policy "admin read items" on public.items for select using (public.is_staff_or_admin());
create policy "admin write items" on public.items for all using (public.is_admin()) with check (public.is_admin());
create policy "admin read payments" on public.payments for select using (public.is_staff_or_admin());
create policy "admin write payments" on public.payments for all using (public.is_admin()) with check (public.is_admin());
create policy "admin read audit" on public.payment_audit_log for select using (public.is_staff_or_admin());
create policy "audit insert via trigger" on public.payment_audit_log for insert with check (public.is_admin());
create policy "online app state read" on public.app_state_snapshots for select using (true);
create policy "online app state write" on public.app_state_snapshots for all using (true) with check (true);
create policy "admin read user roles" on public.user_roles for select using (public.is_admin());
create policy "admin write user roles" on public.user_roles for all using (public.is_admin()) with check (public.is_admin());

insert into public.businesses (slug, name)
values
  ('scds', 'Sam Creative Design School'),
  ('graphics', 'Sam Creative Graphics')
on conflict (slug) do nothing;
