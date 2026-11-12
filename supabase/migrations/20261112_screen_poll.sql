-- =============================================================================
-- Économie de requêtes (plan gratuit) : une seule requête par relevé de la TV (lecteur 1.9+).
--   screen_poll(p_id) : renvoie la configuration de l'écran ET met à jour son signal de vie
--   (au plus une fois toutes les 2 min 30, pour limiter aussi les messages temps réel).
--   Remplace le couple « lecture de la config + signal de vie séparé ».
-- Mêmes droits que les requêtes actuelles des TV (security invoker).
-- À exécuter dans Supabase → SQL Editor. Ré-exécutable.
-- =============================================================================

create or replace function public.screen_poll(p_id text)
returns setof public.screens_config
language plpgsql
security invoker
set search_path = public
as $$
begin
  update public.screens_config
     set last_ping = now()
   where id = p_id
     and (last_ping is null or last_ping < now() - interval '150 seconds');
  return query select * from public.screens_config where id = p_id;
end;
$$;

grant execute on function public.screen_poll(text) to anon, authenticated;

notify pgrst, 'reload schema';
