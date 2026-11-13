-- ============================================================================
-- BARBER-CORE SAAS — SCRIPT SQL PARA COLAR NO "SQL EDITOR" DO SUPABASE (OPÇÃO A)
-- ============================================================================

create table if not exists public.barber_shops (
  id text primary key,
  slug text unique not null,
  name text not null,
  owner_login text unique not null,
  password_hash text not null,
  active boolean not null default true
);

create table if not exists public.barber_staff (
  id text primary key,
  shop_id text not null references public.barber_shops(id) on delete cascade,
  name text not null,
  commission_rate_bps integer not null check (commission_rate_bps between 0 and 10000),
  active boolean not null default true
);

create table if not exists public.barber_services (
  id text primary key,
  shop_id text not null references public.barber_shops(id) on delete cascade,
  name text not null,
  price_cents integer not null check (price_cents > 0),
  duration_min integer not null check (duration_min > 0),
  image_url text not null default ''
);

create table if not exists public.barber_clients (
  id text primary key,
  shop_id text not null references public.barber_shops(id) on delete cascade,
  name text not null,
  phone text not null
);

create table if not exists public.barber_appointments (
  id text primary key,
  shop_id text not null references public.barber_shops(id) on delete cascade,
  client_id text not null references public.barber_clients(id) on delete cascade,
  barber_id text not null references public.barber_staff(id) on delete cascade,
  service_id text not null references public.barber_services(id) on delete cascade,
  start_at bigint not null,
  end_at bigint not null,
  status text not null check (status in ('SCHEDULED', 'COMPLETED', 'CANCELED'))
);

create table if not exists public.barber_ledger (
  id text primary key,
  shop_id text not null references public.barber_shops(id) on delete cascade,
  appointment_id text,
  type text not null check (type in ('INCOME', 'COMMISSION_PAYOUT', 'EXPENSE')),
  amount_cents integer not null,
  created_at bigint not null
);

-- Índices para alta performance nas buscas Multi-Tenant por Barbearia
create index if not exists idx_staff_shop on public.barber_staff(shop_id);
create index if not exists idx_services_shop on public.barber_services(shop_id);
create index if not exists idx_clients_shop on public.barber_clients(shop_id);
create index if not exists idx_appts_shop_barber on public.barber_appointments(shop_id, barber_id, status);
create index if not exists idx_ledger_shop on public.barber_ledger(shop_id);

-- RLS habilitado (acesso gerenciado exclusivamente via SUPABASE_SERVICE_ROLE_KEY no backend)
alter table public.barber_shops enable row level security;
alter table public.barber_staff enable row level security;
alter table public.barber_services enable row level security;
alter table public.barber_clients enable row level security;
alter table public.barber_appointments enable row level security;
alter table public.barber_ledger enable row level security;
