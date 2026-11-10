import { useCallback, useEffect, useRef, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { sbClient } from './supabase';
import type { Album, AppScreen, Configuration, Group, Profile, ScreenCommand, ScreenEvent, VideoFile } from './types';

/** Supabase ne lève pas d'exception : on transforme `{ error }` en erreur. */
export function must<T extends { error: unknown }>(res: T): T {
  if (res.error) throw res.error;
  return res;
}

/** Exécute plusieurs requêtes et échoue si l'une d'elles a renvoyé une erreur. */
export async function mustAll(queries: PromiseLike<{ error: unknown }>[]) {
  const results = await Promise.all(queries);
  const failed = results.find(r => r.error);
  if (failed) throw failed.error;
  return results;
}

export const errorMessage = (err: unknown) => {
  if (!err) return 'Erreur inconnue';
  if (typeof err === 'string') return err;
  if (typeof err === 'object' && 'message' in err) return String((err as { message: unknown }).message);
  return 'Erreur inconnue';
};

/** Ancien emplacement du rôle (métadonnées) : sert de secours tant que la table profiles n'existe pas. */
const isLegacySuperAdmin = (user: User | null | undefined) =>
  user?.app_metadata?.role === 'super_admin' || user?.user_metadata?.role === 'super_admin';

export type Role = 'admin' | 'user';

/**
 * Rôle du compte, lu dans la table `profiles` (admin = accès à tous les restaurants).
 * Mis à jour en temps réel si un admin change le rôle. `null` tant qu'il n'est pas connu.
 */
export function useRole(user: User | null): Role | null {
  const [role, setRole] = useState<Role | null>(null);
  const userId = user?.id;
  const legacyAdmin = isLegacySuperAdmin(user);

  useEffect(() => {
    if (!userId) {
      setRole(null);
      return;
    }
    let cancelled = false;
    const fallback: Role = legacyAdmin ? 'admin' : 'user';

    sbClient
      .from('profiles')
      .select('role')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data) {
          if (error) console.warn('Table profiles indisponible, rôle déduit des métadonnées :', error.message);
          setRole(fallback);
        } else {
          setRole(data.role === 'admin' ? 'admin' : 'user');
        }
      });

    const channel = sbClient
      .channel(`profile-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles', filter: `id=eq.${userId}` }, payload => {
        const next = (payload.new as { role?: string } | null)?.role;
        if (next) setRole(next === 'admin' ? 'admin' : 'user');
      })
      .subscribe();

    return () => {
      cancelled = true;
      sbClient.removeChannel(channel);
    };
  }, [userId, legacyAdmin]);

  return role;
}

/**
 * Données du parc (restaurants, configurations, écrans) chargées UNE seule fois
 * pour toute l'app, puis tenues à jour en temps réel.
 * Les pings des écrans (last_ping) sont appliqués localement sans recharger la base.
 */
export function useFleetData(user: User | null) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [configurations, setConfigurations] = useState<Configuration[]>([]);
  const [screens, setScreens] = useState<AppScreen[]>([]);
  const [loading, setLoading] = useState(true);

  const role = useRole(user);
  const isSuperAdmin = role === 'admin';
  // On attend de connaître le rôle avant de charger, pour ne pas charger deux fois.
  const userId = role ? user?.id : undefined;
  const screensRef = useRef<AppScreen[]>([]);
  screensRef.current = screens;

  const refresh = useCallback(async () => {
    if (!userId) return;
    try {
      let grpQuery = sbClient.from('groups').select('*').order('name', { ascending: true });
      if (!isSuperAdmin) grpQuery = grpQuery.eq('user_id', userId);
      const { data: grp } = must(await grpQuery);
      const loadedGroups = (grp || []) as Group[];

      let loadedConfigs: Configuration[] = [];
      if (isSuperAdmin) {
        const { data } = must(await sbClient.from('configurations').select('*').order('name', { ascending: true }));
        loadedConfigs = (data || []) as Configuration[];
      } else if (loadedGroups.length > 0) {
        const { data } = must(
          await sbClient
            .from('configurations')
            .select('*')
            .in('group_id', loadedGroups.map(g => g.id))
            .order('name', { ascending: true }),
        );
        loadedConfigs = (data || []) as Configuration[];
      }

      // Admin : tous les écrans (y compris non assignés).
      // Compte client : les écrans liés à son compte + ceux de ses restaurants.
      let loadedScreens: AppScreen[] = [];
      if (isSuperAdmin) {
        const { data } = must(await sbClient.from('screens_config').select('*').order('id', { ascending: true }));
        loadedScreens = (data || []) as AppScreen[];
      } else {
        const byId = new Map<string, AppScreen>();
        if (loadedConfigs.length > 0) {
          const { data } = must(
            await sbClient.from('screens_config').select('*').in('configuration_id', loadedConfigs.map(c => c.id)),
          );
          (data || []).forEach(s => byId.set(s.id, s as AppScreen));
        }
        // Colonne user_id absente tant que la migration n'est pas passée : on ignore l'erreur.
        const owned = await sbClient.from('screens_config').select('*').eq('user_id', userId);
        if (!owned.error) (owned.data || []).forEach(s => byId.set(s.id, s as AppScreen));
        loadedScreens = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
      }

      setGroups(loadedGroups);
      setConfigurations(loadedConfigs);
      setScreens(loadedScreens);
    } catch (err) {
      console.error('Chargement des données :', err);
    } finally {
      setLoading(false);
    }
  }, [userId, isSuperAdmin]);

  useEffect(() => {
    if (!userId) {
      setGroups([]);
      setConfigurations([]);
      setScreens([]);
      return;
    }

    refresh();

    // Regroupe les rafales d'événements en un seul rechargement.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const scheduleRefresh = () => {
      clearTimeout(timer);
      timer = setTimeout(refresh, 300);
    };

    const channel = sbClient
      .channel(`fleet-${userId}-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'groups' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'configurations' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'screens_config' }, payload => {
        if (payload.eventType === 'UPDATE' && payload.new) {
          const next = payload.new as AppScreen;
          const current = screensRef.current.find(s => s.id === next.id);
          // Écran hors de notre périmètre ou changement d'assignation → rechargement complet.
          if (!current || current.configuration_id !== next.configuration_id) {
            scheduleRefresh();
            return;
          }
          setScreens(prev => prev.map(s => (s.id === next.id ? next : s)));
          return;
        }
        scheduleRefresh();
      })
      .subscribe();

    return () => {
      clearTimeout(timer);
      sbClient.removeChannel(channel);
    };
  }, [userId, refresh]);

  return { groups, configurations, screens, loading, role, isSuperAdmin, refresh };
}

