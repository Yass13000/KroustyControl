-- =============================================================================
-- Veille hors horaires (lecteur 1.2+) : le lecteur indique s'il dort ou diffuse.
-- À exécuter dans Supabase → SQL Editor, après 20261110_maintenance.sql. Ré-exécutable.
-- =============================================================================

alter table public.screens_config
  add column if not exists power_state    text,         -- 'on' | 'sleep'
  add column if not exists power_state_at timestamptz;  -- dernier changement

-- Le journal accepte les événements de veille / réveil
alter table public.screen_events drop constraint if exists screen_events_kind_check;
alter table public.screen_events
  add constraint screen_events_kind_check
  check (kind in ('outage', 'boot', 'error', 'command', 'content', 'assign', 'power'));

create or replace function public.log_power_events()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.power_state is distinct from old.power_state and new.power_state is not null then
    insert into screen_events (screen_id, kind, message)
    values (new.id, 'power', case when new.power_state = 'sleep' then 'Mise en veille' else 'Réveil' end);
  end if;
  return new;
end $$;

drop trigger if exists screens_config_log_power on public.screens_config;
create trigger screens_config_log_power
  after update on public.screens_config
  for each row execute function public.log_power_events();

-- Les horaires des écrans ne sont PAS modifiés ici : ils s'appliquent restaurant par restaurant
-- depuis Maintenance (« Horaires non appliqués aux écrans » → Appliquer) ou en enregistrant les horaires dans Accueil.

notify pgrst, 'reload schema';
