-- =============================================================================
-- Table profiles : un profil par compte, avec un rôle 'admin' ou 'user'.
--   • admin : voit et gère TOUS les restaurants enregistrés
--   • user  : ne voit que les restaurants dont il est propriétaire (groups.user_id)
--
-- À exécuter une fois dans Supabase → SQL Editor. Le script est ré-exécutable.
-- =============================================================================

create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text,
  role        text not null default 'user' check (role in ('admin', 'user')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.profiles is 'Profil applicatif de chaque compte (rôle admin / user).';

-- Mise à jour automatique de updated_at
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- Création automatique du profil à l'inscription d'un compte
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, role)
  values (
    new.id,
    new.email,
    case when new.raw_app_meta_data ->> 'role' = 'super_admin'
           or new.raw_user_meta_data ->> 'role' = 'super_admin'
         then 'admin' else 'user' end
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Reprise des comptes existants (les anciens « super_admin » deviennent 'admin')
insert into public.profiles (id, email, role)
select
  u.id,
  u.email,
  case when u.raw_app_meta_data ->> 'role' = 'super_admin'
         or u.raw_user_meta_data ->> 'role' = 'super_admin'
       then 'admin' else 'user' end
from auth.users u
on conflict (id) do nothing;

-- Fonction utilitaire réutilisable dans les futures règles RLS (groups, configurations…)
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- Sécurité : chacun lit son profil, seul un admin peut lire tous les profils et changer les rôles.
alter table public.profiles enable row level security;

drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles
  for select using (id = auth.uid() or public.is_admin());

drop policy if exists "profiles_update_admin" on public.profiles;
create policy "profiles_update_admin" on public.profiles
  for update using (public.is_admin()) with check (public.is_admin());

-- Temps réel : un changement de rôle s'applique immédiatement dans l'app
do $$
begin
  alter publication supabase_realtime add table public.profiles;
exception when duplicate_object then null;
end $$;

-- -----------------------------------------------------------------------------
-- Pour passer un compte en admin :
--   update public.profiles set role = 'admin' where email = 'adresse@exemple.fr';
-- Pour le repasser en simple utilisateur :
--   update public.profiles set role = 'user'  where email = 'adresse@exemple.fr';
-- -----------------------------------------------------------------------------
