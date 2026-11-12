import type { ReactNode } from 'react';
import {
  Activity,
  Cable,
  Clock,
  Film,
  Gauge,
  House,
  HardDrive,
  LayoutGrid,
  Loader2,
  MemoryStick,
  Monitor,
  Moon,
  PackageCheck,
  Play,
  ShieldCheck,
  Thermometer,
  Wifi,
  WifiOff,
  type LucideIcon,
} from 'lucide-react';
import { isOnline } from '../lib/media';
import { healthLights, healthOf, networkLight, stabilityLight, worstTone, type Light, type Tone } from '../lib/health';
import { screenVersionCode } from '../lib/playerRelease';
import type { Issue, IssueKind, Severity } from '../lib/diagnostics';
import type { AppScreen, Configuration } from '../lib/types';
import { cn } from './ui';

/* ------------------------------ Couleurs ------------------------------ */

/** Pastille pleine (comme un bouton activé du centre de contrôle). */
const PILL: Record<Tone, string> = {
  ok: 'bg-emerald-500 text-white',
  warn: 'bg-amber-500 text-white',
  bad: 'bg-red-500 text-white',
  off: 'bg-sand text-muted',
};
const RING: Record<Tone, string> = {
  ok: 'border-transparent',
  warn: 'border-amber-200',
  bad: 'border-red-300 ring-2 ring-red-100',
  off: 'border-transparent',
};
const VALUE: Record<Tone, string> = {
  ok: 'text-ink',
  warn: 'text-amber-700',
  bad: 'text-red-600',
  off: 'text-muted',
};
const ICON_ONLY: Record<Tone, string> = {
  ok: 'text-emerald-600',
  warn: 'text-amber-600',
  bad: 'text-red-600',
  off: 'text-muted/40',
};

const sevTone = (s: Severity | undefined): Tone => (s === 'critical' ? 'bad' : s === 'warning' ? 'warn' : 'ok');
const worstSeverity = (list: Issue[]): Severity | undefined =>
  list.some(i => i.severity === 'critical') ? 'critical' : list.some(i => i.severity === 'warning') ? 'warning' : list.length ? 'info' : undefined;

/* ------------------------------ Tuiles du parc ------------------------------ */

export interface Tile {
  key: string;
  label: string;
  value: string;
  tone: Tone;
  icon: LucideIcon;
  busy?: boolean;
  /** Écrans concernés (filtre de la liste quand on touche la tuile). */
  match: (s: AppScreen) => boolean;
}

