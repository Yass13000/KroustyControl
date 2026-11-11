import type { CSSProperties, ReactNode } from 'react';
import { Activity, CalendarClock, ChevronRight, Clapperboard, MonitorPlay, Rocket, Stethoscope, Store, Upload } from 'lucide-react';
import { useLibrary, useScreenEvents } from '../lib/data';
import { libraryAccess } from '../lib/library';
import { isImageUrl, isOnline, parseFormat, parsePlaylist, timeAgo } from '../lib/media';
import type { AppScreen, Configuration, Group, ScreenEvent } from '../lib/types';
import { cn } from './ui';

interface DashboardProps {
  displayName: string;
  groups: Group[];
  configurations: Configuration[];
  screens: AppScreen[];
  isSuperAdmin: boolean;
  now: number;
  criticalCount: number;
  onOpenWall: (configId: string) => void;
  onNavigate: (tab: 'accueil' | 'appareils' | 'bibliotheque' | 'maintenance') => void;
}

const greeting = (d: Date) => {
  const h = d.getHours();
  return h < 5 ? 'Bonne nuit' : h < 12 ? 'Bonjour' : h < 18 ? 'Bon après-midi' : 'Bonsoir';
};

export default function Dashboard({ displayName, groups, configurations, screens, isSuperAdmin, now, criticalCount, onOpenWall, onNavigate }: DashboardProps) {
  const library = useLibrary();
  const journal = useScreenEvents(40);

  const awake = screens.filter(s => isOnline(s.last_ping, now) && s.power_state !== 'sleep').length;
  const asleep = screens.filter(s => isOnline(s.last_ping, now) && s.power_state === 'sleep').length;
  const offline = screens.length - awake - asleep;

  const access = libraryAccess(isSuperAdmin, groups);
  const visibleAlbumIds = new Set(library.albums.filter(access.canSee).map(a => a.id));
  const videoCount = library.videos.filter(v => visibleAlbumIds.has(v.album_id)).length;
  const playingUrls = new Set(screens.flatMap(s => parsePlaylist(s.video_url)));

  const groupById = new Map(groups.map(g => [g.id, g]));
  const walls = configurations
    .map(c => ({ config: c, group: groupById.get(c.group_id), inWall: screens.filter(s => s.configuration_id === c.id) }))
    .filter(w => w.inWall.length > 0)
    .sort((a, b) => (a.group?.name || '').localeCompare(b.group?.name || '', 'fr'));

  const myScreenIds = new Set(screens.map(s => s.id));
  const recent = journal.events.filter(e => myScreenIds.has(e.screen_id)).slice(0, 5);

  const date = new Date(now);
  const healthy = offline === 0 && criticalCount === 0;

  return (
    <div className="space-y-6">
      {/* --- Accueil --- */}
      <header className="px-1">
        <p className="text-sm font-semibold capitalize text-muted">{date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        <h1 className="mt-0.5 text-[28px] font-extrabold leading-tight tracking-tight text-ink">
          {greeting(date)}
          {displayName && <span className="text-brand">, {displayName}</span>}
        </h1>
      </header>

      {/* --- État du parc --- */}
      <section className="card relative overflow-hidden p-5">
        <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-brand/10 blur-2xl" />
        <div className="relative flex items-center gap-5">
          <Ring awake={awake} asleep={asleep} offline={offline} />
          <div className="min-w-0 flex-1">
            <p className={cn('text-lg font-extrabold', healthy ? 'text-emerald-700' : 'text-ink')}>
              {healthy ? 'Tout fonctionne' : offline > 0 ? `${offline} écran${offline > 1 ? 's' : ''} hors ligne` : `${criticalCount} alerte${criticalCount > 1 ? 's' : ''}`}
            </p>
            <ul className="mt-2 space-y-1 text-sm">
              <Legend color="bg-online" label="En ligne" value={awake} />
              {asleep > 0 && <Legend color="bg-indigo-400" label="En veille" value={asleep} />}
              <Legend color="bg-muted/35" label="Hors ligne" value={offline} />
            </ul>
            {isSuperAdmin && criticalCount > 0 && (
              <button type="button" onClick={() => onNavigate('maintenance')} className="mt-3 inline-flex items-center gap-1 text-sm font-bold text-brand-700 hover:underline">
                Voir la maintenance <ChevronRight className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </section>

      {/* --- Chiffres clés --- */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat icon={<Store className="h-5 w-5" />} value={groups.length} label="Restaurants" onClick={() => onNavigate('appareils')} />
        <Stat icon={<MonitorPlay className="h-5 w-5" />} value={screens.length} label="Écrans" onClick={() => onNavigate('appareils')} />
        <Stat icon={<Clapperboard className="h-5 w-5" />} value={videoCount} label="Vidéos" onClick={() => onNavigate('bibliotheque')} />
        <Stat icon={<Rocket className="h-5 w-5" />} value={playingUrls.size} label="En diffusion" onClick={() => onNavigate('accueil')} />
      </section>

      {/* --- Mes murs --- */}
      {walls.length > 0 && (
        <section className="space-y-3">
          <h2 className="px-1 text-lg font-extrabold text-ink">Mes murs</h2>
          <div className="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 md:mx-0 md:grid md:grid-cols-3 md:overflow-visible md:px-0">
            {walls.map(({ config, group, inWall }) => {
              const master = inWall.find(s => s.pos_x === 0 && s.pos_y === 0) || inWall[0];
              const firstUrl = parsePlaylist(master?.video_url)[0];
              const thumb = firstUrl ? library.videos.find(v => v.url === firstUrl)?.thumbnail || null : null;
              const on = inWall.filter(s => isOnline(s.last_ping, now)).length;
              return (
                <button
                  key={config.id}
                  type="button"
                  onClick={() => onOpenWall(config.id)}
                  className="card w-[78%] flex-shrink-0 snap-start overflow-hidden p-2.5 text-left transition hover:-translate-y-0.5 hover:shadow-lift active:scale-[0.99] sm:w-[46%] md:w-auto"
                >
                  <MiniWall config={config} screens={inWall} thumb={thumb} videoUrl={thumb ? null : firstUrl || null} now={now} />
                  <div className="flex items-center gap-2 px-1.5 pb-0.5 pt-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] font-bold text-ink">{group?.name}</p>
                      <p className="truncate text-xs text-muted">{config.name}</p>
                    </div>
                    <span className="flex items-center gap-1.5 text-sm font-bold tabular-nums text-ink">
                      <span className={cn('h-2 w-2 rounded-full', on > 0 ? 'bg-online' : 'bg-muted/35')} />
                      {on}/{inWall.length}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* --- Raccourcis --- */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Action icon={<Rocket className="h-5 w-5" />} label="Diffuser" tone="brand" onClick={() => onNavigate('accueil')} />
        <Action icon={<Upload className="h-5 w-5" />} label="Ajouter une vidéo" onClick={() => onNavigate('bibliotheque')} />
        <Action icon={<CalendarClock className="h-5 w-5" />} label="Programmer" onClick={() => onNavigate('accueil')} />
        {isSuperAdmin ? (
          <Action icon={<Stethoscope className="h-5 w-5" />} label="Maintenance" onClick={() => onNavigate('maintenance')} alert={criticalCount > 0} />
        ) : (
          <Action icon={<MonitorPlay className="h-5 w-5" />} label="Mes écrans" onClick={() => onNavigate('appareils')} />
        )}
      </section>

      {/* --- Activité récente --- */}
      {journal.available && recent.length > 0 && (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 px-1 text-lg font-extrabold text-ink">
            <Activity className="h-5 w-5 text-brand" /> Activité
          </h2>
          <ul className="card divide-y divide-sand overflow-hidden">
            {recent.map(e => (
              <li key={e.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                <span className={cn('h-2 w-2 flex-shrink-0 rounded-full', EVENT_DOT[e.kind])} />
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-bold text-ink">{e.screen_id}</span> <span className="text-muted">{eventText(e)}</span>
                </span>
                <span className="flex-shrink-0 text-xs tabular-nums text-muted">{timeAgo(e.created_at, now)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/* ================================ Sous-composants ================================ */

const EVENT_DOT: Record<ScreenEvent['kind'], string> = {
  outage: 'bg-red-500',
  boot: 'bg-sky-500',
  error: 'bg-amber-500',
  command: 'bg-violet-500',
  content: 'bg-brand',
  assign: 'bg-muted',
  power: 'bg-indigo-400',
};

function eventText(e: ScreenEvent) {
  if (e.kind === 'outage' && e.started_at) {
    const m = Math.max(1, Math.round((new Date(e.created_at).getTime() - new Date(e.started_at).getTime()) / 60000));
    return `coupure de ${m < 60 ? `${m} min` : `${Math.round(m / 60)} h`}`;
  }
  return (e.message || e.kind).toLowerCase();
}

/** Anneau d'état : en ligne / en veille / hors ligne. */
function Ring({ awake, asleep, offline }: { awake: number; asleep: number; offline: number }) {
  const total = Math.max(1, awake + asleep + offline);
  const r = 44;
  const c = 2 * Math.PI * r;
  const seg = (n: number) => (n / total) * c;
  const parts = [
    { n: awake, color: '#22b455' },
    { n: asleep, color: '#818cf8' },
    { n: offline, color: '#e3dad0' },
  ];
  let offset = 0;
  return (
    <div className="relative h-28 w-28 flex-shrink-0">
      <svg viewBox="0 0 110 110" className="h-full w-full -rotate-90">
        <circle cx="55" cy="55" r={r} fill="none" stroke="#f2ede4" strokeWidth="12" />
        {parts.map((p, i) => {
          if (!p.n) return null;
          const len = seg(p.n);
          const el = (
            <circle
              key={i}
              cx="55"
              cy="55"
              r={r}
              fill="none"
              stroke={p.color}
              strokeWidth="12"
              strokeDasharray={`${Math.max(0, len - 3)} ${c}`}
              strokeDashoffset={-offset}
              strokeLinecap="round"
              className="ring-seg"
            />
          );
          offset += len;
          return el;
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-extrabold tabular-nums leading-none text-ink">{awake + asleep}</span>
        <span className="mt-0.5 text-xs font-semibold text-muted">/ {awake + asleep + offline}</span>
      </div>
    </div>
  );
}

function Legend({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <li className="flex items-center gap-2">
      <span className={cn('h-2.5 w-2.5 rounded-full', color)} />
      <span className="flex-1 text-muted">{label}</span>
      <span className="font-bold tabular-nums text-ink">{value}</span>
    </li>
  );
}

function Stat({ icon, value, label, onClick }: { icon: ReactNode; value: number; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="card flex items-center gap-3 p-3.5 text-left transition hover:-translate-y-0.5 hover:shadow-lift active:scale-[0.98]">
      <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand">{icon}</span>
      <span className="min-w-0">
        <span className="block text-xl font-extrabold tabular-nums leading-none text-ink">{value}</span>
        <span className="mt-1 block truncate text-xs font-semibold text-muted">{label}</span>
      </span>
    </button>
  );
}

function Action({ icon, label, onClick, tone, alert }: { icon: ReactNode; label: string; onClick: () => void; tone?: 'brand'; alert?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'relative flex items-center gap-3 rounded-2xl p-3.5 text-left text-sm font-bold transition active:scale-[0.98]',
        tone === 'brand' ? 'sheen bg-gradient-to-b from-[#ff8a3d] to-brand-600 text-white shadow-brand' : 'card text-ink hover:shadow-lift',
      )}
    >
      <span className={cn('flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl', tone === 'brand' ? 'bg-white/20' : 'bg-cream text-brand')}>{icon}</span>
      <span className="leading-tight">{label}</span>
      {alert && <span className="absolute right-3 top-3 h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-white" />}
    </button>
  );
}

/**
 * Mur en miniature : la vraie image du mur étalée sur ses écrans (fines séparations),
 * écrans hors ligne grisés, emplacements vides en pointillés.
 */
function MiniWall({ config, screens, thumb, videoUrl, now }: { config: Configuration; screens: AppScreen[]; thumb: string | null; videoUrl: string | null; now: number }) {
  const { rows, cols } = parseFormat(config.format);
  const cells: { x: number; y: number; s?: AppScreen }[] = [];
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) cells.push({ x, y, s: screens.find(sc => sc.pos_x === x && sc.pos_y === y) });

  return (
    <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-brand to-brand-800" style={{ aspectRatio: `${cols * 16} / ${rows * 9}` }}>
      {thumb ? (
        <img src={thumb} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
      ) : videoUrl && isImageUrl(videoUrl) ? (
        <img src={videoUrl} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
      ) : videoUrl ? (
        <video
          src={`${videoUrl}#t=5`}
          muted
          playsInline
          preload="metadata"
          // Invisible tant qu'aucune image n'est prête : sinon un rectangle noir s'affiche à la place du dégradé.
          onSeeked={e => (e.currentTarget.style.opacity = '1')}
          className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-0 transition-opacity duration-500"
        />
      ) : null}
      <div className="absolute inset-0 grid gap-[3px]" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` } as CSSProperties}>
        {cells.map(({ x, y, s }) => {
          const on = s && isOnline(s.last_ping, now);
          return (
            <span
              key={`${x}-${y}`}
              className={cn(
                'rounded-[4px] ring-[3px] ring-white',
                !s && 'border border-dashed border-white/70 bg-white/80',
                s && !on && 'bg-ink/35 backdrop-grayscale',
              )}
            />
          );
        })}
      </div>
    </div>
  );
}
