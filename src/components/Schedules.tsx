import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarClock, Check, ChevronLeft, Film, FolderOpen, Plus, Trash2, X } from 'lucide-react';
import { sbClient } from '../lib/supabase';
import { errorMessage, must, useNow } from '../lib/data';
import { isImageUrl, parsePlaylist } from '../lib/media';
import { supportsImages } from '../lib/playerRelease';
import type { Album, VideoFile, AppScreen } from '../lib/types';
import { Badge, Button, IconButton, Modal, Switch, cn, useFeedback } from './ui';

/**
 * Programmation des playlists d'un mur (midi, soir, week-end…).
 * Les créneaux sont appliqués côté Supabase (pg_cron, chaque minute) : aucun calcul sur les écrans.
 */

interface Schedule {
  id: string;
  configuration_id: string;
  name: string;
  days: number[]; // 1 = lundi … 7 = dimanche
  start_time: string;
  end_time: string;
  video_url: string;
  enabled: boolean;
  last_applied_at: string | null;
}

const DAYS = ['Lu', 'Ma', 'Me', 'Je', 'Ve', 'Sa', 'Di'];
const DAY_NAMES = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
const hhmm = (t: string) => (t || '').slice(0, 5);
const toMin = (t: string) => {
  const [h, m] = hhmm(t).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

/** Heure et jour à Paris (référence du planificateur côté serveur). */
function parisNow(now: number) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(now));
  const get = (t: string) => parts.find(p => p.type === t)?.value || '';
  const day = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(get('weekday')) + 1;
  return { day, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

/** Même règle que apply_playlist_schedules() côté SQL. */
export function activeSchedule(list: Schedule[], now: number) {
  const { day, minutes } = parisNow(now);
  const yesterday = day === 1 ? 7 : day - 1;
  return list
    .filter(s => s.enabled && s.video_url)
    .filter(s => {
      const a = toMin(s.start_time);
      const b = toMin(s.end_time);
      if (a <= b) return s.days.includes(day) && minutes >= a && minutes < b;
      return (s.days.includes(day) && minutes >= a) || (s.days.includes(yesterday) && minutes < b);
    })
    .sort((x, y) => toMin(y.start_time) - toMin(x.start_time))[0];
}

export default function Schedules({
  configId,
  screens,
  videos,
  albums,
  perScreen = false,
}: {
  configId: string;
  /** Écrans du mur : une image n'est proposée que si tous savent l'afficher. */
  screens: AppScreen[];
  videos: VideoFile[];
  albums: Album[];
  perScreen?: boolean;
}) {
  const { toast, confirm } = useFeedback();
  const now = useNow(30000);
  const [list, setList] = useState<Schedule[]>([]);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [openedAlbum, setOpenedAlbum] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await sbClient.from('playlist_schedules').select('*').eq('configuration_id', configId).order('start_time');
    if (error) {
      setAvailable(false);
      return;
    }
    setAvailable(true);
    setList((data || []) as Schedule[]);
  }, [configId]);

  useEffect(() => {
    load();
  }, [load]);

  const active = useMemo(() => activeSchedule(list, now), [list, now]);
  const nameOf = (url: string) => videos.find(v => v.url === url)?.name || 'Vidéo externe';

  const save = async (id: string, patch: Partial<Schedule>) => {
    setList(prev => prev.map(s => (s.id === id ? { ...s, ...patch } : s)));
    const { error } = await sbClient.from('playlist_schedules').update(patch).eq('id', id);
    if (error) {
      toast(errorMessage(error), 'error');
      load();
    }
  };

  const add = async () => {
    try {
      const { data } = must(
        await sbClient
          .from('playlist_schedules')
          .insert([{ configuration_id: configId, name: list.length === 0 ? 'Midi' : 'Soir', start_time: list.length === 0 ? '11:00' : '18:00', end_time: list.length === 0 ? '14:30' : '23:00' }])
          .select()
          .single(),
      );
      setList(prev => [...prev, data as Schedule].sort((a, b) => toMin(a.start_time) - toMin(b.start_time)));
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  const remove = async (s: Schedule) => {
    const ok = await confirm({ title: `Supprimer « ${s.name} » ?`, confirmLabel: 'Supprimer', danger: true });
    if (!ok) return;
    setList(prev => prev.filter(x => x.id !== s.id));
    const { error } = await sbClient.from('playlist_schedules').delete().eq('id', s.id);
    if (error) {
      toast(errorMessage(error), 'error');
      load();
    }
  };

  // Table absente (migration non passée) : la section n'apparaît pas.
  if (available === false || available === null) return null;

  // Mode « Séparé » : un créneau imposerait la même playlist à tous les écrans
  // et ferait perdre les playlists propres à chaque écran. On ne le propose pas.
  if (perScreen && list.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-sand bg-cream/50 p-4">
        <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-white text-muted">
          <CalendarClock className="h-4.5 w-4.5" />
        </span>
        <p className="text-sm text-muted">
          <span className="font-bold text-ink">Programmation</span> disponible en mode Unique
        </p>
      </div>
    );
  }

  const picker = list.find(s => s.id === pickerFor);
  const albumVideos = openedAlbum ? videos.filter(v => v.album_id === openedAlbum) : [];

  return (
    <div className={cn('space-y-3 rounded-2xl border p-4', list.length ? 'border-brand/30 bg-brand-50/40' : 'border-sand bg-cream/50')}>
      <div className="flex items-center gap-3">
        <span className={cn('flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl', list.length ? 'bg-brand text-white' : 'bg-white text-muted')}>
          <CalendarClock className="h-4.5 w-4.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-bold text-ink">Programmation</p>
          {list.length > 0 && (
            <p className="truncate text-xs text-muted">
              Maintenant : <span className="font-bold text-ink">{active ? `${active.name} · jusqu’à ${hhmm(active.end_time)}` : 'playlist normale'}</span>
              {active && ' · la playlist déployée revient ensuite'}
            </p>
          )}
        </div>
        <IconButton label="Ajouter un créneau" variant="secondary" onClick={add}>
          <Plus className="h-5 w-5" />
        </IconButton>
      </div>

      {list.map(s => {
        const playlist = parsePlaylist(s.video_url);
        const isActive = active?.id === s.id;
        return (
          <div key={s.id} className={cn('space-y-3 rounded-2xl border bg-white p-3', isActive ? 'border-brand ring-2 ring-brand/15' : 'border-line', !s.enabled && 'opacity-60')}>
            <div className="flex items-center gap-2">
              <input
                defaultValue={s.name}
                onBlur={e => e.target.value.trim() && e.target.value.trim() !== s.name && save(s.id, { name: e.target.value.trim() })}
                aria-label="Nom du créneau"
                className="min-w-0 flex-1 rounded-xl bg-transparent px-2 py-1 text-[15px] font-bold text-ink outline-none focus:bg-cream"
              />
              {isActive && <Badge>En cours</Badge>}
              <Switch checked={s.enabled} onChange={v => save(s.id, { enabled: v })} label={`Activer ${s.name}`} />
              <IconButton label={`Supprimer ${s.name}`} size="sm" variant="danger" onClick={() => remove(s)}>
                <Trash2 className="h-4 w-4" />
              </IconButton>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex gap-1" role="group" aria-label="Jours">
                {DAYS.map((d, i) => {
                  const day = i + 1;
                  const on = s.days.includes(day);
                  return (
                    <button
                      key={day}
                      type="button"
                      aria-pressed={on}
                      aria-label={DAY_NAMES[i]}
                      title={DAY_NAMES[i]}
                      onClick={() => save(s.id, { days: on ? s.days.filter(x => x !== day) : [...s.days, day].sort() })}
                      className={cn('h-8 w-8 rounded-lg text-[11px] font-black transition', on ? 'bg-brand text-white' : 'bg-cream text-muted hover:bg-sand')}
                    >
                      {d}
                    </button>
                  );
                })}
              </div>
              <div className="ml-auto flex items-center gap-1.5">
                <input
                  type="time"
                  value={hhmm(s.start_time)}
                  onChange={e => save(s.id, { start_time: e.target.value })}
                  aria-label="Début"
                  className="h-9 rounded-xl border border-line bg-white px-2 text-sm font-bold tabular-nums text-ink outline-none focus:border-brand"
                />
                <span className="text-muted">→</span>
                <input
                  type="time"
                  value={hhmm(s.end_time)}
                  onChange={e => save(s.id, { end_time: e.target.value })}
                  aria-label="Fin"
                  className="h-9 rounded-xl border border-line bg-white px-2 text-sm font-bold tabular-nums text-ink outline-none focus:border-brand"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {playlist.map((url, i) => (
                <span key={`${url}-${i}`} className="inline-flex max-w-full items-center gap-1 rounded-lg bg-cream py-1 pl-2 pr-1 text-xs font-bold text-ink">
                  <span className="truncate">
                    {i + 1}. {nameOf(url)}
                  </span>
                  <button
                    type="button"
                    aria-label="Retirer"
                    onClick={() => save(s.id, { video_url: playlist.filter((_, k) => k !== i).join(',') })}
                    className="flex h-5 w-5 items-center justify-center rounded-md text-muted hover:bg-red-50 hover:text-red-600"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </span>
              ))}
              <Button
                size="sm"
                variant="soft"
                icon={<Plus className="h-4 w-4" />}
                onClick={() => {
                  setPickerFor(s.id);
                  setOpenedAlbum(null);
                }}
              >
                {playlist.length ? 'Vidéo' : 'Choisir les vidéos'}
              </Button>
            </div>
          </div>
        );
      })}

      <Modal
        open={!!picker}
        onClose={() => setPickerFor(null)}
        z="z-[60]"
        title={openedAlbum ? albums.find(a => a.id === openedAlbum)?.name : picker?.name}
        leading={
          openedAlbum ? (
            <IconButton label="Retour" variant="secondary" onClick={() => setOpenedAlbum(null)}>
              <ChevronLeft className="h-5 w-5" />
            </IconButton>
          ) : undefined
        }
        footer={
          <Button block size="lg" onClick={() => setPickerFor(null)}>
            OK
          </Button>
        }
      >
        {picker &&
          (!openedAlbum ? (
            <div className="space-y-2">
              {[...albums]
                .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
                .map(a => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => setOpenedAlbum(a.id)}
                    className="flex w-full items-center gap-3 rounded-2xl border border-line bg-white p-3.5 text-left transition hover:border-brand/40"
                  >
                    <FolderOpen className="h-5 w-5 text-brand" />
                    <span className="min-w-0 flex-1 truncate text-[15px] font-bold text-ink">{a.name}</span>
                    <Badge>{videos.filter(v => v.album_id === a.id).length}</Badge>
                  </button>
                ))}
            </div>
          ) : (
            <div className="space-y-2">
              {albumVideos.map(v => {
                const inList = parsePlaylist(picker.video_url).includes(v.url);
                return (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => {
                      const old = screens.filter(s => !supportsImages(s));
                      if (isImageUrl(v.url) && old.length > 0) {
                        toast(`Images : lecteur 1.6 requis sur ${old.length > 2 ? `${old.length} écrans` : old.map(s => s.id).join(', ')}`, 'error');
                        return;
                      }
                      save(picker.id, { video_url: [...parsePlaylist(picker.video_url), v.url].join(',') });
                    }}
                    className="flex w-full items-center gap-3 rounded-2xl border border-line bg-white p-3 text-left transition hover:border-brand/40"
                  >
                    <Film className="h-5 w-5 flex-shrink-0 text-brand" />
                    <span className="min-w-0 flex-1 truncate text-sm font-bold text-ink">{v.name}</span>
                    {inList ? <Check className="h-5 w-5 text-emerald-600" /> : <Plus className="h-5 w-5 text-brand" />}
                  </button>
                );
              })}
            </div>
          ))}
      </Modal>
    </div>
  );
}