export function controlTiles({
  screens,
  configurations,
  issues,
  now,
  media,
}: {
  screens: AppScreen[];
  configurations: Configuration[];
  issues: Issue[];
  now: number;
  media: { ok: number; total: number; testing: boolean };
}): Tile[] {
  const byKinds = (kinds: IssueKind[]) => issues.filter(i => kinds.includes(i.kind));
  const screensOf = (list: Issue[]) => new Set(list.map(i => i.screenId).filter((x): x is string => !!x));
  const online = screens.filter(s => isOnline(s.last_ping, now));
  const measured = online.map(s => ({ s, h: healthOf(s) })).filter((x): x is { s: AppScreen; h: NonNullable<ReturnType<typeof healthOf>> } => !!x.h);

  // 1. En ligne
  const offline = byKinds(['offline_open', 'offline_closed', 'never_seen']);
  // 2. Réseau
  const net = byKinds(['weak_network', 'unstable']);
  const netIds = screensOf(net);
  // 3. Lecture
  const playIssues = byKinds(['player_error']);
  const playErr = new Set([...screensOf(playIssues), ...measured.filter(x => x.h.play === 'error').map(x => x.s.id)]);
  const awake = measured.filter(x => x.h.play !== 'sleep');
  const playing = awake.filter(x => x.h.play === 'playing').length;
  // 4. Murs
  const walls = configurations.filter(c => screens.filter(s => s.configuration_id === c.id).length > 1);
  const wallIssues = byKinds(['wall_sync', 'duplicate_position', 'out_of_grid', 'format_mismatch']);
  const badWalls = new Set(wallIssues.map(i => i.configId ?? screens.find(s => s.id === i.screenId)?.configuration_id).filter(Boolean));
  // 5. Médias
  const mediaIssues = byKinds(['media_broken', 'media_drive', 'heavy_media', 'no_video']);
  // 6. Lecteurs
  const codes = screens.map(s => screenVersionCode(s) ?? 0);
  const latest = Math.max(0, ...codes);
  const upToDate = screens.filter(s => (screenVersionCode(s) ?? 0) === latest).length;
  // 7. Veille
  const sleepIssues = byKinds(['sleep_while_open', 'awake_while_closed', 'scheduler_down']);
  const eligible = screens.filter(s => (screenVersionCode(s) ?? 0) >= 8);
  const turnsOff = eligible.filter(s => s.screen_off).length;
  // 8. Appareils
  const devIssues = byKinds(['device_health']);
  const devIds = screensOf(devIssues);

  return [
    {
      key: 'online',
      label: 'En ligne',
      icon: Monitor,
      value: `${online.length}/${screens.length}`,
      tone: offline.length ? sevTone(worstSeverity(offline)) : 'ok',
      match: s => !isOnline(s.last_ping, now),
    },
    {
      key: 'network',
      label: 'Réseau',
      icon: net.length ? WifiOff : Wifi,
      value: measured.length ? `${measured.length - netIds.size}/${measured.length}` : '—',
      tone: net.length ? sevTone(worstSeverity(net)) : measured.length ? 'ok' : 'off',
      match: s => netIds.has(s.id),
    },
    {
      key: 'playback',
      label: playErr.size ? (playErr.size > 1 ? 'Erreurs' : 'Erreur') : 'Lecture',
      icon: Play,
      // Erreurs : on affiche leur nombre (« 3/3 » en rouge serait contradictoire).
      value: playErr.size ? `${playErr.size}` : awake.length ? `${playing}/${awake.length}` : '—',
      tone: playErr.size ? 'bad' : awake.length ? (playing < awake.length ? 'warn' : 'ok') : 'off',
      match: s => playErr.has(s.id) || (healthOf(s)?.play !== undefined && !['playing', 'sleep'].includes(healthOf(s)!.play!)),
    },
    {
      key: 'walls',
      label: 'Murs',
      icon: LayoutGrid,
      value: walls.length ? `${walls.length - badWalls.size}/${walls.length}` : '—',
      tone: wallIssues.length ? sevTone(worstSeverity(wallIssues)) : walls.length ? 'ok' : 'off',
      match: s => wallIssues.some(i => i.screenId === s.id || (i.configId && i.configId === s.configuration_id)),
    },
    {
      key: 'media',
      label: 'Médias',
      icon: Film,
      busy: media.testing,
      value: media.total ? `${media.ok}/${media.total}` : '—',
      tone: mediaIssues.length ? sevTone(worstSeverity(mediaIssues)) : media.total ? 'ok' : 'off',
      match: s => mediaIssues.some(i => i.screenId === s.id || (i.configId && i.configId === s.configuration_id)),
    },
    {
      key: 'players',
      label: 'Lecteurs',
      icon: PackageCheck,
      value: latest ? `${upToDate}/${screens.length}` : '—',
      tone: latest && upToDate < screens.length ? 'warn' : latest ? 'ok' : 'off',
      match: s => (screenVersionCode(s) ?? 0) < latest,
    },
    {
      key: 'sleep',
      label: 'Veille',
      icon: Moon,
      value: eligible.length ? `${turnsOff}/${eligible.length}` : '—',
      tone: sleepIssues.length ? sevTone(worstSeverity(sleepIssues)) : eligible.length ? (turnsOff < eligible.length ? 'warn' : 'ok') : 'off',
      match: s => ((screenVersionCode(s) ?? 0) >= 8 && !s.screen_off) || sleepIssues.some(i => i.screenId === s.id),
    },
    {
      key: 'device',
      label: 'Appareils',
      icon: HardDrive,
      value: measured.length ? `${measured.length - devIds.size}/${measured.length}` : '—',
      tone: devIssues.length ? sevTone(worstSeverity(devIssues)) : measured.length ? 'ok' : 'off',
      match: s => devIds.has(s.id),
    },
  ];
}

