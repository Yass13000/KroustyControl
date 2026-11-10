// Format de mur d'une vidéo (1 écran, 2 écrans alignés… 2×2), choisi ou déduit automatiquement.
import { FORMATS, parseFormat, parsePlaylist } from './media';
import type { AppScreen, Configuration, VideoFile } from './types';
import type { VideoAnalysis } from './videoAnalysis';

export const FORMAT_CODES = FORMATS.map(f => f.value) as string[];

/** Libellé court pour les pastilles. */
export const FORMAT_SHORT: Record<string, string> = {
  '1x1': '1 écran',
  '1x2': '2 écrans',
  '1x3': '3 écrans',
  '1x4': '4 écrans',
  '2x2': '2×2',
};

export type FormatSource = 'saved' | 'usage' | 'name' | 'shape';

export const SOURCE_LABEL: Record<FormatSource, string> = {
  saved: 'choisi',
  usage: 'déduit du mur de diffusion',
  name: 'déduit du nom',
  shape: 'déduit des dimensions',
};

/**
 * Lit un format dans un nom, selon la convention de l'équipe « largeur X hauteur » :
 * « 2X1 » = 2 écrans côte à côte (format 1x2), « 4X1 » → 1x4, « 2X2 » → 2x2.
 */
export function formatFromName(name: string | undefined | null): string | null {
  const m = (name || '').match(/(\d)\s*[x×]\s*(\d)/i);
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  const widthByHeight = `${b}x${a}`; // lignes x colonnes
  if (FORMAT_CODES.includes(widthByHeight)) return widthByHeight;
  const asWritten = `${a}x${b}`;
  if (FORMAT_CODES.includes(asWritten)) return asWritten;
  return null;
}

/** Nombre d'écrans côte à côte qu'implique la forme de la vidéo (1 = format 16:9). */
const widthInScreens = (a: VideoAnalysis | undefined) => {
  if (!a?.ok || !a.width || !a.height) return null;
  return Math.max(1, Math.round(Math.max(a.width, a.height) / Math.min(a.width, a.height) / (16 / 9)));
};

/** Déduit le format à partir des dimensions (écrans 16:9, en paysage ou en portrait). */
export function formatFromShape(a: VideoAnalysis | undefined): string | null {
  const n = widthInScreens(a);
  if (n === null) return null;
  if (n >= 2 && n <= 4) return `1x${n}`;
  // 16:9 : un écran seul, ou un 2×2 si la définition le justifie (≈ 4K)
  return Math.min(a!.width!, a!.height!) >= 2000 ? '2x2' : '1x1';
}

/**
 * Nom + dimensions : le nom donne le NOMBRE d'écrans (« 4X1 » = 4 écrans),
 * la forme de la vidéo décide de la disposition (16:9 → 2×2, 4 fois plus large → 4 alignés).
 */
function formatFromNameAndShape(name: string | undefined | null, a: VideoAnalysis | undefined): string | null {
  const m = (name || '').match(/(\d)\s*[x×]\s*(\d)/i);
  if (!m) return null;
  const total = Number(m[1]) * Number(m[2]);
  const wide = widthInScreens(a);
  if (wide === null) return formatFromName(name); // dimensions inconnues : on se fie au nom seul
  if (wide >= 2) return wide === total || total === 1 ? `1x${wide}` : formatFromShape(a);
  // Vidéo 16:9
  if (total === 4) return '2x2';
  if (total === 1) return '1x1';
  return formatFromShape(a);
}

/** Formats des murs qui diffusent chaque URL. */
export function usageFormats(screens: AppScreen[], configurations: Configuration[]) {
  const byConfig = new Map(configurations.map(c => [c.id, c.format]));
  const out = new Map<string, Map<string, number>>();
  for (const s of screens) {
    const f = s.configuration_id ? byConfig.get(s.configuration_id) : undefined;
    if (!f) continue;
    for (const url of parsePlaylist(s.video_url)) {
      const m = out.get(url) || new Map<string, number>();
      m.set(f, (m.get(f) || 0) + 1);
      out.set(url, m);
    }
  }
  return out;
}

export function resolveFormat(
  video: VideoFile,
  opts: { usage?: Map<string, Map<string, number>>; analysis?: VideoAnalysis; albumName?: string },
): { format: string | null; source: FormatSource | null } {
  if (video.format && FORMAT_CODES.includes(video.format)) return { format: video.format, source: 'saved' };
  const used = opts.usage?.get(video.url);
  if (used && used.size) {
    const best = [...used.entries()].sort((x, y) => y[1] - x[1])[0][0];
    return { format: best, source: 'usage' };
  }
  const byName = formatFromNameAndShape(video.name, opts.analysis) || formatFromNameAndShape(opts.albumName, opts.analysis);
  if (byName) return { format: byName, source: 'name' };
  const byShape = formatFromShape(opts.analysis);
  if (byShape) return { format: byShape, source: 'shape' };
  return { format: null, source: null };
}

/** Le format convient-il à ce mur ? */
export const sameWall = (a: string | null, b: string) => {
  if (!a) return false;
  const x = parseFormat(a);
  const y = parseFormat(b);
  return x.rows === y.rows && x.cols === y.cols;
};
