// Utilitaires liés aux médias, formats d'écrans et statut des appareils.
// Une seule source de vérité (avant : 3 versions différentes selon l'onglet).

/** Un écran est considéré en ligne s'il a pingé il y a moins de 12 minutes. */
export const ONLINE_THRESHOLD_MS = 12 * 60 * 1000;

export const isOnline = (lastPing: string | null | undefined, now = Date.now()) => {
  if (!lastPing) return false;
  return now - new Date(lastPing).getTime() < ONLINE_THRESHOLD_MS;
};

/** « à l'instant », « il y a 5 min », « il y a 3 h », « il y a 2 j », « jamais ». */
export const timeAgo = (iso: string | null | undefined, now = Date.now()) => {
  if (!iso) return 'jamais';
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return "à l'instant";
  const m = Math.round(s / 60);
  if (m < 60) return `il y a ${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `il y a ${h} h`;
  return `il y a ${Math.round(h / 24)} j`;
};

/** Écran connecté mais en veille hors horaires (lecteur 1.2+). */
export const isSleeping = (s: { last_ping: string | null; power_state?: string | null }, now = Date.now()) =>
  s.power_state === 'sleep' && isOnline(s.last_ping, now);

export const FORMATS = [
  { value: '1x1', label: '1 écran seul' },
  { value: '1x2', label: '2 écrans alignés' },
  { value: '1x3', label: '3 écrans alignés' },
  { value: '1x4', label: '4 écrans alignés' },
  { value: '2x2', label: '4 écrans en carré' },
] as const;

export const formatLabel = (format: string) => FORMATS.find(f => f.value === format)?.label ?? format;

/** "RxC" → { rows, cols } (ex. "1x3" = 1 ligne, 3 colonnes). */
export const parseFormat = (format: string) => {
  const [rows, cols] = (format || '1x1').split('x').map(Number);
  return { rows: rows || 1, cols: cols || 1 };
};

/** Convertit un lien de partage Dropbox / Google Drive en lien de lecture directe. */
export const transformStorageUrl = (url: string): string => {
  if (!url) return '';
  if (url.includes(',')) {
    return url
      .split(',')
      .map(u => transformStorageUrl(u))
      .filter(Boolean)
      .join(',');
  }

  const clean = url.trim();
  if (!clean) return '';

  if (/(^|\.)dropbox\.com/.test(safeHost(clean))) {
    try {
      const u = new URL(clean);
      u.hostname = 'dl.dropboxusercontent.com';
      u.searchParams.delete('dl');
      u.searchParams.set('raw', '1');
      return u.toString();
    } catch {
      return clean;
    }
  }

  if (clean.includes('drive.google.com') || clean.includes('docs.google.com')) {
    const fileId = clean.match(/\/d\/([a-zA-Z0-9_-]+)/)?.[1] || clean.match(/[?&]id=([a-zA-Z0-9_-]+)/)?.[1];
    if (fileId) return `https://drive.google.com/uc?export=download&id=${fileId}`;
  }

  return clean;
};

const safeHost = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
};

export const isGoogleDrive = (url: string) => /google\.com/.test(url);

export const googleDriveThumbnail = (url: string) => {
  const id = url.match(/[?&]id=([a-zA-Z0-9_-]+)/)?.[1] || url.match(/\/d\/([a-zA-Z0-9_-]+)/)?.[1];
  return id ? `https://drive.google.com/thumbnail?id=${id}&sz=w480` : '';
};

/** Une playlist est stockée sous forme d'URLs séparées par des virgules. */
export const parsePlaylist = (raw: string | null | undefined): string[] =>
  (raw || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

export const fileNameFromUrl = (url: string) => {
  try {
    return decodeURIComponent(url.split('/').pop()?.split('?')[0] || '');
  } catch {
    return '';
  }
};

export const fileExtension = (name: string) => {
  const parts = name.split('.');
  return parts.length > 1 ? parts.pop()!.toUpperCase() : 'LIEN';
};
