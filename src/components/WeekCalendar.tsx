import { useEffect, useMemo, useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { sbClient } from '../lib/supabase';
import { useLibrary } from '../lib/data';
import { parsePlaylist } from '../lib/media';
import type { AppScreen, Configuration, Group } from '../lib/types';
import { cn } from './ui';

/**
 * Semaine d'un mur : ce qui est diffusé chaque jour, heure par heure.
 * Même règle que le programmateur du serveur (apply_playlist_schedules) :
 * créneau actif = le plus récemment commencé ; sinon la playlist normale ; hors horaires = veille.
 */

interface Slot {
  id: string;
  name: string;
  days: number[]; // 1 = lundi … 7 = dimanche
  start_time: string;
  end_time: string;
  video_url: string;
  enabled: boolean;
}

type Segment = { from: number; to: number; kind: 'closed' | 'normal' | 'slot'; slot?: Slot };

const DAYS = ['Lu', 'Ma', 'Me', 'Je', 'Ve', 'Sa', 'Di'];
const DAY_NAMES = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
const SLOT_COLORS = ['bg-sky-500', 'bg-violet-500', 'bg-emerald-500', 'bg-pink-500', 'bg-amber-500', 'bg-cyan-600'];
const SLOT_TEXT = ['text-sky-700', 'text-violet-700', 'text-emerald-700', 'text-pink-700', 'text-amber-700', 'text-cyan-700'];

const toMin = (t: string | null | undefined) => {
  const [h, m] = (t || '').slice(0, 5).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};
const fmt = (m: number) => (m >= 1440 ? '24:00' : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);

/** Jour de la semaine à Paris (1 = lundi). */
const todayParis = () => {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' })).getDay();
  return d === 0 ? 7 : d;
};

function daySegments(day: number, slots: Slot[], open: number, close: number): Segment[] {
  const yesterday = day === 1 ? 7 : day - 1;
  // Intervalles actifs ce jour-là (un créneau qui passe minuit déborde sur le lendemain).
  const intervals: { from: number; to: number; prio: number; slot: Slot }[] = [];
  for (const s of slots) {
    if (!s.enabled || !s.video_url) continue;
    const a = toMin(s.start_time);
    const b = toMin(s.end_time);
    if (a <= b) {
      if (s.days.includes(day)) intervals.push({ from: a, to: b, prio: a, slot: s });
    } else {
      if (s.days.includes(day)) intervals.push({ from: a, to: 1440, prio: a, slot: s });
      if (s.days.includes(yesterday)) intervals.push({ from: 0, to: b, prio: a, slot: s });
    }
  }
  const isOpen = (m: number) => (open <= close ? m >= open && m < close : m >= open || m < close);
  const cuts = [...new Set([0, 1440, open, close, ...intervals.flatMap(i => [i.from, i.to])])].filter(m => m >= 0 && m <= 1440).sort((x, y) => x - y);

  const out: Segment[] = [];
  for (let k = 0; k < cuts.length - 1; k++) {
    const from = cuts[k];
    const to = cuts[k + 1];
    if (to <= from) continue;
    let seg: Segment;
    if (!isOpen(from)) seg = { from, to, kind: 'closed' };
    else {
      const active = intervals.filter(i => from >= i.from && from < i.to).sort((x, y) => y.prio - x.prio)[0];
      seg = active ? { from, to, kind: 'slot', slot: active.slot } : { from, to, kind: 'normal' };
    }
    const last = out[out.length - 1];
    if (last && last.kind === seg.kind && last.slot?.id === seg.slot?.id) last.to = to;
    else out.push(seg);
  }
  return out;
}

export default function WeekCalendar({ config, group, screens }: { config: Configuration; group?: Group; screens: AppScreen[] }) {
  const library = useLibrary();
  const [slots, setSlots] = useState<Slot[]>([]);
  const [normalUrl, setNormalUrl] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState(todayParis);

  // Chargé à l'ouverture du mur seulement (2 petites requêtes).
  useEffect(() => {
    let stale = false;
    Promise.all([
      sbClient.from('playlist_schedules').select('id,name,days,start_time,end_time,video_url,enabled').eq('configuration_id', config.id),
      sbClient.from('configurations').select('default_video_url').eq('id', config.id).maybeSingle(),
    ]).then(([s, c]) => {
      if (stale) return;
      setSlots(s.error ? [] : ((s.data || []) as Slot[]));
      setNormalUrl(c.error ? null : ((c.data as { default_video_url?: string | null } | null)?.default_video_url ?? null));
    });
    return () => {
      stale = true;
    };
  }, [config.id]);

  const master = screens.find(s => s.pos_x === 0 && s.pos_y === 0) || screens[0];
  const normalPlaylist = normalUrl ?? master?.video_url ?? '';
  const open = group?.open_time ? toMin(group.open_time) : 0;
  const close = group?.close_time ? toMin(group.close_time) : 1440;
  const colorOf = (slot?: Slot) => Math.max(0, slots.findIndex(s => s.id === slot?.id)) % SLOT_COLORS.length;

  const week = useMemo(() => [1, 2, 3, 4, 5, 6, 7].map(d => daySegments(d, slots, open, close)), [slots, open, close]);
  const nameOf = (url: string) => library.videos.find(v => v.url === url)?.name || 'Média externe';
  const playlistNames = (raw: string) => {
    const list = parsePlaylist(raw).map(nameOf);
    return list.length ? list.join(' · ') : 'Aucun média';
  };
  const usedSlots = slots.filter(s => s.enabled && s.video_url && week.some(day => day.some(seg => seg.slot?.id === s.id)));
  const today = todayParis();

  return (
    <section className="space-y-3">
      <h3 className="flex items-center gap-2 px-1 text-base font-extrabold text-ink">
        <CalendarDays className="h-5 w-5 text-brand" /> Semaine
      </h3>

      {/* Légende */}
      <div className="flex flex-wrap gap-x-3 gap-y-1.5 px-1 text-xs font-bold text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-brand/25" /> Playlist normale
        </span>
        {usedSlots.map(s => (
          <span key={s.id} className="inline-flex items-center gap-1.5">
            <span className={cn('h-2.5 w-2.5 rounded-sm', SLOT_COLORS[colorOf(s)])} /> {s.name}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-ink/80" /> Veille
        </span>
      </div>

      {/* Une barre par jour, de 0 h à 24 h */}
      <div className="card space-y-1.5 p-3">
        {week.map((segments, i) => {
          const day = i + 1;
          return (
            <button
              key={day}
              type="button"
              onClick={() => setSelectedDay(day)}
              aria-pressed={selectedDay === day}
              aria-label={DAY_NAMES[i]}
              className={cn('flex w-full items-center gap-2 rounded-xl p-1 transition', selectedDay === day ? 'bg-brand-50 ring-1 ring-brand/40' : 'hover:bg-cream')}
            >
              <span className={cn('w-7 flex-shrink-0 text-left text-xs font-black', day === today ? 'text-brand-700' : 'text-ink')}>{DAYS[i]}</span>
              <span className="flex h-6 flex-1 overflow-hidden rounded-lg bg-sand">
                {segments.map(seg => (
                  <span
                    key={`${seg.from}-${seg.kind}`}
                    style={{ width: `${((seg.to - seg.from) / 1440) * 100}%` }}
                    className={cn('h-full', seg.kind === 'closed' ? 'bg-ink/80' : seg.kind === 'normal' ? 'bg-brand/25' : SLOT_COLORS[colorOf(seg.slot)])}
                    title={`${fmt(seg.from)}–${fmt(seg.to)} · ${seg.kind === 'closed' ? 'Veille' : seg.kind === 'normal' ? 'Playlist normale' : seg.slot?.name}`}
                  />
                ))}
              </span>
            </button>
          );
        })}
        <div className="flex pl-10 pr-1 text-[10px] font-bold tabular-nums text-muted">
          {['0 h', '6 h', '12 h', '18 h', '24 h'].map((h, i) => (
            <span key={h} className={cn('flex-1', i === 4 && 'flex-none')}>
              {h}
            </span>
          ))}
        </div>
      </div>

      {/* Détail du jour choisi */}
      <div className="card divide-y divide-sand overflow-hidden">
        <p className="px-4 py-2.5 text-sm font-extrabold text-ink">
          {DAY_NAMES[selectedDay - 1]}
          {selectedDay === today && <span className="ml-1.5 font-semibold text-brand-700">· aujourd’hui</span>}
        </p>
        {week[selectedDay - 1].map(seg => (
          <div key={`${seg.from}-${seg.kind}`} className="flex items-start gap-3 px-4 py-2.5 text-sm">
            <span className="w-[92px] flex-shrink-0 font-bold tabular-nums text-ink">
              {fmt(seg.from)} – {fmt(seg.to)}
            </span>
            <span className="min-w-0 flex-1">
              <span
                className={cn(
                  'block font-bold',
                  seg.kind === 'closed' ? 'text-muted' : seg.kind === 'normal' ? 'text-brand-800' : SLOT_TEXT[colorOf(seg.slot)],
                )}
              >
                {seg.kind === 'closed' ? 'Veille · écran éteint' : seg.kind === 'normal' ? 'Playlist normale' : seg.slot?.name}
              </span>
              {seg.kind !== 'closed' && (
                <span className="block truncate text-xs text-muted">{playlistNames(seg.kind === 'slot' ? seg.slot!.video_url : normalPlaylist)}</span>
              )}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
