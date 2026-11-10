-- =============================================================================
-- Vidéos par restaurant + format de mur par vidéo.
--
-- Vidéos par restaurant : chaque dossier (album) peut appartenir à un restaurant.
--   • group_id renseigné : dossier du restaurant (visible et géré par ses gérants + l'admin)
--   • group_id vide      : bibliothèque commune (visible par tous, gérée par l'admin)
-- Les vidéos suivent leur dossier.
-- À exécuter dans Supabase → SQL Editor. Ré-exécutable.
-- =============================================================================

alter table public.albums
  add column if not exists group_id uuid references public.groups (id) on delete cascade;

create index if not exists albums_group_idx on public.albums (group_id);

comment on column public.albums.group_id is 'Restaurant propriétaire du dossier (vide = bibliothèque commune).';

-- Règles pour les comptes connectés (l'admin a déjà accès à tout via admin_full_access).
-- La RLS n'est pas forcée ici (une autre app pourrait lire ces tables sans session) :
-- ces règles s'appliquent si elle est déjà active.

drop policy if exists "albums_read" on public.albums;
create policy "albums_read" on public.albums for select to authenticated
  using (group_id is null or exists (select 1 from groups g where g.id = albums.group_id and g.user_id = auth.uid()));

drop policy if exists "albums_manage_own" on public.albums;
create policy "albums_manage_own" on public.albums for all to authenticated
  using (exists (select 1 from groups g where g.id = albums.group_id and g.user_id = auth.uid()))
  with check (exists (select 1 from groups g where g.id = albums.group_id and g.user_id = auth.uid()));

drop policy if exists "videos_read" on public.videos;
create policy "videos_read" on public.videos for select to authenticated
  using (exists (
    select 1 from albums a
    where a.id = videos.album_id
      and (a.group_id is null or exists (select 1 from groups g where g.id = a.group_id and g.user_id = auth.uid()))
  ));

drop policy if exists "videos_manage_own" on public.videos;
create policy "videos_manage_own" on public.videos for all to authenticated
  using (exists (select 1 from albums a join groups g on g.id = a.group_id where a.id = videos.album_id and g.user_id = auth.uid()))
  with check (exists (select 1 from albums a join groups g on g.id = a.group_id where a.id = videos.album_id and g.user_id = auth.uid()));

-- ---------- Format de mur de chaque vidéo (1x1, 1x2, 1x3, 1x4, 2x2) ----------
-- Vide = format déduit automatiquement par l'app (mur de diffusion, nom, dimensions).
alter table public.videos
  add column if not exists format text check (format in ('1x1', '1x2', '1x3', '1x4', '2x2'));

notify pgrst, 'reload schema';
