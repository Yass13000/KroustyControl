-- =============================================================================
-- Rattachement des écrans à un compte (comme groups.user_id pour les restaurants).
--   • user  : voit les écrans liés à son compte + ceux de ses restaurants
--   • admin : voit tout (règle admin_full_access déjà en place)
--
-- À exécuter dans Supabase → SQL Editor. Script ré-exécutable.
-- =============================================================================

alter table public.screens_config
  add column if not exists user_id uuid references auth.users (id) on delete set null;

create index if not exists screens_config_user_id_idx on public.screens_config (user_id);

comment on column public.screens_config.user_id is 'Compte propriétaire de l''écran (null = non attribué).';

-- Un compte peut gérer les écrans qui lui sont directement liés.
drop policy if exists "user_owns_screen" on public.screens_config;
create policy "user_owns_screen" on public.screens_config
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
