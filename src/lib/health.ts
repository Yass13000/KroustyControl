// Voyants de santé des TV (lecteur 1.8+), envoyés avec le signal de vie chaque minute.
// Chaque mesure devient un voyant : vert (ok), orange (à surveiller), rouge (à traiter).

import type { AppScreen } from './types';

export interface ScreenHealth {
  v?: number;
  /** Heure de la mesure (ISO, lecteur 1.9+) */
  at?: string;
  /** wifi | eth | cell | other | none */
  net?: string;
  /** Signal Wi-Fi (dBm) */
  rssi?: number;
  /** Débit du lien Wi-Fi (Mb/s) */
  link?: number;
  /** Bande Wi-Fi (2 ou 5 GHz) */
  ghz?: number;
  /** Débit estimé (Mb/s) */
  down?: number;
  /** Accès internet vérifié par Android */
  valid?: boolean;
  /** Échanges réussis avec le serveur sur 1 h (%) et nombre d'échanges */
  ok?: number;
  n?: number;
  /** Temps de réponse médian du serveur (ms) */
  lat?: number;
  /** Coupures réseau sur 24 h */
  drops?: number;
  /** Stockage libre et cache des médias (Mo) */
  disk?: number;
  cache?: number;
  /** Mémoire disponible / totale (Mo) */
  ram?: number;
  ramt?: number;
  lowram?: boolean;
  /** Température : 0 normale … 6 arrêt */
  heat?: number;
  res?: string;
  os?: number;
  /** Minutes depuis le démarrage de la TV */
  up?: number;
  /** playing | paused | buffering | download | error | idle | sleep */
  play?: string;
  perr?: number;
  /** Rôle dans le mur : m (maître), s (suiveur), solo */
  sync?: string;
  cal?: boolean;
  drift?: number;
  peers?: number;
  ntp?: number;
  /** SYNK est l'application d'accueil de la TV (lecteur 1.12+) */
  home?: boolean;
}

export type Tone = 'ok' | 'warn' | 'bad' | 'off';

export interface Light {
  key: string;
  label: string;
  value: string;
  tone: Tone;
}

export const healthOf = (s: AppScreen): ScreenHealth | null => (s.health && typeof s.health === 'object' ? (s.health as ScreenHealth) : null);

/** Barres de signal Wi-Fi (0 à 4). */
export const wifiBars = (rssi?: number) => (rssi === undefined ? 0 : rssi >= -55 ? 4 : rssi >= -65 ? 3 : rssi >= -73 ? 2 : rssi >= -80 ? 1 : 0);

export function networkLight(h: ScreenHealth): Light {
  if (h.net === 'eth') return { key: 'net', label: 'Connexion', value: 'Câble', tone: h.valid === false ? 'bad' : 'ok' };
  if (h.net === 'none') return { key: 'net', label: 'Connexion', value: 'Aucune', tone: 'bad' };
  if (h.net === 'wifi') {
    const bars = wifiBars(h.rssi);
    const quality = ['Très faible', 'Faible', 'Moyen', 'Bon', 'Excellent'][bars];
    const extra = [h.rssi !== undefined ? `${h.rssi} dBm` : '', h.ghz ? `${h.ghz} GHz` : '', h.link ? `${h.link} Mb/s` : ''].filter(Boolean).join(' · ');
    return { key: 'net', label: 'Wi-Fi', value: `${quality}${extra ? ` · ${extra}` : ''}`, tone: h.valid === false || bars <= 0 ? 'bad' : bars === 1 ? 'warn' : 'ok' };
  }
  return { key: 'net', label: 'Connexion', value: h.net === 'cell' ? 'Mobile' : 'Autre', tone: 'ok' };
}

export function stabilityLight(h: ScreenHealth): Light {
  const drops = h.drops ?? 0;
  const ok = h.ok;
  const parts = [ok !== undefined ? `${ok} % réussis (1 h)` : '', `${drops} coupure${drops > 1 ? 's' : ''} (24 h)`].filter(Boolean);
  const tone: Tone = (ok !== undefined && ok < 90) || drops >= 10 ? 'bad' : (ok !== undefined && ok < 98) || drops >= 3 ? 'warn' : 'ok';
  return { key: 'stab', label: 'Stabilité', value: parts.join(' · '), tone };
}

export function latencyLight(h: ScreenHealth): Light | null {
  if (h.lat === undefined) return null;
  return { key: 'lat', label: 'Temps de réponse', value: `${h.lat} ms`, tone: h.lat >= 1500 ? 'bad' : h.lat >= 600 ? 'warn' : 'ok' };
}

