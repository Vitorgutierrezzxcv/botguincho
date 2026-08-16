-- Bot Guincho Control Plane
-- Execute no Supabase SQL Editor do projeto central.

create extension if not exists pgcrypto;

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,41}$'),
  name text not null,
  document text,
  phone text,
  email text,
  status text not null default 'onboarding' check (status in ('onboarding','active','paused','suspended')),
  service_state char(2) not null default 'MG',
  priority_cities text[] not null default '{}',
  plan_code text not null default 'starter',
  tenant_provisioned boolean not null default false,
  onboarding_step text not null default 'company',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.company_members (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('master','owner','operator')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, user_id)
);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null unique references public.companies(id) on delete cascade,
  plan_code text not null default 'starter',
  status text not null default 'trialing' check (status in ('trialing','active','past_due','canceled','paused')),
  trial_ends_at timestamptz,
  current_period_end timestamptz,
  external_customer_id text,
  external_subscription_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tenant_settings (
  company_id uuid primary key references public.companies(id) on delete cascade,
  whatsapp_enabled boolean not null default true,
  tracker_provider text not null default 'gconnect',
  tracker_enabled boolean not null default true,
  ai_enabled boolean not null default true,
  reply_every_message boolean not null default true,
  human_takeover boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists company_members_user_idx on public.company_members(user_id) where active = true;
create index if not exists companies_status_idx on public.companies(status);

alter table public.companies enable row level security;
alter table public.company_members enable row level security;
alter table public.subscriptions enable row level security;
alter table public.tenant_settings enable row level security;

-- APIs do acesso privilegiado via SUPABASE_SERVICE_ROLE_KEY no servidor.
-- O navegador nunca recebe a service role key.

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists companies_touch on public.companies;
create trigger companies_touch before update on public.companies for each row execute function public.touch_updated_at();
drop trigger if exists subscriptions_touch on public.subscriptions;
create trigger subscriptions_touch before update on public.subscriptions for each row execute function public.touch_updated_at();
drop trigger if exists tenant_settings_touch on public.tenant_settings;
create trigger tenant_settings_touch before update on public.tenant_settings for each row execute function public.touch_updated_at();
