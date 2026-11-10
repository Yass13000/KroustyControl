-- =============================================================================
-- Accès total pour les comptes admin (profiles.role = 'admin').
--
-- Une fois connecté, l'app interroge Supabase avec le jeton de l'utilisateur :
-- les règles RLS existantes ne laissent alors voir que SES restaurants.
-- On ajoute une règle supplémentaire « admin voit et modifie tout » sur chaque table.
-- Les règles RLS s'additionnent : celles des comptes 'user' ne changent pas.
--
-- Prérequis : 20261110_profiles.sql (fonction public.is_admin()).
-- À exécuter dans Supabase → SQL Editor. Script ré-exécutable.
-- =============================================================================

do $$
declare
  t text;
begin
  foreach t in array array['groups', 'configurations', 'screens_config', 'albums', 'videos']
  loop
    if to_regclass('public.' || t) is not null then
      execute format('drop policy if exists "admin_full_access" on public.%I', t);
      execute format(
        'create policy "admin_full_access" on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())',
        t
      );
    end if;
  end loop;
end $$;

-- Fichiers (photos des restaurants) dans le bucket "medias"
drop policy if exists "admin_full_access_medias" on storage.objects;
create policy "admin_full_access_medias" on storage.objects
  for all to authenticated
  using (bucket_id = 'medias' and public.is_admin())
  with check (bucket_id = 'medias' and public.is_admin());

-- Vérification : liste les règles en place sur ces tables
select tablename, policyname, cmd
from pg_policies
where schemaname = 'public'
  and tablename in ('groups', 'configurations', 'screens_config', 'albums', 'videos', 'profiles')
order by tablename, policyname;
