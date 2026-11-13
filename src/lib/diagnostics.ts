// Moteur de diagnostic du parc : analyse les données et liste les problèmes, classés par gravité.
import { healthLights, healthOf, networkLight, stabilityLight } from './health';
import { isWebPlayer } from './playerRelease';
import { IMAGE_SECONDS, ONLINE_THRESHOLD_MS, isGoogleDrive, isImageUrl, isOnline, parseFormat, parsePlaylist, timeAgo, transformStorageUrl } from './media';
import type { AppScreen, Configuration, Group, ScreenEvent, VideoFile } from './types';
import { assess, wallTarget, type VideoAnalysis } from './videoAnalysis';

export type Severity = 'critical' | 'warning' | 'info';

export type IssueKind =
  | 'offline_open'
  | 'offline_closed'
  | 'never_seen'
  | 'out_of_grid'
  | 'duplicate_position'
  | 'format_mismatch'
  | 'group_mismatch'
  | 'no_video'
  | 'media_broken'
  | 'media_drive'
  | 'audio_on_slave'
  | 'player_error'
  | 'outdated_version'
  | 'empty_slots'
  | 'new_device'
  | 'stale_device'
  | 'empty_restaurant'
  | 'unstable'
  | 'command_pending'
  | 'heavy_media'
  | 'schedule_mismatch'
  | 'sleep_while_open'
  | 'awake_while_closed'
  | 'scheduler_down'
  | 'weak_network'
  | 'device_health'
  | 'wall_sync';

export interface Issue {
  id: string;
  kind: IssueKind;
  severity: Severity;
  title: string;
  detail: string;
  screenId?: string;
  configId?: string;
  groupId?: string;
  /** Correction automatique possible (voir Maintenance.tsx) */
  fixable?: boolean;
}

export type MediaStatus =
  | { state: 'pending' }
  | { state: 'ok'; duration: number; width: number; height: number }
  | { state: 'error' | 'timeout' };

export const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };

/* ------------------------------ Horaires ------------------------------ */

const toMinutes = (t: string | null | undefined) => {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  return Number.isFinite(h) ? h * 60 + (m || 0) : null;
};

/** Le restaurant est-il ouvert à cet instant ? Gère les fermetures après minuit (ex. 10:30 → 01:00). */
export const isOpenAt = (group: Group | undefined, date = new Date()) => {
  const open = toMinutes(group?.open_time);
  const close = toMinutes(group?.close_time);
  if (open === null || close === null) return true;
  const now = date.getHours() * 60 + date.getMinutes();
  return open <= close ? now >= open && now < close : now >= open || now < close;
};

export const hhmm = (t: string | null | undefined) => (t ? t.slice(0, 5) : '—');

/* ------------------------------ Analyse ------------------------------ */

interface Input {
  screens: AppScreen[];
  configurations: Configuration[];
  groups: Group[];
  videos: VideoFile[];
  media: Record<string, MediaStatus>;
  now: number;
  events?: ScreenEvent[];
  /** Analyses qualité des vidéos (en-tête MP4), indexées par URL */
  analyses?: Record<string, VideoAnalysis>;
}

