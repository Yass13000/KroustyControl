import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Activity,
  AlertOctagon,
  Eraser,
  Power,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  ClipboardCopy,
  Copy,
  ExternalLink,
  Info,
  Loader2,
  RefreshCw,
  Undo2,
  Wrench,
  XCircle,
} from 'lucide-react';
import { sbClient } from '../lib/supabase';
import { errorMessage, must, sendScreenCommand, useAccounts, useLibrary, useNow, useScreenEvents, useVideoAnalyses } from '../lib/data';
import { FORMATS, isOnline, parseFormat, parsePlaylist, timeAgo, transformStorageUrl } from '../lib/media';
import {
  SEVERITY_ORDER,
  availability,
  commandLabel,
  diagnose,
  formatSpan,
  formatDuration,
  hhmm,
  isOpenAt,
  probeMedia,
  shortUrl,
  type Issue,
  type MediaStatus,
  type Severity,
} from '../lib/diagnostics';
import type { AppScreen, Configuration, Group, ScreenCommand, ScreenEvent } from '../lib/types';
import { Button, EmptyState, IconButton, Modal, PageTitle, Segmented, StatusDot, cn, useFeedback } from './ui';

interface MaintenanceProps {
  groups: Group[];
  configurations: Configuration[];
  screens: AppScreen[];
  onChanged: () => void;
}

const UNASSIGNED = { configuration_id: null, total_cols: 1, total_rows: 1, pos_x: 0, pos_y: 0, video_url: '', audio_url: '' };

const SEVERITY_UI: Record<Severity, { icon: ReactNode; tone: string; label: string }> = {
  critical: { icon: <AlertOctagon className="h-5 w-5" />, tone: 'bg-red-50 text-red-600', label: 'Critiques' },
  warning: { icon: <AlertTriangle className="h-5 w-5" />, tone: 'bg-amber-50 text-amber-600', label: 'À surveiller' },
  info: { icon: <Info className="h-5 w-5" />, tone: 'bg-sky-50 text-sky-600', label: 'Infos' },
};

interface LogEvent {
  at: number;
  screenId: string;
  kind: 'ping' | 'online' | 'offline' | 'content';
}

