-- =============================================================================
-- Correctifs maintenance — compatibilité anciens lecteurs + sobriété (plan Free Supabase).
--
-- 1. Fausses coupures : certains lecteurs (ex. Belsunce) envoient leur signal toutes
--    les 10 min. Seuil de coupure porté à 15 min + suppression des fausses coupures.
-- 2. Planificateur des playlists : n'écrit plus rien tant qu'aucun créneau n'existe.
-- 3. Ménage quotidien (04:30) : historique pg_cron gardé 2 jours, journal 90 jours.
--    Sans ça, pg_cron accumule ~1 440 lignes/jour, sans limite.
--
-- À exécuter dans Supabase → SQL Editor. Ré-exécutable.
-- =============================================================================

-- ---------- 1. Seuil de coupure à 15 min ----------
create or replace function public.log_screen_events()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Coupure : plus de 15 min sans signal puis retour
  if new.last_ping is distinct from old.last_ping
     and old.last_ping is not null and new.last_ping is not null
     and new.last_ping - old.last_ping > interval '15 minutes' then
    insert into screen_events (screen_id, kind, started_at, created_at)
    values (new.id, 'outage', old.last_ping, new.last_ping);
  end if;

  if new.booted_at is distinct from old.booted_at and new.booted_at is not null then
    insert into screen_events (screen_id, kind, message)
    values (new.id, 'boot', concat_ws(' · ', new.player_version, new.device_model));
  end if;

  if new.last_error is distinct from old.last_error and coalesce(trim(new.last_error), '') <> '' then
    insert into screen_events (screen_id, kind, message) values (new.id, 'error', left(new.last_error, 500));
  end if;

  if new.video_url is distinct from old.video_url then
    insert into screen_events (screen_id, kind, message)
    values (new.id, 'content', case when coalesce(new.video_url, '') = '' then 'Playlist vidée' else 'Playlist modifiée' end);
  end if;

  if new.configuration_id is distinct from old.configuration_id then
    insert into screen_events (screen_id, kind, message)
    values (new.id, 'assign', case when new.configuration_id is null then 'Remis en attente' else 'Assigné à une configuration' end);
  end if;

  if new.command_id is distinct from old.command_id and new.command_id is not null then
    insert into screen_events (screen_id, kind, message) values (new.id, 'command', 'Envoyée : ' || coalesce(new.command, '?'));
  end if;
  if new.command_ack is distinct from old.command_ack and new.command_ack is not null then
    insert into screen_events (screen_id, kind, message) values (new.id, 'command', 'Exécutée : ' || coalesce(new.command, '?'));
  end if;

  return new;
end $$;

-- Supprime les fausses coupures (simples intervalles entre deux signaux d'un ancien lecteur)
delete from public.screen_events
where kind = 'outage'
  and started_at is not null
  and created_at - started_at <= interval '15 minutes';

-- ---------- 2. Planificateur sobre ----------
create or replace function public.apply_playlist_schedules()
returns void language plpgsql security definer set search_path = public as $$
declare
  local_now  timestamp := now() at time zone 'Europe/Paris';
  today      smallint  := extract(isodow from local_now)::smallint;
  yesterday  smallint  := case when today = 1 then 7 else today - 1 end;
  t          time      := local_now::time;
  cfg        record;
  active     record;
  target     text;
begin
  -- Aucun créneau actif : on ne fait rien (aucune écriture).
  if not exists (select 1 from playlist_schedules where enabled) then
    return;
  end if;

  for cfg in
    select c.id, c.default_video_url
    from configurations c
    where exists (select 1 from playlist_schedules s where s.configuration_id = c.id and s.enabled)
  loop
    select s.* into active
    from playlist_schedules s
    where s.configuration_id = cfg.id and s.enabled and s.video_url <> ''
      and (
        (s.start_time <= s.end_time and today = any (s.days) and t >= s.start_time and t < s.end_time)
        or (s.start_time > s.end_time and today = any (s.days) and t >= s.start_time)
        or (s.start_time > s.end_time and yesterday = any (s.days) and t < s.end_time)
      )
    order by s.start_time desc
    limit 1;

    target := coalesce(active.video_url, cfg.default_video_url);
    if target is null then continue; end if;

    update screens_config
    set video_url = target
    where configuration_id = cfg.id and coalesce(video_url, '') is distinct from target;

    if found and active.id is not null then
      update playlist_schedules set last_applied_at = now() where id = active.id;
    end if;
  end loop;

  -- Battement (une seule ligne, mise à jour sur place) : sert à l'alerte « Programmation à l'arrêt ».
  insert into scheduler_status (id, last_run) values ('playlists', now())
  on conflict (id) do update set last_run = excluded.last_run;
end $$;

-- ---------- 3. Ménage quotidien ----------
create or replace function public.krousty_housekeeping()
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from cron.job_run_details where end_time < now() - interval '2 days';
  delete from screen_events where created_at < now() - interval '90 days';
end $$;

do $$
begin
  perform cron.unschedule('krousty-housekeeping');
exception when others then null;
end $$;

select cron.schedule('krousty-housekeeping', '30 4 * * *', 'select public.krousty_housekeeping()');

-- Premier ménage immédiat
select public.krousty_housekeeping();
