-- Central de identidade visual da plataforma Acionador.ai.
create table if not exists public.platform_branding (
  id text primary key default 'default' check (id = 'default'),
  platform_name text not null default 'Acionador.ai',
  short_name text not null default 'Acionador.ai',
  tagline text not null default 'Automação inteligente para assistência 24h.',
  pwa_description text not null default 'Automação inteligente para operações de assistência 24h.',
  primary_color text not null default '#0877F9',
  logo_data_url text,
  app_icon_data_url text,
  favicon_data_url text,
  pwa_icon_180_data_url text,
  pwa_icon_192_data_url text,
  pwa_icon_512_data_url text,
  updated_at timestamptz not null default now()
);
alter table public.platform_branding add column if not exists pwa_icon_180_data_url text;
alter table public.platform_branding add column if not exists pwa_icon_192_data_url text;
alter table public.platform_branding add column if not exists pwa_icon_512_data_url text;
insert into public.platform_branding (id) values ('default') on conflict (id) do nothing;
alter table public.platform_branding enable row level security;
drop policy if exists platform_branding_public_read on public.platform_branding;
create policy platform_branding_public_read on public.platform_branding for select to anon, authenticated using (true);
grant select on public.platform_branding to anon, authenticated;
create or replace function public.master_update_platform_branding(p_patch jsonb)
returns public.platform_branding language plpgsql security definer set search_path = public, auth as $$
declare v_row public.platform_branding; v_email text := lower(coalesce(auth.jwt()->>'email','')); v_is_master boolean := false;
begin
  v_is_master := v_email = 'comercialvittorgutierrez@gmail.com' or exists (select 1 from public.company_members cm where cm.user_id=auth.uid() and cm.active=true and cm.role='master');
  if not v_is_master then raise exception 'forbidden' using errcode='42501'; end if;
  update public.platform_branding set
    platform_name=case when p_patch?'platform_name' then left(coalesce(nullif(trim(p_patch->>'platform_name'),''),platform_name),80) else platform_name end,
    short_name=case when p_patch?'short_name' then left(coalesce(nullif(trim(p_patch->>'short_name'),''),short_name),30) else short_name end,
    tagline=case when p_patch?'tagline' then left(coalesce(p_patch->>'tagline',''),180) else tagline end,
    pwa_description=case when p_patch?'pwa_description' then left(coalesce(p_patch->>'pwa_description',''),240) else pwa_description end,
    primary_color=case when p_patch?'primary_color' and coalesce(p_patch->>'primary_color','') ~ '^#[0-9A-Fa-f]{6}$' then upper(p_patch->>'primary_color') else primary_color end,
    logo_data_url=case when p_patch?'logo_data_url' then nullif(p_patch->>'logo_data_url','') else logo_data_url end,
    app_icon_data_url=case when p_patch?'app_icon_data_url' then nullif(p_patch->>'app_icon_data_url','') else app_icon_data_url end,
    favicon_data_url=case when p_patch?'favicon_data_url' then nullif(p_patch->>'favicon_data_url','') else favicon_data_url end,
    pwa_icon_180_data_url=case when p_patch?'pwa_icon_180_data_url' then nullif(p_patch->>'pwa_icon_180_data_url','') else pwa_icon_180_data_url end,
    pwa_icon_192_data_url=case when p_patch?'pwa_icon_192_data_url' then nullif(p_patch->>'pwa_icon_192_data_url','') else pwa_icon_192_data_url end,
    pwa_icon_512_data_url=case when p_patch?'pwa_icon_512_data_url' then nullif(p_patch->>'pwa_icon_512_data_url','') else pwa_icon_512_data_url end,
    updated_at=now()
  where id='default' returning * into v_row;
  if v_row.id is null then insert into public.platform_branding(id) values('default') returning * into v_row; end if;
  return v_row;
end;$$;
revoke all on function public.master_update_platform_branding(jsonb) from public;
revoke all on function public.master_update_platform_branding(jsonb) from anon;
grant execute on function public.master_update_platform_branding(jsonb) to authenticated;
