-- =============================================================================
-- Centre de maintenance : journal des événements + commandes à distance.
--
--  • screen_events : historique automatique (coupures, redémarrages, erreurs,
--    changements de contenu, assignations, commandes exécutées).
--    Rempli par un déclencheur sur screens_config : fonctionne même avec
--    les lecteurs déjà installés (les coupures sont déduites des signaux).
--  • Commandes : l'app écrit une commande dans screens_config, le lecteur la voit
--    à sa prochaine lecture de configuration (≤ 15 s), l'exécute et l'acquitte.
--
-- À exécuter dans Supabase → SQL Editor. Script ré-exécutable.
-- =============================================================================

-- ---------- Colonnes ajoutées aux écrans ----------
alter table public.screens_config
  add column if not exists command         text,         -- 'reload' | 'clear_cache'
  add column if not exists command_id      uuid,         -- change à chaque nouvelle commande
  add column if not exists command_at      timestamptz,
  add column if not exists command_ack     uuid,         -- = command_id une fois exécutée
  add column if not exists command_ack_at  timestamptz,
  add column if not exists player_version  text,         -- ex. "1.1 (2)"
  add column if not exists device_model    text,         -- ex. "Philips 43PUS"
  add column if not exists booted_at       timestamptz;  -- dernier démarrage du lecteur

-- ---------- Journal ----------
create table if not exists public.screen_events (
  id          bigint generated always as identity primary key,
  screen_id   text not null,
  kind        text not null check (kind in ('outage', 'boot', 'error', 'command', 'content', 'assign')),
  message     text,
  started_at  timestamptz,                         -- début de la coupure (kind = 'outage')
  created_at  timestamptz not null default now()
);

create index if not exists screen_events_screen_idx on public.screen_events (screen_id, created_at desc);
create index if not exists screen_events_created_idx on public.screen_events (created_at desc);

comment on table public.screen_events is 'Historique de maintenance des écrans (alimenté automatiquement).';

-- ---------- Déclencheur : déduit les événements des mises à jour des écrans ----------
create or replace function public.log_screen_events()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Coupure : plus de 5 min sans signal puis retour
  if new.last_ping is distinct from old.last_ping
     and old.last_ping is not null and new.last_ping is not null
     and new.last_ping - old.last_ping > interval '5 minutes' then
    insert into screen_events (screen_id, kind, started_at, created_at)
    values (new.id, 'outage', old.last_ping, new.last_ping);
  end if;

  -- Redémarrage du lecteur
  if new.booted_at is distinct from old.booted_at and new.booted_at is not null then
    insert into screen_events (screen_id, kind, message)
    values (new.id, 'boot', concat_ws(' · ', new.player_version, new.device_model));
  end if;

  -- Erreur remontée par le lecteur
  if new.last_error is distinct from old.last_error and coalesce(trim(new.last_error), '') <> '' then
    insert into screen_events (screen_id, kind, message) values (new.id, 'error', left(new.last_error, 500));
  end if;

  -- Contenu modifié
  if new.video_url is distinct from old.video_url then
    insert into screen_events (screen_id, kind, message)
    values (new.id, 'content', case when coalesce(new.video_url, '') = '' then 'Playlist vidée' else 'Playlist modifiée' end);
  end if;

  -- Assignation / retrait
  if new.configuration_id is distinct from old.configuration_id then
    insert into screen_events (screen_id, kind, message)
    values (new.id, 'assign', case when new.configuration_id is null then 'Remis en attente' else 'Assigné à une configuration' end);
  end if;

  -- Commande envoyée puis exécutée
  if new.command_id is distinct from old.command_id and new.command_id is not null then
    insert into screen_events (screen_id, kind, message) values (new.id, 'command', 'Envoyée : ' || coalesce(new.command, '?'));
  end if;
  if new.command_ack is distinct from old.command_ack and new.command_ack is not null then
    insert into screen_events (screen_id, kind, message) values (new.id, 'command', 'Exécutée : ' || coalesce(new.command, '?'));
  end if;

  return new;
end $$;

drop trigger if exists screens_config_log_events on public.screens_config;
create trigger screens_config_log_events
  after update on public.screens_config
  for each row execute function public.log_screen_events();

-- ---------- Sécurité ----------
alter table public.screen_events enable row level security;

drop policy if exists "screen_events_admin" on public.screen_events;
create policy "screen_events_admin" on public.screen_events
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------- Temps réel ----------
do $$
begin
  alter publication supabase_realtime add table public.screen_events;
exception when duplicate_object then null;
end $$;

-- ---------- Nettoyage : on garde 90 jours d'historique ----------
create or replace function public.purge_screen_events()
returns void language sql security definer set search_path = public as $$
  delete from screen_events where created_at < now() - interval '90 days';
$$;

notify pgrst, 'reload schema';
