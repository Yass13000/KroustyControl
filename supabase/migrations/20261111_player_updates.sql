-- =============================================================================
-- Mises à jour à distance du lecteur : chaque écran indique où en est sa mise à jour.
--   update_state : 'downloading' | 'installing' | 'waiting_user' | 'failed: …' | 'done'
-- (latest_version_code, apk_url, apk_sha256 existent déjà et désignent la version cible.)
-- Les APK du lecteur sont stockés dans Supabase Storage (bucket public « player »),
-- pour que les TV puissent les télécharger sans session.
-- Inclut aussi la colonne « format » des vidéos (si elle n'a pas encore été ajoutée).
-- À exécuter dans Supabase → SQL Editor. Ré-exécutable.
-- =============================================================================

alter table public.screens_config
  add column if not exists update_state    text,
  add column if not exists update_state_at timestamptz;

alter table public.videos
  add column if not exists format text;

-- Bucket public des APK (lecture publique ; écriture réservée à la clé service / l'admin)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('player', 'player', true, 52428800, array['application/vnd.android.package-archive', 'application/octet-stream'])
on conflict (id) do update set public = true;

notify pgrst, 'reload schema';
