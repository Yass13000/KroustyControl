-- =============================================================================
-- Extinction réelle de l'écran hors horaires (lecteur 1.7+).
--   screen_off : true si la TV a l'autorisation d'éteindre son écran (sinon : écran noir, luminosité minimale).
-- À exécuter dans Supabase → SQL Editor. Ré-exécutable.
-- =============================================================================

alter table public.screens_config
  add column if not exists screen_off boolean;

notify pgrst, 'reload schema';