export default function Maintenance({ groups, configurations, screens, onChanged }: MaintenanceProps) {
  const { toast, confirm } = useFeedback();
  const library = useLibrary();
  const journal = useScreenEvents();
  const playlistUrls = useMemo(() => Array.from(new Set(screens.flatMap(s => parsePlaylist(s.video_url)))), [screens]);
  const analyses = useVideoAnalyses(playlistUrls);
  const [journalFilter, setJournalFilter] = useState<'all' | 'outage' | 'error' | 'command' | 'content'>('all');
  const accounts = useAccounts(true);
  const now = useNow(5000);

  const [media, setMedia] = useState<Record<string, MediaStatus>>({});
  const [testing, setTesting] = useState(false);
  const [filter, setFilter] = useState<'all' | Severity>('all');
  const [openScreenId, setOpenScreenId] = useState<string | null>(null);
  const [fixing, setFixing] = useState<string | null>(null);
  const [log, setLog] = useState<LogEvent[]>([]);

  const configById = useMemo(() => new Map(configurations.map(c => [c.id, c])), [configurations]);
  const groupById = useMemo(() => new Map(groups.map(g => [g.id, g])), [groups]);
  const placeOf = (s: AppScreen) => {
    const c = s.configuration_id ? configById.get(s.configuration_id) : undefined;
    const g = c ? groupById.get(c.group_id) : undefined;
    return { config: c, group: g };
  };

  /* ------------------------------ Test des vidéos ------------------------------ */

  const allUrls = useMemo(
    () => Array.from(new Set(screens.flatMap(s => parsePlaylist(s.video_url)).map(transformStorageUrl))).filter(Boolean),
    [screens],
  );

  const testUrls = useCallback(async (urls: string[]) => {
    if (urls.length === 0) return;
    setTesting(true);
    setMedia(prev => ({ ...prev, ...Object.fromEntries(urls.map(u => [u, { state: 'pending' } as MediaStatus])) }));
    const queue = [...urls];
    const worker = async () => {
      while (queue.length) {
        const url = queue.shift()!;
        const result = await probeMedia(url);
        setMedia(prev => ({ ...prev, [url]: result }));
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    setTesting(false);
  }, []);

  // Test automatique des vidéos encore jamais testées.
  const testedOnce = useRef(new Set<string>());
  useEffect(() => {
    const fresh = allUrls.filter(u => !testedOnce.current.has(u));
    if (fresh.length === 0) return;
    fresh.forEach(u => testedOnce.current.add(u));
    testUrls(fresh);
  }, [allUrls, testUrls]);

  /* ------------------------------ Diagnostic ------------------------------ */

  // Planificateur des playlists (pg_cron) : vérifie qu'il tourne s'il y a des créneaux actifs.
  const [scheduler, setScheduler] = useState<{ slots: number; lastRun: string | null } | null>(null);
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      const [slots, status] = await Promise.all([
        sbClient.from('playlist_schedules').select('id', { count: 'exact', head: true }).eq('enabled', true),
        sbClient.from('scheduler_status').select('last_run').eq('id', 'playlists').maybeSingle(),
      ]);
      if (cancelled || slots.error) return; // migration non passée : rien à surveiller
      setScheduler({ slots: slots.count || 0, lastRun: (status.data as { last_run: string } | null)?.last_run ?? null });
    };
    check();
    const id = setInterval(check, 60000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const issues = useMemo(() => {
    const list = diagnose({ screens, configurations, groups, videos: library.videos, media, now, events: journal.events, analyses: analyses.results });
    if (scheduler && scheduler.slots > 0 && (!scheduler.lastRun || now - new Date(scheduler.lastRun).getTime() > 5 * 60 * 1000)) {
      list.unshift({
        id: 'scheduler_down',
        kind: 'scheduler_down',
        severity: 'critical',
        title: 'Programmation à l’arrêt',
        detail: `${scheduler.slots} créneau${scheduler.slots > 1 ? 'x' : ''} · dernière exécution ${timeAgo(scheduler.lastRun, now)} · vérifier pg_cron`,
      });
    }
    return list;
  }, [screens, configurations, groups, library.videos, media, now, journal.events, analyses.results, scheduler]);
  const counts = {
    critical: issues.filter(i => i.severity === 'critical').length,
    warning: issues.filter(i => i.severity === 'warning').length,
    info: issues.filter(i => i.severity === 'info').length,
  };
  const visibleIssues = filter === 'all' ? issues : issues.filter(i => i.severity === filter);
  const onlineCount = screens.filter(s => isOnline(s.last_ping, now)).length;
  const mediaValues = allUrls.map(u => media[u]).filter(Boolean);
  const mediaOk = mediaValues.filter(m => m.state === 'ok').length;
  const issuesOf = (screenId: string) => issues.filter(i => i.screenId === screenId);
  const worstOf = (screenId: string): Severity | null => {
    const list = issuesOf(screenId);
    if (list.length === 0) return null;
    return list.reduce((w, i) => (SEVERITY_ORDER[i.severity] < SEVERITY_ORDER[w] ? i.severity : w), 'info' as Severity);
  };

  /* ------------------------------ Activité en direct ------------------------------ */

  const prev = useRef<Map<string, { ping: string | null; online: boolean; video: string | null }>>(new Map());
  useEffect(() => {
    const events: LogEvent[] = [];
    const t = Date.now();
    for (const s of screens) {
      const p = prev.current.get(s.id);
      const on = isOnline(s.last_ping, now);
      if (p) {
        if (p.online !== on) events.push({ at: t, screenId: s.id, kind: on ? 'online' : 'offline' });
        else if (p.ping !== s.last_ping && on) events.push({ at: t, screenId: s.id, kind: 'ping' });
        if (p.video !== s.video_url) events.push({ at: t, screenId: s.id, kind: 'content' });
      }
      prev.current.set(s.id, { ping: s.last_ping, online: on, video: s.video_url });
    }
    if (events.length) setLog(l => [...events, ...l].slice(0, 40));
  }, [screens, now]);

  /* ------------------------------ Corrections ------------------------------ */

  /** Plus petit format standard qui contient tous les écrans d'une configuration. */
  const neededFormat = (configId: string) => {
    const inConfig = screens.filter(s => s.configuration_id === configId);
    const rows = Math.max(1, ...inConfig.map(s => s.pos_y + 1));
    const cols = Math.max(1, ...inConfig.map(s => s.pos_x + 1));
    return FORMATS.find(f => {
      const p = parseFormat(f.value);
      return p.rows >= rows && p.cols >= cols;
    })?.value;
  };

  const fixesFor = (issue: Issue): { label: string; run: () => Promise<unknown>; danger?: boolean; message?: string }[] => {
    const s = screens.find(x => x.id === issue.screenId);
    const config = issue.configId ? configById.get(issue.configId) : undefined;
    const update = (patch: Record<string, unknown>) => async () => must(await sbClient.from('screens_config').update(patch).eq('id', issue.screenId!));
    switch (issue.kind) {
      case 'out_of_grid': {
        const list: { label: string; run: () => Promise<unknown>; danger?: boolean }[] = [];
        const fmt = config && neededFormat(config.id);
        if (config && fmt && fmt !== config.format) {
          const { rows, cols } = parseFormat(fmt);
          list.push({
            label: `Passer en ${fmt}`,
            run: async () => {
              must(await sbClient.from('configurations').update({ format: fmt }).eq('id', config.id));
              must(await sbClient.from('screens_config').update({ total_cols: cols, total_rows: rows }).eq('configuration_id', config.id));
            },
          });
        }
        list.push({ label: 'Remettre en attente', run: update(UNASSIGNED), danger: true });
        return list;
      }
      case 'format_mismatch': {
        if (!config) return [];
        const { rows, cols } = parseFormat(config.format);
        return [{ label: 'Synchroniser', run: update({ total_cols: cols, total_rows: rows }) }];
      }
      case 'group_mismatch':
        return config ? [{ label: 'Réaligner', run: update({ group_id: config.group_id }) }] : [];
      case 'audio_on_slave':
        return [{ label: 'Couper', run: update({ audio_url: '' }) }];
      case 'schedule_mismatch': {
        const g = issue.groupId ? groupById.get(issue.groupId) : undefined;
        if (!g) return [];
        const configIds = configurations.filter(c => c.group_id === g.id).map(c => c.id);
        return [
          {
            label: `Appliquer ${hhmm(g.open_time)}–${hhmm(g.close_time)}`,
            danger: true,
            message: 'Avec le lecteur 1.2, les écrans s’éteindront en dehors de ces horaires.',
            run: async () =>
              must(
                await sbClient
                  .from('screens_config')
                  .update({ opening_time: hhmm(g.open_time), closing_time: hhmm(g.close_time) })
                  .in('configuration_id', configIds),
              ),
          },
        ];
      }
      case 'player_error':
        return s ? [{ label: 'Effacer', run: update({ last_error: '', last_error_at: null }) }] : [];
      default:
        return [];
    }
  };

  const runFix = async (key: string, fix: { label: string; run: () => Promise<unknown>; danger?: boolean; message?: string }, title: string) => {
    if (fix.danger) {
      const ok = await confirm({ title: `${fix.label} ?`, message: fix.message || title, confirmLabel: fix.label, danger: true });
      if (!ok) return;
    }
    setFixing(key);
    try {
      await fix.run();
      toast('Corrigé');
      onChanged();
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setFixing(null);
    }
  };

  /* ------------------------------ Commandes à distance ------------------------------ */

  const sendCommand = async (s: AppScreen, command: ScreenCommand) => {
    const ok = await confirm({
      title: `${commandLabel(command)} ?`,
      message: `${s.id} · exécuté sous 30 s si l’écran est en ligne (1 min en veille)`,
      confirmLabel: 'Envoyer',
      danger: command === 'clear_cache',
    });
    if (!ok) return;
    try {
      await sendScreenCommand([s.id], command);
      toast('Commande envoyée');
      onChanged();
    } catch (err) {
      const msg = errorMessage(err);
      toast(msg.includes('command') ? 'Migration 20261110_maintenance.sql manquante' : msg, 'error');
    }
  };

  /* ------------------------------ Rapports ------------------------------ */

  const stamp = () => new Date().toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });

  const screenReport = (s: AppScreen) => {
    const { config, group } = placeOf(s);
    const lines = [
      `Écran ${s.id}`,
      `${isOnline(s.last_ping, now) ? 'En ligne' : 'Hors ligne'} · dernier signal ${timeAgo(s.last_ping, now)}${s.last_ping ? ` (${new Date(s.last_ping).toLocaleString('fr-FR')})` : ''}`,
      group ? `${group.name} · ${config?.name} · ${config?.format} · position ${s.pos_x + 1},${s.pos_y + 1}` : 'Non assigné',
      group ? `Horaires ${hhmm(group.open_time)}–${hhmm(group.close_time)} (${isOpenAt(group) ? 'ouvert' : 'fermé'})` : '',
      `Lecteur ${s.player_version || `v${s.latest_version_code ?? '?'}`}${s.device_model ? ` · ${s.device_model}` : ''}${s.last_error ? ` · erreur : ${s.last_error}` : ''}`,
      journal.available ? `Disponibilité 7 j : ${availability(s, journal.events, now).percent.toFixed(1)} % (${availability(s, journal.events, now).outages} coupure(s))` : '',
      ...parsePlaylist(s.video_url).map((u, i) => {
        const st = media[transformStorageUrl(u)];
        const name = library.videos.find(v => v.url === u)?.name || shortUrl(u);
        return `  ${i + 1}. ${name} — ${st?.state === 'ok' ? 'OK' : st?.state === 'pending' ? 'test…' : st?.state === 'timeout' ? 'LENTE' : st ? 'INACCESSIBLE' : 'non testée'}`;
      }),
      ...issuesOf(s.id).map(i => `⚠ ${i.title} — ${i.detail}`),
    ];
    return lines.filter(Boolean).join('\n');
  };

  const globalReport = () =>
    [
      `KroustyControl · rapport du ${stamp()}`,
      `${onlineCount}/${screens.length} écrans en ligne · vidéos OK ${mediaOk}/${allUrls.length}`,
      `${counts.critical} critique(s) · ${counts.warning} à surveiller · ${counts.info} info(s)`,
      '',
      ...issues.map(i => `[${i.severity === 'critical' ? 'CRITIQUE' : i.severity === 'warning' ? 'ATTENTION' : 'INFO'}] ${i.screenId ? `${i.screenId} · ` : ''}${i.title} — ${i.detail}`),
    ].join('\n');

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast('Rapport copié');
    } catch {
      toast('Copie impossible', 'error');
    }
  };

  /* ------------------------------ Rendu ------------------------------ */

  const healthy = counts.critical === 0 && counts.warning === 0;
  const openScreen = screens.find(s => s.id === openScreenId) || null;
  const sortedScreens = [...screens].sort((a, b) => {
    const wa = worstOf(a.id);
    const wb = worstOf(b.id);
    const ra = wa ? SEVERITY_ORDER[wa] : 3;
    const rb = wb ? SEVERITY_ORDER[wb] : 3;
    return ra - rb || a.id.localeCompare(b.id, 'fr');
  });

  return (
    <div className="space-y-5">
      <PageTitle
        title="Maintenance"
        actions={
          <div className="flex gap-2">
            <IconButton label="Retester les vidéos" variant="secondary" disabled={testing} onClick={() => testUrls(allUrls)}>
              <RefreshCw className={cn('h-5 w-5', testing && 'animate-spin')} />
            </IconButton>
            <IconButton label="Copier le rapport" variant="secondary" onClick={() => copy(globalReport())}>
              <ClipboardCopy className="h-5 w-5" />
            </IconButton>
          </div>
        }
      />

      {/* --- État global --- */}
      <section className={cn('card overflow-hidden p-5', healthy ? 'border-emerald-200' : counts.critical ? 'border-red-200' : 'border-amber-200')}>
        <div className="flex items-center gap-3">
          <span
            className={cn(
              'flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl',
              healthy ? 'bg-emerald-50 text-emerald-600' : counts.critical ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-600',
            )}
          >
            {healthy ? <CheckCircle2 className="h-7 w-7" /> : counts.critical ? <AlertOctagon className="h-7 w-7" /> : <AlertTriangle className="h-7 w-7" />}
          </span>
          <div className="min-w-0">
            <p className="text-xl font-extrabold text-ink">
              {healthy ? 'Tout fonctionne' : `${counts.critical + counts.warning} problème${counts.critical + counts.warning > 1 ? 's' : ''}`}
            </p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="En ligne" value={`${onlineCount}`} sub={`/${screens.length}`} dot="online" />
          <Stat label="Hors ligne" value={`${screens.length - onlineCount}`} dot="offline" />
          <Stat label="Critiques" value={`${counts.critical}`} tone={counts.critical ? 'text-red-600' : undefined} />
          <Stat
            label="Vidéos OK"
            value={`${mediaOk}`}
            sub={`/${allUrls.length}`}
            extra={testing ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted" /> : undefined}
          />
        </div>
      </section>

      {/* --- Problèmes --- */}
      <section className="space-y-3">
        <div className="no-scrollbar -mx-1 overflow-x-auto px-1">
          <Segmented
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: `Tout ${issues.length}` },
              { value: 'critical', label: `${SEVERITY_UI.critical.label} ${counts.critical}` },
              { value: 'warning', label: `${SEVERITY_UI.warning.label} ${counts.warning}` },
              { value: 'info', label: `${SEVERITY_UI.info.label} ${counts.info}` },
            ]}
          />
        </div>

        {visibleIssues.length === 0 ? (
          <EmptyState icon={<CheckCircle2 className="h-6 w-6" />} title="Rien à signaler" />
        ) : (
          <ul className="card divide-y divide-sand overflow-hidden">
            {visibleIssues.map(issue => {
              const ui = SEVERITY_UI[issue.severity];
              const fixes = issue.fixable ? fixesFor(issue) : [];
              return (
                <li key={issue.id} className="flex items-start gap-3 p-3.5">
                  <span className={cn('mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl', ui.tone)}>{ui.icon}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] font-bold text-ink">
                      {issue.screenId && <span className="mr-1.5 rounded-md bg-sand px-1.5 py-0.5 text-xs font-extrabold text-ink">{issue.screenId}</span>}
                      {issue.title}
                    </p>
                    <p className="mt-0.5 break-words text-sm text-muted">{issue.detail}</p>
                    {fixes.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {fixes.map(f => (
                          <Button
                            key={f.label}
                            size="sm"
                            variant={f.danger ? 'dangerSoft' : 'soft'}
                            icon={<Wrench className="h-3.5 w-3.5" />}
                            loading={fixing === `${issue.id}:${f.label}`}
                            onClick={() => runFix(`${issue.id}:${f.label}`, f, `${issue.screenId ?? ''} ${issue.title}`.trim())}
                          >
                            {f.label}
                          </Button>
                        ))}
                      </div>
                    )}
                  </div>
                  {issue.screenId && (
                    <IconButton label={`Diagnostic ${issue.screenId}`} size="sm" onClick={() => setOpenScreenId(issue.screenId!)}>
                      <ChevronRight className="h-5 w-5" />
                    </IconButton>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* --- Tous les écrans --- */}
      <section className="space-y-3">
        <h2 className="px-1 text-lg font-extrabold text-ink">Écrans</h2>
        <ul className="card divide-y divide-sand overflow-hidden">
          {sortedScreens.map(s => {
            const { config, group } = placeOf(s);
            const worst = worstOf(s.id);
            const n = issuesOf(s.id).length;
            return (
              <li key={s.id}>
                <button type="button" onClick={() => setOpenScreenId(s.id)} className="flex w-full items-center gap-3 p-3.5 text-left transition hover:bg-cream/70">
                  <StatusDot online={isOnline(s.last_ping, now)} sleeping={s.power_state === 'sleep'} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-bold text-ink">{s.id}</span>
                    <span className="block truncate text-xs text-muted">{group ? `${group.name} · ${config?.name}` : 'En attente'}</span>
                  </span>
                  <span className="hidden text-xs tabular-nums text-muted sm:block">{timeAgo(s.last_ping, now)}</span>
                  {worst && (
                    <span className={cn('inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-xs font-black', SEVERITY_UI[worst].tone)}>{n}</span>
                  )}
                  <ChevronRight className="h-4.5 w-4.5 flex-shrink-0 text-muted" />
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {/* --- Historique (journal en base) ou activité de la session --- */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 px-1 text-lg font-extrabold text-ink">
          <Activity className="h-5 w-5 text-brand" />
          Historique
        </h2>
        {journal.available ? (
          <>
            <div className="no-scrollbar -mx-1 overflow-x-auto px-1">
              <Segmented
                size="sm"
                value={journalFilter}
                onChange={setJournalFilter}
                options={[
                  { value: 'all', label: 'Tout' },
                  { value: 'outage', label: 'Coupures' },
                  { value: 'error', label: 'Erreurs' },
                  { value: 'command', label: 'Commandes' },
                  { value: 'content', label: 'Contenu' },
                ]}
              />
            </div>
            <EventList
              events={journal.events.filter(e => journalFilter === 'all' || e.kind === journalFilter || (journalFilter === 'content' && e.kind === 'assign')).slice(0, 80)}
              onOpen={setOpenScreenId}
            />
          </>
        ) : log.length === 0 ? (
          <p className="card px-4 py-5 text-center text-sm text-muted">En attente du prochain signal…</p>
        ) : (
          <ul className="card max-h-72 divide-y divide-sand overflow-y-auto">
            {log.map((e, i) => (
              <li key={`${e.at}-${e.screenId}-${i}`} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span className="w-12 flex-shrink-0 tabular-nums text-muted">{new Date(e.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
                <span className={cn('h-2 w-2 flex-shrink-0 rounded-full', e.kind === 'offline' ? 'bg-red-500' : e.kind === 'content' ? 'bg-brand' : 'bg-online')} />
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-bold text-ink">{e.screenId}</span>{' '}
                  <span className="text-muted">
                    {e.kind === 'ping' ? 'signal' : e.kind === 'online' ? 'reconnecté' : e.kind === 'offline' ? 'perdu' : 'contenu modifié'}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* --- Fiche diagnostic d'un écran --- */}
      <Modal
        open={!!openScreen}
        onClose={() => setOpenScreenId(null)}
        size="lg"
        title={openScreen?.id}
        subtitle={openScreen ? (placeOf(openScreen).group ? `${placeOf(openScreen).group!.name} · ${placeOf(openScreen).config?.name}` : 'En attente') : undefined}
        leading={openScreen ? <StatusDot online={isOnline(openScreen.last_ping, now)} sleeping={openScreen.power_state === 'sleep'} className="ml-1" /> : undefined}
        footer={
          openScreen && (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" icon={<ClipboardCopy className="h-4 w-4" />} onClick={() => copy(screenReport(openScreen))}>
                Rapport
              </Button>
              <Button
                variant="secondary"
                size="sm"
                icon={<RefreshCw className="h-4 w-4" />}
                onClick={() => testUrls(parsePlaylist(openScreen.video_url).map(transformStorageUrl))}
              >
                Tester
              </Button>
              {openScreen.configuration_id && (
                <Button
                  variant="dangerSoft"
                  size="sm"
                  icon={<Undo2 className="h-4 w-4" />}
                  className="ml-auto"
                  onClick={() =>
                    runFix(
                      `sheet:${openScreen.id}`,
                      { label: 'Remettre en attente', danger: true, run: async () => must(await sbClient.from('screens_config').update(UNASSIGNED).eq('id', openScreen.id)) },
                      openScreen.id,
                    )
                  }
                >
                  En attente
                </Button>
              )}
            </div>
          )
        }
      >
        {openScreen && renderScreenSheet(openScreen)}
      </Modal>
    </div>
  );

  function renderScreenSheet(s: AppScreen) {
    const { config, group } = placeOf(s);
    const on = isOnline(s.last_ping, now);
    const playlist = parsePlaylist(s.video_url);
    const owner = s.user_id ? accounts.find(a => a.id === s.user_id)?.email || 'Compte inconnu' : '—';
    const list = issuesOf(s.id);
    const avail = availability(s, journal.events, now);
    const pending = !!s.command_id && s.command_id !== s.command_ack;
    const screenEvents = journal.events.filter(e => e.screen_id === s.id).slice(0, 12);

    return (
      <div className="space-y-5">
        {list.length > 0 && (
          <ul className="space-y-2">
            {list.map(i => (
              <li key={i.id} className={cn('flex items-start gap-2.5 rounded-2xl p-3', SEVERITY_UI[i.severity].tone)}>
                {SEVERITY_UI[i.severity].icon}
                <div className="min-w-0">
                  <p className="text-sm font-bold">{i.title}</p>
                  <p className="break-words text-xs opacity-80">{i.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        )}

        <dl className="divide-y divide-sand rounded-2xl border border-sand">
          <Row label="État" value={!on ? 'Hors ligne' : s.power_state === 'sleep' ? 'En veille' : 'En ligne'} />
          <Row label="Dernier signal" value={s.last_ping ? `${timeAgo(s.last_ping, now)} · ${new Date(s.last_ping).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'medium' })}` : 'jamais'} />
          {config && <Row label="Position" value={`${s.pos_x + 1},${s.pos_y + 1} sur ${config.format}`} />}
          {group && <Row label="Horaires" value={`${hhmm(group.open_time)} – ${hhmm(group.close_time)} · ${isOpenAt(group) ? 'ouvert' : 'fermé'}`} />}
          <Row label="Plage écran" value={`${hhmm(s.opening_time)} – ${hhmm(s.closing_time)}`} />
          {journal.available && (
            <Row
              label="Disponibilité 7 j"
              value={`${avail.percent.toFixed(1)} %${avail.outages ? ` · ${avail.outages} coupure${avail.outages > 1 ? 's' : ''} · ${formatSpan(avail.downMs)}` : ''}`}
              danger={avail.percent < 95}
            />
          )}
          <Row label="Lecteur" value={`${s.player_version || `v${s.latest_version_code ?? '?'}`}${s.rotation ? ` · rotation ${s.rotation}°` : ''}`} />
          {s.device_model && <Row label="Appareil" value={s.device_model} />}
          {s.booted_at && <Row label="Démarré" value={timeAgo(s.booted_at, now)} />}
          <Row label="Compte" value={owner} />
          <Row label="Musique" value={s.audio_url ? shortUrl(s.audio_url) : '—'} />
          {s.last_error && <Row label="Erreur" value={`${s.last_error}${s.last_error_at ? ` · ${timeAgo(s.last_error_at, now)}` : ''}`} danger />}
        </dl>

        <div className="space-y-2">
          <p className="px-1 text-sm font-bold text-ink">Vidéos</p>
          {playlist.length === 0 ? (
            <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">Aucune vidéo · écran noir</p>
          ) : (
            <ol className="divide-y divide-sand rounded-2xl border border-sand">
              {playlist.map((url, i) => {
                const direct = transformStorageUrl(url);
                const st = media[direct];
                const name = library.videos.find(v => v.url === url)?.name;
                return (
                  <li key={`${url}-${i}`} className="flex items-center gap-3 px-3 py-2.5">
                    <span className="w-5 text-center text-xs font-black text-muted">{i + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold text-ink">{name || shortUrl(url)}</span>
                      <span className="block text-xs text-muted">
                        {!st ? 'Non testée' : st.state === 'pending' ? 'Test…' : st.state === 'ok' ? `${formatDuration(st.duration)} · ${st.width}×${st.height}` : st.state === 'timeout' ? 'Chargement lent' : 'Inaccessible'}
                        {!name && ' · lien externe'}
                      </span>
                    </span>
                    {!st || st.state === 'pending' ? (
                      <Loader2 className={cn('h-4.5 w-4.5 text-muted', st && 'animate-spin')} />
                    ) : st.state === 'ok' ? (
                      <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                    ) : (
                      <XCircle className="h-5 w-5 text-red-600" />
                    )}
                    <a href={direct} target="_blank" rel="noreferrer" className="flex h-8 w-8 items-center justify-center rounded-xl text-muted hover:bg-sand" aria-label="Ouvrir la vidéo" title="Ouvrir">
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </li>
                );
              })}
            </ol>
          )}
        </div>

        {/* Commandes à distance */}
        <div className="space-y-2">
          <p className="px-1 text-sm font-bold text-ink">Commandes</p>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" icon={<Power className="h-4 w-4" />} disabled={pending} onClick={() => sendCommand(s, 'reload')}>
              Redémarrer
            </Button>
            <Button variant="secondary" icon={<Eraser className="h-4 w-4" />} disabled={pending} onClick={() => sendCommand(s, 'clear_cache')}>
              Vider le cache
            </Button>
          </div>
          {pending && (
            <p className="flex items-center gap-2 rounded-2xl bg-amber-50 px-3 py-2.5 text-sm font-semibold text-amber-700">
              <Loader2 className="h-4 w-4 animate-spin" />
              {commandLabel(s.command)} · en attente{s.command_at ? ` depuis ${timeAgo(s.command_at, now).replace('il y a ', '')}` : ''}
            </p>
          )}
          {!pending && s.command_ack_at && (
            <p className="px-1 text-xs text-muted">
              Dernière : {commandLabel(s.command)} · exécutée {timeAgo(s.command_ack_at, now)}
            </p>
          )}
        </div>

        {screenEvents.length > 0 && (
          <div className="space-y-2">
            <p className="px-1 text-sm font-bold text-ink">Historique</p>
            <EventList events={screenEvents} compact />
          </div>
        )}

        <button
          type="button"
          onClick={() => copy(s.id)}
          className="inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-semibold text-muted hover:bg-sand"
        >
          <Copy className="h-3.5 w-3.5" /> Copier l’identifiant
        </button>
      </div>
    );
  }
}

function Stat({ label, value, sub, dot, tone, extra }: { label: string; value: string; sub?: string; dot?: 'online' | 'offline'; tone?: string; extra?: ReactNode }) {
  return (
    <div className="rounded-2xl bg-cream/70 px-3.5 py-3">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-muted">
        {dot && <StatusDot online={dot === 'online'} className="h-2 w-2" />}
        {label}
        {extra}
      </p>
      <p className={cn('mt-0.5 text-2xl font-extrabold tabular-nums text-ink', tone)}>
        {value}
        {sub && <span className="text-base font-bold text-muted">{sub}</span>}
      </p>
    </div>
  );
}

function Row({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 px-3.5 py-2.5 text-sm">
      <dt className="flex-shrink-0 text-muted">{label}</dt>
      <dd className={cn('min-w-0 break-words text-right font-semibold', danger ? 'text-red-600' : 'text-ink')}>{value}</dd>
    </div>
  );
}

const EVENT_UI: Record<ScreenEvent['kind'], { dot: string; label: string }> = {
  outage: { dot: 'bg-red-500', label: 'Coupure' },
  boot: { dot: 'bg-sky-500', label: 'Démarrage' },
  error: { dot: 'bg-amber-500', label: 'Erreur' },
  command: { dot: 'bg-violet-500', label: 'Commande' },
  content: { dot: 'bg-brand', label: 'Contenu' },
  assign: { dot: 'bg-muted', label: 'Assignation' },
  power: { dot: 'bg-indigo-400', label: 'Veille' },
};

function EventList({ events, onOpen, compact }: { events: ScreenEvent[]; onOpen?: (id: string) => void; compact?: boolean }) {
  if (events.length === 0) return <p className="card px-4 py-5 text-center text-sm text-muted">Aucun événement</p>;
  return (
    <ul className={cn('divide-y divide-sand overflow-y-auto', compact ? 'rounded-2xl border border-sand' : 'card max-h-96')}>
      {events.map(e => {
        const ui = EVENT_UI[e.kind];
        const text =
          e.kind === 'outage' && e.started_at
            ? `${formatSpan(new Date(e.created_at).getTime() - new Date(e.started_at).getTime())} sans signal`
            : e.message || ui.label;
        const when = new Date(e.created_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
        return (
          <li key={e.id}>
            <button
              type="button"
              disabled={!onOpen}
              onClick={() => onOpen?.(e.screen_id)}
              className="flex w-full items-start gap-3 px-4 py-2.5 text-left text-sm transition enabled:hover:bg-cream/70"
            >
              <span className="w-[72px] flex-shrink-0 pt-px text-xs tabular-nums text-muted">{when}</span>
              <span className={cn('mt-1.5 h-2 w-2 flex-shrink-0 rounded-full', ui.dot)} />
              <span className="min-w-0 flex-1">
                {!compact && <span className="font-bold text-ink">{e.screen_id} </span>}
                <span className={cn(compact ? 'text-ink' : 'text-muted')}>{text}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