/** Liste des comptes (admin uniquement) : sert à choisir le propriétaire d'un écran ou d'un restaurant. */
export function useAccounts(enabled: boolean) {
  const [accounts, setAccounts] = useState<Profile[]>([]);
  useEffect(() => {
    if (!enabled) return;
    sbClient
      .from('profiles')
      .select('id,email,role')
      .order('email', { ascending: true })
      .then(({ data, error }) => {
        if (error) console.warn('Lecture des comptes impossible :', error.message);
        else setAccounts((data || []) as Profile[]);
      });
  }, [enabled]);
  return accounts;
}

/**
 * Journal de maintenance (table screen_events), tenu à jour en temps réel.
 * `available` vaut false tant que la migration 20261110_maintenance.sql n'est pas passée.
 */
export function useScreenEvents(limit = 500) {
  const [events, setEvents] = useState<ScreenEvent[]>([]);
  const [available, setAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    sbClient
      .from('screen_events')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          setAvailable(false);
          return;
        }
        setAvailable(true);
        setEvents((data || []) as ScreenEvent[]);
      });

    const channel = sbClient
      .channel(`screen-events-${Date.now()}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'screen_events' }, payload => {
        setEvents(prev => [payload.new as ScreenEvent, ...prev].slice(0, limit));
      })
      .subscribe();

    return () => {
      cancelled = true;
      sbClient.removeChannel(channel);
    };
  }, [limit]);

  return { events, available };
}

/** Envoie une commande à un écran : le lecteur l'exécute à sa prochaine synchronisation (≤ 15 s). */
export async function sendScreenCommand(screenIds: string[], command: ScreenCommand) {
  const at = new Date().toISOString();
  await mustAll(
    screenIds.map(id =>
      sbClient.from('screens_config').update({ command, command_id: crypto.randomUUID(), command_at: at }).eq('id', id),
    ),
  );
}

/** Médiathèque (dossiers + vidéos). */
export function useLibrary() {
  const [albums, setAlbums] = useState<Album[]>([]);
  const [videos, setVideos] = useState<VideoFile[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const [a, v] = await Promise.all([
        sbClient.from('albums').select('*').order('created_at', { ascending: true }),
        sbClient.from('videos').select('*').order('created_at', { ascending: true }),
      ]);
      must(a);
      must(v);
      setAlbums((a.data || []) as Album[]);
      setVideos((v.data || []) as VideoFile[]);
    } catch (err) {
      console.error('Chargement de la médiathèque :', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { albums, videos, loading, refresh };
}

/** Horloge qui se met à jour périodiquement (pour le statut en ligne). */
export function useNow(intervalMs = 15000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
