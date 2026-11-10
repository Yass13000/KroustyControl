-- =============================================================================
-- Réglages privés de l'app (ex. jeton Dropbox enregistré par « Connecter Dropbox »).
-- RLS activée SANS règle : seule la clé service (fonctions serveur Vercel) peut lire/écrire.
-- À exécuter dans Supabase → SQL Editor. Ré-exécutable.
-- =============================================================================

create table if not exists public.app_settings (
  key         text primary key,
  value       text not null,
  updated_at  timestamptz not null default now()
);

alter table public.app_settings enable row level security;

comment on table public.app_settings is 'Réglages privés (lecture/écriture par les fonctions serveur uniquement).';

notify pgrst, 'reload schema';
