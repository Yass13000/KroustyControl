-- =============================================================================
-- Programmation : la playlist n'est imposée qu'aux CHANGEMENTS de créneau.
--
-- Avant : chaque minute, le programmateur réécrivait la playlist de tous les écrans d'un mur
-- programmé. Une diffusion faite à la main entre deux créneaux (ou un mur en mode « Séparé »)
-- était donc écrasée dans la minute.
-- Maintenant : il retient la dernière playlist imposée (configurations.schedule_target) et
-- n'écrit sur les écrans que lorsqu'elle change (début ou fin d'un créneau, créneau modifié,
-- playlist normale modifiée). Entre deux, ce qui est diffusé à la main est respecté.
--
-- À exécuter dans Supabase → SQL Editor. Ré-exécutable. Le cron « krousty-playlists » existant
-- continue d'appeler la même fonction chaque minute : rien d'autre à changer.
-- =============================================================================

alter table public.configurations
  add column if not exists schedule_target text;

comment on column public.configurations.schedule_target is
  'Dernière playlist imposée par la programmation (le programmateur n''agit que quand elle change).';

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
    select c.id, c.default_video_url, c.schedule_target
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

    -- Rien n'a changé depuis la dernière application : on ne touche pas aux écrans.
    if target is not distinct from cfg.schedule_target then continue; end if;

    update screens_config
    set video_url = target
    where configuration_id = cfg.id and coalesce(video_url, '') is distinct from target;

    update configurations set schedule_target = target where id = cfg.id;

    if active.id is not null then
      update playlist_schedules set last_applied_at = now() where id = active.id;
    end if;
  end loop;

  insert into scheduler_status (id, last_run) values ('playlists', now())
  on conflict (id) do update set last_run = excluded.last_run;
end $$;

-- Point de départ : la playlist actuellement diffusée par l'écran principal de chaque mur
-- (évite une réécriture inutile au premier passage).
update public.configurations c
set schedule_target = s.video_url
from public.screens_config s
where s.configuration_id = c.id and s.pos_x = 0 and s.pos_y = 0
  and c.schedule_target is null and coalesce(s.video_url, '') <> '';

notify pgrst, 'reload schema';
