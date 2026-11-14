-- Mesur — PostgreSQL / Supabase schema with Row Level Security.
--
-- Mirrors server/schema.sql (same tables and columns) so the bundled SQLite
-- server can be swapped for Supabase. NOT exercised by the automated tests in
-- this repository: apply it to a fresh Supabase project and test before use.
--
-- Differences from the SQLite version:
--   * passwords and sessions live in auth.users (Supabase Auth); profiles.id = auth.users.id
--   * JSON columns are jsonb, timestamps are timestamptz
--   * access control is enforced by RLS policies instead of API route guards

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- helpers
create or replace function public.set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

-- ---------------------------------------------------------------- tables
create table public.profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  email           text not null unique,
  full_name       text not null,
  role            text not null default 'customer' check (role in ('customer','merchant','admin')),
  status          text not null default 'active' check (status in ('active','suspended')),
  preferred_unit  text not null default 'cm' check (preferred_unit in ('cm','in')),
  fit_preference  text not null default 'regular' check (fit_preference in ('slim','regular','relaxed','oversized')),
  is_sample       boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index on public.profiles(role);

create table public.customer_measurements (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null unique references public.profiles(id) on delete cascade,
  height_cm    numeric(5,1) not null check (height_cm between 120 and 230),
  chest_cm     numeric(5,1) not null check (chest_cm between 60 and 170),
  waist_cm     numeric(5,1) check (waist_cm between 45 and 170),
  shoulder_cm  numeric(5,1) check (shoulder_cm between 28 and 65),
  hip_cm       numeric(5,1) check (hip_cm between 55 and 180),
  arm_cm       numeric(5,1) check (arm_cm between 40 and 95),
  inseam_cm    numeric(5,1) check (inseam_cm between 50 and 110),
  thigh_cm     numeric(5,1) check (thigh_cm between 30 and 100),
  neck_cm      numeric(5,1) check (neck_cm between 25 and 60),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table public.merchants (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null unique references public.profiles(id) on delete cascade,
  company_name   text not null,
  contact_email  text not null,
  website        text,
  status         text not null default 'pending' check (status in ('pending','approved','suspended')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index on public.merchants(status);

create table public.brands (
  id                  uuid primary key default gen_random_uuid(),
  merchant_id         uuid unique references public.merchants(id) on delete cascade,
  name                text not null,
  slug                text not null unique,
  logo_url            text,              -- Supabase Storage public URL (bucket: brand-logos)
  description         text,
  website             text,
  country             text,
  categories          jsonb not null default '[]',
  integration_status  text not null default 'not_integrated' check (integration_status in ('not_integrated','sandbox','live')),
  is_active           boolean not null default true,
  is_demo             boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table public.size_charts (
  id          uuid primary key default gen_random_uuid(),
  brand_id    uuid not null references public.brands(id) on delete cascade,
  name        text not null,
  category    text not null,
  fit_type    text not null default 'regular' check (fit_type in ('slim','regular','relaxed','oversized')),
  unit        text not null default 'cm' check (unit in ('cm','in')),
  chart_type  text not null default 'body' check (chart_type in ('body','garment')),
  scope       text not null default 'brand' check (scope in ('brand','product')),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (brand_id, name)
);
create index on public.size_charts(brand_id, category);

create table public.size_chart_entries (
  id          uuid primary key default gen_random_uuid(),
  chart_id    uuid not null references public.size_charts(id) on delete cascade,
  label       text not null,
  sort_order  int not null default 0,
  ranges      jsonb not null,           -- {"chest":{"min":93,"max":98}, ...}
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (chart_id, label)
);
create index on public.size_chart_entries(chart_id, sort_order);

create table public.products (
  id               uuid primary key default gen_random_uuid(),
  brand_id         uuid not null references public.brands(id) on delete cascade,
  external_id      text not null,
  name             text not null,
  description      text,
  category         text not null,
  fit_type         text not null default 'regular' check (fit_type in ('slim','regular','relaxed','oversized')),
  size_chart_id    uuid references public.size_charts(id) on delete set null,
  available_sizes  jsonb not null default '[]',
  ease             jsonb,
  image_url        text,                 -- Supabase Storage public URL (bucket: product-images)
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (brand_id, external_id)
);
create index on public.products(brand_id, is_active);

create table public.recommendations (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  brand_id        uuid not null references public.brands(id) on delete cascade,
  product_id      uuid references public.products(id) on delete set null,
  product_name    text,
  category        text not null,
  status          text not null,
  size_label      text,
  match_score     int,
  confidence      text,
  fit_preference  text not null,
  source          text not null check (source in ('app','widget')),
  is_sample       boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index on public.recommendations(user_id, created_at desc);

create table public.widget_integrations (
  id               uuid primary key default gen_random_uuid(),
  merchant_id      uuid not null unique references public.merchants(id) on delete cascade,
  public_key       text not null unique,
  secret_key_hash  text,
  secret_last4     text,
  allowed_origins  jsonb not null default '[]',
  config           jsonb not null default '{}',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Anonymous: no user id, no measurements.
create table public.recommendation_events (
  id          uuid primary key default gen_random_uuid(),
  brand_id    uuid not null references public.brands(id) on delete cascade,
  product_id  uuid references public.products(id) on delete set null,
  type        text not null check (type in ('impression','open','recommendation','size_selected')),
  status      text,
  size_label  text,
  source      text not null check (source in ('app','widget','api')),
  is_sample   boolean not null default false,
  created_at  timestamptz not null default now()
);
create index on public.recommendation_events(brand_id, created_at);
create index on public.recommendation_events(product_id);

create table public.platform_config (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);

do $$ declare t text; begin
  foreach t in array array['profiles','customer_measurements','merchants','brands','size_charts','size_chart_entries','products','recommendations','widget_integrations'] loop
    execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- auth hook
-- New auth users get a customer profile. Merchant/admin roles are granted
-- server-side (service role), never from client-supplied metadata.
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name) values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- role helpers
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin' and status = 'active') $$;
create or replace function public.my_brand_id() returns uuid language sql stable security definer set search_path = public as $$
  select b.id from brands b join merchants m on m.id = b.merchant_id
   where m.owner_id = auth.uid() and m.status <> 'suspended' $$;

-- Users must not be able to change their own role or status.
create or replace function public.protect_profile_columns() returns trigger language plpgsql as $$
begin
  if not public.is_admin() and (new.role is distinct from old.role or new.status is distinct from old.status) then
    raise exception 'role and status can only be changed by an administrator';
  end if;
  return new;
end $$;
create trigger protect_profile_columns before update on public.profiles for each row execute function public.protect_profile_columns();

-- ---------------------------------------------------------------- RLS
alter table public.profiles               enable row level security;
alter table public.customer_measurements  enable row level security;
alter table public.merchants              enable row level security;
alter table public.brands                 enable row level security;
alter table public.size_charts            enable row level security;
alter table public.size_chart_entries     enable row level security;
alter table public.products               enable row level security;
alter table public.recommendations        enable row level security;
alter table public.widget_integrations    enable row level security;
alter table public.recommendation_events  enable row level security;
alter table public.platform_config        enable row level security;

-- profiles: yourself, or admin
create policy "profiles self read"   on public.profiles for select using (id = auth.uid() or public.is_admin());
create policy "profiles self update" on public.profiles for update using (id = auth.uid() or public.is_admin());

-- measurements: ONLY the owner. Admins and merchants have no policy here on purpose.
create policy "measurements owner" on public.customer_measurements for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- merchants
create policy "merchant self read"  on public.merchants for select using (owner_id = auth.uid() or public.is_admin());
create policy "merchant admin all"  on public.merchants for all using (public.is_admin()) with check (public.is_admin());

-- brands: public read of visible brands; merchant edits own; admin all
create policy "brands public read" on public.brands for select using (
  (is_active and (merchant_id is null or exists (select 1 from merchants m where m.id = merchant_id and m.status = 'approved')))
  or id = public.my_brand_id() or public.is_admin());
create policy "brands merchant update" on public.brands for update using (id = public.my_brand_id()) with check (id = public.my_brand_id());
create policy "brands admin all" on public.brands for all using (public.is_admin()) with check (public.is_admin());

-- size charts + entries + products: public read when the brand is readable; owner/admin write
create policy "charts read" on public.size_charts for select using (exists (select 1 from brands b where b.id = brand_id));
create policy "charts write" on public.size_charts for all using (brand_id = public.my_brand_id() or public.is_admin()) with check (brand_id = public.my_brand_id() or public.is_admin());
create policy "entries read" on public.size_chart_entries for select using (exists (select 1 from size_charts c where c.id = chart_id));
create policy "entries write" on public.size_chart_entries for all
  using (exists (select 1 from size_charts c where c.id = chart_id and (c.brand_id = public.my_brand_id() or public.is_admin())))
  with check (exists (select 1 from size_charts c where c.id = chart_id and (c.brand_id = public.my_brand_id() or public.is_admin())));
create policy "products read" on public.products for select using ((is_active and exists (select 1 from brands b where b.id = brand_id)) or brand_id = public.my_brand_id() or public.is_admin());
create policy "products write" on public.products for all using (brand_id = public.my_brand_id() or public.is_admin()) with check (brand_id = public.my_brand_id() or public.is_admin());

-- recommendations: the customer's own history only (never merchants)
create policy "recs owner" on public.recommendations for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- widget integrations: owning merchant + admin. Public-key lookups and secret-key
-- checks happen in server code with the service role.
create policy "integrations owner" on public.widget_integrations for all
  using (merchant_id in (select id from merchants where owner_id = auth.uid()) or public.is_admin())
  with check (merchant_id in (select id from merchants where owner_id = auth.uid()) or public.is_admin());

-- events: written by the server (service role); readable by the brand owner and admins
create policy "events read" on public.recommendation_events for select using (brand_id = public.my_brand_id() or public.is_admin());

create policy "config admin" on public.platform_config for all using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------- storage
insert into storage.buckets (id, name, public) values ('brand-logos', 'brand-logos', true), ('product-images', 'product-images', true)
  on conflict (id) do nothing;
-- Upload path convention: <brand_id>/<file>. Owners write under their brand folder.
create policy "brand media write" on storage.objects for insert to authenticated
  with check (bucket_id in ('brand-logos','product-images') and ((storage.foldername(name))[1]::uuid = public.my_brand_id() or public.is_admin()));
create policy "brand media read" on storage.objects for select using (bucket_id in ('brand-logos','product-images'));