/** Grille de tuiles façon centre de contrôle : icône en pastille colorée, donnée en gros dessous. */
export function ControlCenter({ tiles, active, onSelect }: { tiles: Tile[]; active: string | null; onSelect: (key: string) => void }) {
  return (
    <div className="grid grid-cols-4 gap-2 sm:gap-3 lg:grid-cols-8">
      {tiles.map(t => {
        const Icon = t.icon;
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => onSelect(t.key)}
            aria-pressed={active === t.key}
            className={cn(
              'flex flex-col items-start gap-2 rounded-[22px] border bg-white p-2.5 text-left shadow-sm transition active:scale-[0.97] sm:p-3',
              RING[t.tone],
              active === t.key && 'ring-2 ring-brand',
            )}
          >
            <span className={cn('flex h-9 w-9 items-center justify-center rounded-full sm:h-10 sm:w-10', PILL[t.tone])}>
              {t.busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Icon className="h-5 w-5" />}
            </span>
            <span className="w-full min-w-0">
              <span className={cn('block truncate text-lg font-black leading-tight tabular-nums sm:text-xl', VALUE[t.tone])}>{t.value}</span>
              <span className="block truncate text-[11px] font-bold text-muted sm:text-xs">{t.label}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------ Icônes d'un écran (liste) ------------------------------ */

const lightOf = (lights: Light[], key: string) => lights.find(l => l.key === key);

/** Rangée d'icônes d'état d'un écran : réseau, lecture, mur, appareil. Gris = pas de mesure. */
export function ScreenStrip({ s, online }: { s: AppScreen; online: boolean }) {
  const h = online ? healthOf(s) : null;
  const lights = h ? healthLights(h) : [];
  const netTone: Tone = h ? worstTone([networkLight(h), stabilityLight(h)]) : 'off';
  const play = lightOf(lights, 'play');
  const sync = lightOf(lights, 'sync');
  const device = worstTone(lights.filter(l => ['disk', 'ram', 'heat'].includes(l.key)));
  const items: { icon: LucideIcon; tone: Tone; title: string }[] = [
    { icon: h?.net === 'eth' ? Cable : Wifi, tone: netTone, title: h ? `${networkLight(h).value} · ${stabilityLight(h).value}` : 'Réseau : pas de mesure' },
    { icon: Play, tone: play?.tone ?? 'off', title: play ? `Lecture : ${play.value}` : 'Lecture : pas de mesure' },
    { icon: LayoutGrid, tone: sync?.tone ?? 'off', title: sync ? `Mur : ${sync.value}` : 'Écran seul' },
    { icon: HardDrive, tone: lights.length ? device : 'off', title: lights.length ? 'Stockage, mémoire, température' : 'Appareil : pas de mesure' },
  ];
  return (
    <span className="flex flex-shrink-0 items-center gap-1.5">
      {items.map((it, i) => {
        const Icon = it.icon;
        return <Icon key={i} className={cn('h-4 w-4', ICON_ONLY[it.tone])} aria-label={it.title} />;
      })}
    </span>
  );
}

/* ------------------------------ Voyants d'un écran (fiche) ------------------------------ */

const LIGHT_ICON: Record<string, LucideIcon> = {
  net: Wifi,
  stab: Activity,
  lat: Gauge,
  play: Play,
  sync: LayoutGrid,
  disk: HardDrive,
  ram: MemoryStick,
  heat: Thermometer,
  up: Clock,
  res: Monitor,
  owner: ShieldCheck,
  home: House,
};

/** Voyants en tuiles : icône colorée en haut, donnée en dessous. */
export function HealthTiles({ lights, dim, header }: { lights: Light[]; dim?: boolean; header?: ReactNode }) {
  return (
    <div className="space-y-2">
      {header}
      <div className={cn('grid grid-cols-2 gap-2 sm:grid-cols-3', dim && 'opacity-50')}>
        {lights.map(l => {
          const Icon = l.key === 'net' && l.label === 'Connexion' && l.value === 'Câble' ? Cable : (LIGHT_ICON[l.key] ?? Activity);
          const tone: Tone = ['up', 'res'].includes(l.key) && l.tone === 'ok' ? 'off' : l.tone;
          return (
            <div key={l.key} className={cn('flex flex-col gap-2 rounded-[20px] border bg-white p-3', RING[l.tone])}>
              <span className={cn('flex h-9 w-9 items-center justify-center rounded-full', PILL[tone === 'off' && l.tone === 'ok' ? 'off' : tone])}>
                <Icon className="h-[18px] w-[18px]" />
              </span>
              <span className="min-w-0">
                <span className="block text-[11px] font-bold uppercase tracking-wide text-muted">{l.label}</span>
                <span className={cn('block text-sm font-bold leading-snug', VALUE[l.tone === 'off' ? 'off' : l.tone])}>{l.value}</span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
