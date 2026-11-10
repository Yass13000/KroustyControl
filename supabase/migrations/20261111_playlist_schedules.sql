-- =============================================================================
-- Programmation des playlists (midi / soir / week-end…).
--
--  • playlist_schedules : créneaux par configuration (jours, heure de début/fin, playlist).
--  • configurations.default_video_url : playlist « normale », hors créneaux
--    (mise à jour à chaque déploiement depuis l'Accueil).
--  • apply_playlist_schedules() : exécutée chaque minute par pg_cron, écrit la bonne
--    playlist sur les écrans du mur. Les TV la reçoivent comme d'habitude : aucun calcul
--    côté écran, compatible avec tous les lecteurs.
--
-- Heure de référence : Europe/Paris. Les créneaux qui passent minuit sont gérés.
-- À exécuter dans Supabase → SQL Editor. Script ré-exécutable.
-- =============================================================================

create extension if not exists pg_cron;

alter table public.configurations
  add column if not exists default_video_url text;

create table if not exists public.playlist_schedules (
  id                uuid primary key default gen_random_uuid(),
  configuration_id  uuid not null references public.configurations (id) on delete cascade,
  name              text not null default 'Créneau',
  days              smallint[] not null default '{1,2,3,4,5,6,7}',   -- 1 = lundi … 7 = dimanche
  start_time        time not null,
  end_time          time not null,
  video_url         text not null default '',                       -- playlist (URLs séparées par des virgules)
  enabled           boolean not null default true,
  last_applied_at   timestamptz,
  created_at        timestamptz not null default now()
);

create index if not exists playlist_schedules_config_idx on public.playlist_schedules (configuration_id);

comment on table public.playlist_schedules is 'Créneaux de diffusion programmés (appliqués chaque minute par pg_cron).';

-- Battement du planificateur : permet à l'app de vérifier qu'il tourne bien.
create table if not exists public.scheduler_status (
  id       text primary key,
  last_run timestamptz
);

-- ---------- Le planificateur ----------
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
  for cfg in
    select c.id, c.default_video_url
    from configurations c
    where exists (select 1 from playlist_schedules s where s.configuration_id = c.id and s.enabled)
  loop
    -- Créneau actif : le plus récemment commencé l'emporte en cas de chevauchement.
    select s.* into active
    from playlist_schedules s
    where s.configuration_id = cfg.id and s.enabled and s.video_url <> ''
      and (
        (s.start_time <= s.end_time and today = any (s.days) and t >= s.start_time and t < s.end_time)
        or (s.start_time > s.end_time and today = any (s.days) and t >= s.start_time)        -- avant minuit
        or (s.start_time > s.end_time and yesterday = any (s.days) and t < s.end_time)      -- après minuit
      )
    order by s.start_time desc
    limit 1;

    target := coalesce(active.video_url, cfg.default_video_url);
    if target is null then continue; end if;

    -- N'écrit que si nécessaire (évite des écritures et des événements inutiles).
    update screens_config
    set video_url = target
    where configuration_id = cfg.id and coalesce(video_url, '') is distinct from target;

    if found and active.id is not null then
      update playlist_schedules set last_applied_at = now() where id = active.id;
    end if;
  end loop;

  insert into scheduler_status (id, last_run) values ('playlists', now())
  on conflict (id) do update set last_run = excluded.last_run;
end $$;

-- ---------- Exécution chaque minute ----------
do $$
begin
  perform cron.unschedule('krousty-playlists');
exception when others then null;
end $$;

select cron.schedule('krousty-playlists', '* * * * *', 'select public.apply_playlist_schedules()');

-- ---------- Sécurité ----------
alter table public.playlist_schedules enable row level security;
drop policy if exists "playlist_schedules_admin" on public.playlist_schedules;
create policy "playlist_schedules_admin" on public.playlist_schedules
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

alter table public.scheduler_status enable row level security;
drop policy if exists "scheduler_status_read" on public.scheduler_status;
create policy "scheduler_status_read" on public.scheduler_status for select to authenticated using (true);

-- La playlist normale de chaque configuration = celle diffusée actuellement par son écran principal.
update public.configurations c
set default_video_url = s.video_url
from public.screens_config s
where s.configuration_id = c.id and s.pos_x = 0 and s.pos_y = 0
  and c.default_video_url is null and coalesce(s.video_url, '') <> '';

notify pgrst, 'reload schema';