export function diagnose({ screens, configurations, groups, videos, media, now, events = [], analyses = {} }: Input): Issue[] {
  const issues: Issue[] = [];
  const configById = new Map(configurations.map(c => [c.id, c]));
  const groupById = new Map(groups.map(g => [g.id, g]));
  const maxVersion = Math.max(0, ...screens.map(s => s.latest_version_code || 0));
  const date = new Date(now);
  const add = (i: Omit<Issue, 'id'>) => issues.push({ ...i, id: `${i.kind}:${i.screenId || i.configId || i.groupId}:${issues.length}` });

  for (const s of screens) {
    const config = s.configuration_id ? configById.get(s.configuration_id) : undefined;
    const group = config ? groupById.get(config.group_id) : undefined;
    const online = isOnline(s.last_ping, now);
    const where = group ? `${group.name}${config ? ` · ${config.name}` : ''}` : 'Non assigné';

    // --- Connexion ---
    if (!s.last_ping) {
      add({ kind: 'never_seen', severity: 'warning', screenId: s.id, title: 'Jamais connecté', detail: where });
    } else if (!online) {
      const since = now - new Date(s.last_ping).getTime();
      if (!config) {
        if (since > 7 * 24 * 3600 * 1000) {
          add({ kind: 'stale_device', severity: 'info', screenId: s.id, title: 'Appareil inactif', detail: `En attente, dernier signal ${timeAgo(s.last_ping, now)}` });
        }
      } else if (isOpenAt(group, date)) {
        add({
          kind: 'offline_open',
          severity: 'critical',
          screenId: s.id,
          title: 'Hors ligne pendant l’ouverture',
          detail: `${where} · ${timeAgo(s.last_ping, now)}`,
        });
      } else {
        add({
          kind: 'offline_closed',
          severity: since > ONLINE_THRESHOLD_MS * 120 ? 'warning' : 'info',
          screenId: s.id,
          title: 'Hors ligne · restaurant fermé',
          detail: `${where} · ${timeAgo(s.last_ping, now)}`,
        });
      }
    }

    if (!config) {
      if (s.configuration_id) {
        add({ kind: 'out_of_grid', severity: 'critical', screenId: s.id, title: 'Configuration introuvable', detail: 'L’écran pointe vers une configuration supprimée', fixable: true });
      } else if (online) {
        add({ kind: 'new_device', severity: 'info', screenId: s.id, title: 'Nouvel écran à assigner', detail: 'Connecté et en attente' });
      }
      continue;
    }

    // --- Placement dans la grille ---
    const { rows, cols } = parseFormat(config.format);
    if (s.pos_x >= cols || s.pos_y >= rows) {
      add({
        kind: 'out_of_grid',
        severity: 'critical',
        screenId: s.id,
        configId: config.id,
        title: 'Hors de la grille',
        detail: `${where} est en ${config.format}, l’écran est en position ${s.pos_x + 1},${s.pos_y + 1}`,
        fixable: true,
      });
    } else if (s.total_cols !== cols || s.total_rows !== rows) {
      add({
        kind: 'format_mismatch',
        severity: 'warning',
        screenId: s.id,
        configId: config.id,
        title: 'Format désynchronisé',
        detail: `L’écran se croit en ${s.total_rows}x${s.total_cols}, la configuration est en ${config.format}`,
        fixable: true,
      });
    }

    if (s.group_id && s.group_id !== config.group_id) {
      add({
        kind: 'group_mismatch',
        severity: 'warning',
        screenId: s.id,
        configId: config.id,
        title: 'Restaurant incohérent',
        detail: 'L’écran peut lire les horaires d’un autre restaurant',
        fixable: true,
      });
    }

    // --- Contenu ---
    const playlist = parsePlaylist(s.video_url);
    if (playlist.length === 0) {
      add({ kind: 'no_video', severity: 'critical', screenId: s.id, configId: config.id, title: 'Aucune vidéo', detail: `${where} · écran noir` });
    }
    for (const url of playlist) {
      const status = media[transformStorageUrl(url)];
      if (status && (status.state === 'error' || status.state === 'timeout')) {
        const name = videos.find(v => v.url === url)?.name || shortUrl(url);
        add({
          kind: 'media_broken',
          // Un simple délai dépassé peut venir du réseau du poste de contrôle : on ne crie pas au loup.
          severity: status.state === 'timeout' ? 'warning' : 'critical',
          screenId: s.id,
          configId: config.id,
          title: status.state === 'timeout' ? 'Chargement lent' : 'Vidéo inaccessible',
          detail: name,
        });
      }
      if (isGoogleDrive(url)) {
        add({ kind: 'media_drive', severity: 'info', screenId: s.id, title: 'Lien Google Drive', detail: 'Peu fiable pour les gros fichiers' });
      }
    }

    const isMaster = s.pos_x === 0 && s.pos_y === 0;
    if (!isMaster && s.audio_url) {
      add({ kind: 'audio_on_slave', severity: 'info', screenId: s.id, title: 'Musique sur un écran secondaire', detail: 'Seul l’écran principal doit jouer le son', fixable: true });
    }

    // --- Veille (lecteur 1.2+ : power_state renseigné) ---
    if (online && s.power_state) {
      const open = isOpenAt(group, date);
      if (s.power_state === 'sleep' && open) {
        add({ kind: 'sleep_while_open', severity: 'critical', screenId: s.id, title: 'En veille pendant l’ouverture', detail: `${where} · vérifier les horaires de l’écran` });
      } else if (s.power_state === 'on' && !open && hhmm(s.opening_time) === hhmm(group?.open_time) && hhmm(s.closing_time) === hhmm(group?.close_time)) {
        add({ kind: 'awake_while_closed', severity: 'info', screenId: s.id, title: 'Allumé hors horaires', detail: `${where} · mise en veille au prochain contrôle` });
      }
    }

    // --- Lecteur ---
    if (s.last_error && s.last_error.trim()) {
      add({
        kind: 'player_error',
        severity: 'warning',
        screenId: s.id,
        title: 'Erreur du lecteur',
        detail: `${s.last_error.trim().slice(0, 140)}${s.last_error_at ? ` · ${timeAgo(s.last_error_at, now)}` : ''}`,
        fixable: true,
      });
    }
    const outages24h = events.filter(e => e.screen_id === s.id && e.kind === 'outage' && now - new Date(e.created_at).getTime() < 24 * 3600 * 1000).length;
    if (outages24h >= 3) {
      add({ kind: 'unstable', severity: 'warning', screenId: s.id, title: 'Connexion instable', detail: `${outages24h} coupures en 24 h · ${where}` });
    }

    // --- Voyants envoyés par la TV (lecteur 1.8+), seulement si elle est en ligne ---
    const h = online ? healthOf(s) : null;
    if (h) {
      const net = networkLight(h);
      const stab = stabilityLight(h);
      if (net.tone !== 'ok' || stab.tone !== 'ok') {
        const bad = net.tone === 'bad' || stab.tone === 'bad';
        add({
          kind: 'weak_network',
          severity: bad ? 'critical' : 'warning',
          screenId: s.id,
          title: net.tone !== 'ok' ? (h.net === 'wifi' ? 'Wi-Fi faible' : 'Pas d’accès internet') : 'Connexion instable',
          detail: `${[net.tone !== 'ok' ? net.value : '', stab.tone !== 'ok' ? stab.value : ''].filter(Boolean).join(' · ')} · ${where}`,
        });
      }
      const device = healthLights(h).filter(l => ['disk', 'heat', 'play'].includes(l.key) && l.tone !== 'ok' && l.tone !== 'off');
      // Lecture en chargement / téléchargement : normal quelques minutes, on ne signale que l'erreur.
      const real = device.filter(l => l.key !== 'play' || h.play === 'error');
      if (real.length > 0) {
        add({
          kind: 'device_health',
          severity: real.some(l => l.tone === 'bad') ? 'critical' : 'warning',
          screenId: s.id,
          title: real.map(l => (l.key === 'disk' ? 'Stockage presque plein' : l.key === 'heat' ? 'TV trop chaude' : 'Erreur de lecture')).join(' · '),
          detail: `${real.map(l => `${l.label} : ${l.value}`).join(' · ')} · ${where}`,
        });
      }
      if (h.sync === 's' && h.play !== 'sleep' && (!h.cal || (h.drift ?? 0) > 300)) {
        add({
          kind: 'wall_sync',
          severity: 'warning',
          screenId: s.id,
          title: !h.cal ? 'Mur désynchronisé' : 'Mur décalé',
          detail: `${!h.cal ? 'Pas de contact avec l’écran maître (même réseau ?)' : `Écart ${h.drift} ms`} · ${where}`,
        });
      }
    }
    if (s.command_id && s.command_id !== s.command_ack && s.command_at && now - new Date(s.command_at).getTime() > 2 * 60 * 1000) {
      add({
        kind: 'command_pending',
        severity: 'warning',
        screenId: s.id,
        title: 'Commande non exécutée',
        detail: `${commandLabel(s.command)} · envoyée ${timeAgo(s.command_at, now)}${s.player_version ? '' : ' · lecteur à mettre à jour'}`,
      });
    }
    if (maxVersion > 0 && !isWebPlayer(s) && (s.latest_version_code || 0) < maxVersion) {
      add({ kind: 'outdated_version', severity: 'info', screenId: s.id, title: 'Lecteur pas à jour', detail: `v${s.latest_version_code || 0} · dernière v${maxVersion}` });
    }
  }

  // --- Doublons de position ---
  const seen = new Map<string, string>();
  for (const s of screens) {
    if (!s.configuration_id) continue;
    const key = `${s.configuration_id}:${s.pos_x}:${s.pos_y}`;
    const other = seen.get(key);
    if (other) {
      add({ kind: 'duplicate_position', severity: 'critical', screenId: s.id, configId: s.configuration_id, title: 'Deux écrans au même endroit', detail: `${other} et ${s.id}` });
    } else seen.set(key, s.id);
  }

  // --- Murs incomplets ---
  for (const c of configurations) {
    const { rows, cols } = parseFormat(c.format);
    const inside = screens.filter(s => s.configuration_id === c.id && s.pos_x < cols && s.pos_y < rows);
    const missing = rows * cols - new Set(inside.map(s => `${s.pos_x}:${s.pos_y}`)).size;
    if (missing > 0 && inside.length > 0) {
      const g = groupById.get(c.group_id);
      add({
        kind: 'empty_slots',
        severity: 'warning',
        configId: c.id,
        groupId: c.group_id,
        title: `Mur incomplet · ${missing} case${missing > 1 ? 's' : ''} vide${missing > 1 ? 's' : ''}`,
        detail: `${g?.name || ''} · ${c.name} (${c.format})`,
      });
    }
  }

  // --- Horaires : le lecteur (1.2+) applique ceux de l'écran ; ils doivent suivre ceux du restaurant ---
  for (const g of groups) {
    if (!g.open_time || !g.close_time) continue;
    const configIds = new Set(configurations.filter(c => c.group_id === g.id).map(c => c.id));
    const off = screens.filter(
      s => s.configuration_id && configIds.has(s.configuration_id) && (hhmm(s.opening_time) !== hhmm(g.open_time) || hhmm(s.closing_time) !== hhmm(g.close_time)),
    );
    if (off.length === 0) continue;
    add({
      kind: 'schedule_mismatch',
      severity: 'warning',
      groupId: g.id,
      title: 'Horaires non appliqués aux écrans',
      detail: `${g.name} · ${off.length} écran${off.length > 1 ? 's' : ''} en ${hhmm(off[0].opening_time)}–${hhmm(off[0].closing_time)} au lieu de ${hhmm(g.open_time)}–${hhmm(g.close_time)}`,
      fixable: true,
    });
  }

  // --- Vidéos trop lourdes pour le mur qui les diffuse (une alerte par mur et par vidéo) ---
  for (const c of configurations) {
    const inConfig = screens.filter(s => s.configuration_id === c.id);
    if (inConfig.length === 0) continue;
    const { rows, cols } = parseFormat(c.format);
    const target = wallTarget(cols, rows);
    const master = inConfig.find(s => s.pos_x === 0 && s.pos_y === 0) || inConfig[0];
    const urls = new Set(inConfig.flatMap(s => parsePlaylist(s.video_url)));
    for (const url of urls) {
      const a = analyses[url];
      if (!a?.ok) continue; // un lien illisible est déjà signalé par le test de lecture
      const verdict = assess(a, target);
      if (verdict.verdict === 'light') continue;
      const name = videos.find(v => v.url === url)?.name || shortUrl(url);
      const g = groupById.get(c.group_id);
      add({
        kind: 'heavy_media',
        severity: verdict.verdict === 'incompatible' ? 'critical' : 'warning',
        screenId: master.id,
        configId: c.id,
        title: verdict.verdict === 'incompatible' ? 'Vidéo incompatible' : 'Vidéo à optimiser',
        detail: `${name} · ${g?.name || ''} ${c.format} · ${verdict.reasons.join(' · ')}`,
      });
    }
  }

  // --- Restaurants sans écran ---
  for (const g of groups) {
    const configIds = new Set(configurations.filter(c => c.group_id === g.id).map(c => c.id));
    if (!screens.some(s => s.configuration_id && configIds.has(s.configuration_id))) {
      add({ kind: 'empty_restaurant', severity: 'info', groupId: g.id, title: 'Restaurant sans écran', detail: g.name });
    }
  }

  return issues.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

export const shortUrl = (url: string) => {
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, '')}/…${decodeURIComponent(u.pathname.split('/').pop() || '').slice(-28)}`;
  } catch {
    return url.slice(0, 40);
  }
};

/* ------------------------------ Test des vidéos ------------------------------ */

/** Charge uniquement les métadonnées d'une vidéo pour vérifier qu'elle est lisible. */
export const probeMedia = (url: string, timeoutMs = 25000): Promise<MediaStatus> =>
  isImageUrl(url) ? probeImage(url, timeoutMs) : probeVideo(url, timeoutMs);

/** Image : chargée en entier (quelques centaines de Ko). */
const probeImage = (url: string, timeoutMs: number): Promise<MediaStatus> =>
  new Promise(resolve => {
    const img = new Image();
    const timer = setTimeout(() => {
      img.src = '';
      resolve({ state: 'timeout' });
    }, timeoutMs);
    img.onload = () => {
      clearTimeout(timer);
      resolve({ state: 'ok', duration: IMAGE_SECONDS, width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      clearTimeout(timer);
      resolve({ state: 'error' });
    };
    img.src = url;
  });

const probeVideo = (url: string, timeoutMs: number): Promise<MediaStatus> =>
  new Promise(resolve => {
    const v = document.createElement('video');
    let done = false;
    const finish = (r: MediaStatus) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      v.removeAttribute('src');
      v.load();
      resolve(r);
    };
    const timer = setTimeout(() => finish({ state: 'timeout' }), timeoutMs);
    v.preload = 'metadata';
    v.muted = true;
    v.onloadedmetadata = () => finish({ state: 'ok', duration: v.duration, width: v.videoWidth, height: v.videoHeight });
    v.onerror = () => finish({ state: 'error' });
    v.src = url;
  });

export const formatDuration = (sec: number) => {
  if (!Number.isFinite(sec)) return '—';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
};

/* ------------------------------ Historique ------------------------------ */

export const commandLabel = (c: string | null | undefined) =>
  c === 'reload' ? 'Redémarrer le lecteur' : c === 'clear_cache' ? 'Vider le cache vidéo' : c === 'unpair' ? 'Déconnecter la TV' : c === 'identify' ? 'Identifier l’écran' : c === 'power_setup' ? 'Autoriser l’extinction' : c === 'health' ? 'Actualiser les voyants' : c === 'home_setup' ? 'SYNK en écran d’accueil' : c || 'Commande';

export const formatSpan = (ms: number) => {
  const m = Math.max(1, Math.round(ms / 60000));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ${String(m % 60).padStart(2, '0')}`;
  return `${Math.round(h / 24)} j`;
};

/** Disponibilité d'un écran sur une période (coupures du journal + coupure en cours). */
export function availability(screen: AppScreen, events: ScreenEvent[], now: number, windowMs = 7 * 24 * 3600 * 1000) {
  const from = now - windowMs;
  let down = 0;
  let count = 0;
  for (const e of events) {
    if (e.screen_id !== screen.id || e.kind !== 'outage' || !e.started_at) continue;
    const start = Math.max(new Date(e.started_at).getTime(), from);
    const end = new Date(e.created_at).getTime();
    if (end > from) {
      down += Math.max(0, end - start);
      count++;
    }
  }
  if (screen.last_ping && !isOnline(screen.last_ping, now)) {
    down += now - Math.max(new Date(screen.last_ping).getTime(), from);
    count++;
  }
  return { percent: Math.max(0, 100 - (down / windowMs) * 100), downMs: down, outages: count };
}