const mo = (v: number) => (v >= 1024 ? `${(v / 1024).toFixed(1)} Go` : `${v} Mo`);

export function healthLights(h: ScreenHealth): Light[] {
  const lights: Light[] = [networkLight(h), stabilityLight(h)];
  const lat = latencyLight(h);
  if (lat) lights.push(lat);

  // Lecture
  const play: Record<string, [string, Tone]> = {
    playing: ['En cours', 'ok'],
    paused: ['En pause', 'warn'],
    buffering: ['Chargement', 'warn'],
    download: ['Téléchargement', 'warn'],
    error: ['Erreur', 'bad'],
    idle: ['Arrêtée', 'warn'],
    sleep: ['Veille', 'off'],
  };
  if (h.play) {
    const [value, tone] = play[h.play] ?? [h.play, 'warn'];
    lights.push({ key: 'play', label: 'Lecture', value: `${value}${h.perr ? ` · ${h.perr} erreur${h.perr > 1 ? 's' : ''}` : ''}`, tone: h.perr && h.perr >= 5 && tone === 'ok' ? 'warn' : tone });
  }

  // Synchro du mur
  if (h.sync === 'm') lights.push({ key: 'sync', label: 'Mur', value: `Maître · ${h.peers ?? 0} écran${(h.peers ?? 0) > 1 ? 's' : ''} suiveur${(h.peers ?? 0) > 1 ? 's' : ''}`, tone: 'ok' });
  if (h.sync === 's') {
    if (!h.cal) lights.push({ key: 'sync', label: 'Mur', value: 'Pas de contact avec le maître', tone: h.play === 'sleep' ? 'off' : 'bad' });
    else lights.push({ key: 'sync', label: 'Mur', value: `Synchronisé · écart ${h.drift ?? 0} ms`, tone: (h.drift ?? 0) > 300 ? 'bad' : (h.drift ?? 0) > 100 ? 'warn' : 'ok' });
  }

  // Appareil
  if (h.disk !== undefined) lights.push({ key: 'disk', label: 'Stockage libre', value: `${mo(h.disk)}${h.cache ? ` · médias ${mo(h.cache)}` : ''}`, tone: h.disk < 300 ? 'bad' : h.disk < 1000 ? 'warn' : 'ok' });
  if (h.ram !== undefined) lights.push({ key: 'ram', label: 'Mémoire libre', value: `${mo(h.ram)}${h.ramt ? ` / ${mo(h.ramt)}` : ''}`, tone: h.lowram ? 'warn' : 'ok' });
  if (h.heat !== undefined) {
    const labels = ['Normale', 'Tiède', 'Chaude', 'Très chaude', 'Critique', 'Urgence', 'Arrêt'];
    lights.push({ key: 'heat', label: 'Température', value: labels[h.heat] ?? `${h.heat}`, tone: h.heat >= 3 ? 'bad' : h.heat === 2 ? 'warn' : 'ok' });
  }
  if (h.up !== undefined) {
    const d = Math.floor(h.up / 1440);
    const hrs = Math.floor((h.up % 1440) / 60);
    lights.push({ key: 'up', label: 'TV allumée depuis', value: d > 0 ? `${d} j ${hrs} h` : hrs > 0 ? `${hrs} h ${h.up % 60} min` : `${h.up} min`, tone: 'ok' });
  }
  if (h.home !== undefined) {
    lights.push({ key: 'home', label: 'Écran d’accueil', value: h.home ? 'SYNK · démarre seul' : 'Pas encore SYNK', tone: h.home ? 'ok' : 'warn' });
  }
  if (h.res) lights.push({ key: 'res', label: 'Affichage', value: `${h.res}${h.os ? ` · Android API ${h.os}` : ''}`, tone: 'ok' });
  return lights;
}

/** Pire voyant (pour une pastille unique). */
export const worstTone = (lights: Light[]): Tone =>
  lights.some(l => l.tone === 'bad') ? 'bad' : lights.some(l => l.tone === 'warn') ? 'warn' : lights.length ? 'ok' : 'off';

export const TONE_TEXT: Record<Tone, string> = {
  ok: 'text-emerald-700',
  warn: 'text-amber-700',
  bad: 'text-red-600',
  off: 'text-muted',
};
export const TONE_DOT: Record<Tone, string> = {
  ok: 'bg-emerald-500',
  warn: 'bg-amber-500',
  bad: 'bg-red-500',
  off: 'bg-muted/40',
};
