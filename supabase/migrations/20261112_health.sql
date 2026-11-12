-- =============================================================================
-- Voyants de santé des TV (lecteur 1.8+) : réseau, stabilité, stockage, mémoire,
-- température, lecture, synchro du mur. Envoyés avec le signal de vie (1 fois par minute) :
-- aucune requête supplémentaire. Le journal (screen_events) n'est pas concerné.
-- À exécuter dans Supabase → SQL Editor. Ré-exécutable.
-- =============================================================================

alter table public.screens_config
  add column if not exists health jsonb;

comment on column public.screens_config.health is 'Voyants envoyés par la TV avec le signal de vie (voir lecteur HealthMonitor).';

notify pgrst, 'reload schema';
