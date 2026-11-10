import { parseFormat, parsePlaylist } from './media';
import type { AppScreen, Configuration } from './types';

// Contrôle qualité des vidéos : lit seulement l'en-tête MP4 (quelques centaines de Ko)
// via des requêtes par plage d'octets, sans jamais télécharger la vidéo entière.
// Tout le calcul se fait dans l'app web : aucun impact sur les écrans.

/* ------------------------------ Réglages ------------------------------ */

/**
 * Résolution native d'UN écran du mur (iiyama LH4360IHS).
 * Hypothèse 1920×1080 : à ajuster si la fiche technique indique une autre dalle.
 */
export const PANEL = { width: 1920, height: 1080 };
/** Au-delà, l'écran décode des images en trop sans gain visible en affichage dynamique. */
export const MAX_FPS = 30;
/** Débit jugé suffisant (bits par pixel par image, en H.264). */
export const TARGET_BPP = 0.1;

/* ------------------------------ Types ------------------------------ */

export type Verdict = 'light' | 'heavy' | 'incompatible' | 'unknown';

export interface VideoAnalysis {
  ok: boolean;
  size?: number; // octets
  duration?: number; // secondes
  width?: number;
  height?: number;
  fps?: number;
  codec?: string; // 'avc1', 'hvc1', 'hev1', 'vp09', 'av01'…
  profile?: string; // ex. "High 4.2"
  bitrate?: number; // bits/s
  hasAudio?: boolean;
  error?: string;
}

export interface Assessment {
  verdict: Verdict;
  reasons: string[];
  /** Résolution conseillée pour l'usage le plus exigeant de la vidéo */
  target: { width: number; height: number };
}

/* ------------------------------ Lecture par plages ------------------------------ */

/** Lecture d'une plage d'octets : depuis une URL (requête « Range ») ou depuis un fichier local. */
type RangeReader = (start: number, end: number) => Promise<{ buf: Uint8Array; total?: number; partial: boolean }>;

async function fetchRange(url: string, start: number, end: number) {
  const res = await fetch(url, { headers: { Range: `bytes=${start}-${end}` } });
  if (!res.ok && res.status !== 206) throw new Error(`HTTP ${res.status}`);
  const total = Number(res.headers.get('content-range')?.split('/')[1]) || Number(res.headers.get('content-length')) || undefined;
  const buf = new Uint8Array(await res.arrayBuffer());
  return { buf, total, partial: res.status === 206 };
}

const u32 = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const u16 = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1];
const fourcc = (b: Uint8Array, o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
const u64 = (b: Uint8Array, o: number) => u32(b, o) * 2 ** 32 + u32(b, o + 4);

interface Box {
  type: string;
  start: number; // début de la boîte (en-tête inclus)
  data: number; // début du contenu
  end: number;
}

/** Liste les boîtes enfants dans [from, to[. */
function children(b: Uint8Array, from: number, to: number): Box[] {
  const out: Box[] = [];
  let o = from;
  while (o + 8 <= to) {
    let size = u32(b, o);
    const type = fourcc(b, o + 4);
    let header = 8;
    if (size === 1) {
      size = u64(b, o + 8);
      header = 16;
    } else if (size === 0) size = to - o;
    if (size < header) break;
    out.push({ type, start: o, data: o + header, end: Math.min(o + size, to) });
    o += size;
  }
  return out;
}

const find = (b: Uint8Array, box: Box | { data: number; end: number }, type: string) => children(b, box.data, box.end).find(c => c.type === type);

/** Trouve et télécharge uniquement la boîte « moov » (métadonnées). */
async function loadMoov(read: RangeReader): Promise<{ moov: Uint8Array; size?: number; head: Uint8Array }> {
  const HEAD = 512 * 1024;
  const first = await read(0, HEAD - 1);
  const size = first.total;
  let offset = 0;
  // Parcours des boîtes de premier niveau ; on saute « mdat » sans la lire.
  for (let i = 0; i < 64; i++) {
    let header: Uint8Array;
    if (offset + 16 <= first.buf.length) header = first.buf.subarray(offset, offset + 16);
    else {
      if (size !== undefined && offset >= size) break;
      header = (await read(offset, offset + 15)).buf;
    }
    if (header.length < 8) break;
    let boxSize = u32(header, 0);
    const type = fourcc(header, 4);
    if (boxSize === 1) boxSize = u64(header, 8);
    else if (boxSize === 0 && size) boxSize = size - offset;
    if (boxSize < 8) break;

    if (type === 'moov') {
      if (offset + boxSize <= first.buf.length) return { moov: first.buf.subarray(offset, offset + boxSize), size, head: first.buf };
      if (boxSize > 50 * 1024 * 1024) throw new Error('moov trop grand');
      return { moov: (await read(offset, offset + boxSize - 1)).buf, size, head: first.buf };
    }
    offset += boxSize;
    if (!first.partial && offset >= first.buf.length) break; // le serveur a tout renvoyé
  }
  throw new Error('Métadonnées MP4 introuvables');
}

const AVC_PROFILES: Record<number, string> = { 66: 'Baseline', 77: 'Main', 88: 'Extended', 100: 'High', 110: 'High 10', 122: 'High 4:2:2', 244: 'High 4:4:4' };
const HEVC_PROFILES: Record<number, string> = { 1: 'Main', 2: 'Main 10', 3: 'Main Still' };

function parseMoov(moov: Uint8Array): Omit<VideoAnalysis, 'ok' | 'size' | 'bitrate'> & { timescale?: number; fragmented?: boolean } {
  const root = { data: 8, end: moov.length };
  const mvex = find(moov, root, 'mvex');
  const traks = children(moov, root.data, root.end).filter(c => c.type === 'trak');
  let result: Omit<VideoAnalysis, 'ok' | 'size' | 'bitrate'> & { timescale?: number } = {};
  let hasAudio = false;

  for (const trak of traks) {
    const mdia = find(moov, trak, 'mdia');
    if (!mdia) continue;
    const hdlr = find(moov, mdia, 'hdlr');
    const handler = hdlr ? fourcc(moov, hdlr.data + 8) : '';
    if (handler === 'soun') hasAudio = true;
    if (handler !== 'vide') continue;

    const tkhd = find(moov, trak, 'tkhd');
    const mdhd = find(moov, mdia, 'mdhd');
    const minf = find(moov, mdia, 'minf');
    const stbl = minf && find(moov, minf, 'stbl');
    if (!mdhd || !stbl) continue;

    const v = moov[mdhd.data];
    const timescale = v === 1 ? u32(moov, mdhd.data + 20) : u32(moov, mdhd.data + 12);
    const mediaDuration = v === 1 ? u64(moov, mdhd.data + 24) : u32(moov, mdhd.data + 16);

    let width: number | undefined;
    let height: number | undefined;
    if (tkhd) {
      // largeur/hauteur en virgule fixe 16.16, à la fin de tkhd
      width = Math.round(u32(moov, tkhd.end - 8) / 65536);
      height = Math.round(u32(moov, tkhd.end - 4) / 65536);
    }

    // Codec + profil (stsd → première entrée)
    let codec: string | undefined;
    let profile: string | undefined;
    const stsd = find(moov, stbl, 'stsd');
    if (stsd) {
      const entry = children(moov, stsd.data + 8, stsd.end)[0];
      if (entry) {
        codec = entry.type;
        const vw = u16(moov, entry.data + 24);
        const vh = u16(moov, entry.data + 26);
        if (!width || !height) {
          width = vw;
          height = vh;
        }
        const sub = children(moov, entry.data + 78, entry.end);
        const avcC = sub.find(c => c.type === 'avcC');
        const hvcC = sub.find(c => c.type === 'hvcC');
        if (avcC) profile = `${AVC_PROFILES[moov[avcC.data + 1]] ?? `profil ${moov[avcC.data + 1]}`} ${(moov[avcC.data + 3] / 10).toFixed(1)}`;
        if (hvcC) profile = `${HEVC_PROFILES[moov[hvcC.data + 1] & 0x1f] ?? 'HEVC'} ${(moov[hvcC.data + 12] / 30).toFixed(1)}`;
      }
    }

    // Images par seconde : stts (MP4 classique) ou trex (MP4 fragmenté)
    let fps: number | undefined;
    const stts = find(moov, stbl, 'stts');
    if (stts) {
      const count = u32(moov, stts.data + 4);
      let samples = 0;
      let ticks = 0;
      for (let i = 0; i < count && i < 100000; i++) {
        const n = u32(moov, stts.data + 8 + i * 8);
        const delta = u32(moov, stts.data + 12 + i * 8);
        samples += n;
        ticks += n * delta;
      }
      if (samples > 0 && ticks > 0) fps = (samples * timescale) / ticks;
    }
    if (!fps && mvex) {
      const trex = children(moov, mvex.data, mvex.end).find(c => c.type === 'trex');
      const dur = trex ? u32(moov, trex.data + 16) : 0;
      if (dur) fps = timescale / dur;
    }

    // Durée : piste vidéo, sinon en-tête du film (mvhd)
    let duration = mediaDuration && timescale ? mediaDuration / timescale : undefined;
    if (!duration) {
      const mvhd = find(moov, root, 'mvhd');
      if (mvhd) {
        const mv = moov[mvhd.data];
        const ts = mv === 1 ? u32(moov, mvhd.data + 20) : u32(moov, mvhd.data + 12);
        const d = mv === 1 ? u64(moov, mvhd.data + 24) : u32(moov, mvhd.data + 16);
        if (ts && d) duration = d / ts;
      }
    }
    if (!duration && mvex) {
      const mehd = children(moov, mvex.data, mvex.end).find(c => c.type === 'mehd');
      const mvhd = find(moov, root, 'mvhd');
      if (mehd && mvhd) {
        const ts = moov[mvhd.data] === 1 ? u32(moov, mvhd.data + 20) : u32(moov, mvhd.data + 12);
        const d = moov[mehd.data] === 1 ? u64(moov, mehd.data + 4) : u32(moov, mehd.data + 4);
        if (ts && d) duration = d / ts;
      }
    }

    result = { width, height, fps: fps ? Math.round(fps * 100) / 100 : undefined, codec, profile, duration, timescale };
    break;
  }
  return { ...result, hasAudio, fragmented: !!mvex };
}

/** MP4 fragmenté : images/s lues dans le premier fragment (moof → traf → tfhd / trun). */
function fragmentFps(head: Uint8Array, timescale: number): number | undefined {
  const moof = children(head, 0, head.length).find(c => c.type === 'moof');
  if (!moof || moof.end > head.length) return undefined;
  for (const traf of children(head, moof.data, moof.end).filter(c => c.type === 'traf')) {
    const tfhd = find(head, traf, 'tfhd');
    let defaultDuration = 0;
    if (tfhd) {
      const flags = u32(head, tfhd.data) & 0xffffff;
      let o = tfhd.data + 8;
      if (flags & 0x01) o += 8;
      if (flags & 0x02) o += 4;
      if (flags & 0x08) defaultDuration = u32(head, o);
    }
    const trun = find(head, traf, 'trun');
    if (trun) {
      const flags = u32(head, trun.data) & 0xffffff;
      const count = u32(head, trun.data + 4);
      let o = trun.data + 8;
      if (flags & 0x01) o += 4;
      if (flags & 0x04) o += 4;
      if (flags & 0x100 && count > 0) {
        const stride = 4 * [0x100, 0x200, 0x400, 0x800].filter(f => flags & f).length;
        let total = 0;
        let n = 0;
        for (let i = 0; i < count && o + i * stride + 4 <= trun.end; i++, n++) total += u32(head, o + i * stride);
        if (n && total) return (n * timescale) / total;
      }
    }
    if (defaultDuration) return timescale / defaultDuration;
  }
  return undefined;
}

/**
 * MP4 fragmenté : durée réelle et images/s lues dans le DERNIER fragment
 * (tfdt = instant de départ du fragment + durées de ses images). Une seule requête en fin de fichier.
 */
async function tailFragmentInfo(read: RangeReader, size: number, timescale: number) {
  const start = Math.max(0, size - 1024 * 1024);
  const { buf } = await read(start, size - 1);
  // Cherche le dernier « moof » valide dans la fin du fichier.
  for (let i = buf.length - 8; i >= 4; i--) {
    if (buf[i] !== 0x6d || buf[i + 1] !== 0x6f || buf[i + 2] !== 0x6f || buf[i + 3] !== 0x66) continue; // 'moof'
    const boxStart = i - 4;
    const boxSize = u32(buf, boxStart);
    if (boxSize < 16 || boxStart + boxSize > buf.length) continue;
    const moof: Box = { type: 'moof', start: boxStart, data: boxStart + 8, end: boxStart + boxSize };
    for (const traf of children(buf, moof.data, moof.end).filter(c => c.type === 'traf')) {
      const tfdt = find(buf, traf, 'tfdt');
      const trun = find(buf, traf, 'trun');
      if (!tfdt || !trun) continue;
      const base = buf[tfdt.data] === 1 ? u64(buf, tfdt.data + 4) : u32(buf, tfdt.data + 4);
      const flags = u32(buf, trun.data) & 0xffffff;
      const count = u32(buf, trun.data + 4);
      let o = trun.data + 8;
      if (flags & 0x01) o += 4;
      if (flags & 0x04) o += 4;
      let ticks = 0;
      if (flags & 0x100) {
        const stride = 4 * [0x100, 0x200, 0x400, 0x800].filter(f => flags & f).length;
        for (let k = 0; k < count && o + k * stride + 4 <= trun.end; k++) ticks += u32(buf, o + k * stride);
      }
      if (!ticks) continue;
      return { duration: (base + ticks) / timescale, fps: (count * timescale) / ticks };
    }
  }
  return undefined;
}

/** Durée par le lecteur du navigateur (secours si l'en-tête ne la donne pas). */
const probeDuration = (url: string) =>
  new Promise<number | undefined>(resolve => {
    const v = document.createElement('video');
    const t = setTimeout(() => done(undefined), 15000);
    const done = (d: number | undefined) => {
      clearTimeout(t);
      v.removeAttribute('src');
      v.load();
      resolve(d);
    };
    v.preload = 'metadata';
    v.muted = true;
    v.onloadedmetadata = () => done(Number.isFinite(v.duration) ? v.duration : undefined);
    v.onerror = () => done(undefined);
    v.src = url;
  });

export function analyzeVideo(url: string): Promise<VideoAnalysis> {
  return analyze((a, b) => fetchRange(url, a, b), url);
}

/** Analyse d'un fichier local, avant envoi : rien ne sort de l'ordinateur. */
export async function analyzeFile(file: File): Promise<VideoAnalysis> {
  const objectUrl = URL.createObjectURL(file);
  try {
    return await analyze(async (a, b) => ({ buf: new Uint8Array(await file.slice(a, b + 1).arrayBuffer()), total: file.size, partial: true }), objectUrl);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function analyze(read: RangeReader, url: string): Promise<VideoAnalysis> {
  try {
    const { moov, size, head } = await loadMoov(read);
    const { timescale, fragmented, ...meta } = parseMoov(moov);
    let fps = meta.fps;
    let duration = meta.duration;
    if (fragmented && timescale) {
      // L'en-tête d'un MP4 fragmenté ne décrit souvent que le début : on lit la fin du fichier.
      const tail = size ? await tailFragmentInfo(read, size, timescale).catch(() => undefined) : undefined;
      if (tail) {
        duration = tail.duration;
        fps = fps || Math.round(tail.fps * 100) / 100;
      }
      if (!fps) {
        const f = fragmentFps(head, timescale);
        if (f) fps = Math.round(f * 100) / 100;
      }
    }
    if (!duration) duration = await probeDuration(url);
    const bitrate = size && duration ? (size * 8) / duration : undefined;
    return { ok: true, size, ...meta, fps, duration, bitrate };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/* ------------------------------ Verdict ------------------------------ */

/** Résolution utile pour un mur de `cols`×`rows` écrans. */
export const wallTarget = (cols: number, rows: number) => ({ width: PANEL.width * cols, height: PANEL.height * rows });

export function assess(a: VideoAnalysis, target = wallTarget(1, 1)): Assessment {
  const reasons: string[] = [];
  if (!a.ok) {
    const dead = /HTTP 4\d\d/.test(a.error || '');
    return { verdict: 'unknown', reasons: [dead ? `Lien mort ou expiré (${a.error})` : a.error || 'Analyse impossible'], target };
  }

  let incompatible = false;
  let heavy = false;

  // Codec : H.264 est décodé en matériel partout ; le reste est à éviter sur des écrans d'affichage.
  const codec = (a.codec || '').toLowerCase();
  if (codec.startsWith('avc')) {
    if (a.profile && /High (10|4:2:2|4:4:4)/.test(a.profile)) {
      incompatible = true;
      reasons.push(`Profil ${a.profile} rarement décodé en matériel`);
    }
  } else if (codec.startsWith('hvc') || codec.startsWith('hev')) {
    heavy = true;
    reasons.push('Codec HEVC : préférer H.264, plus sûr pour le processeur');
  } else if (codec) {
    incompatible = true;
    reasons.push(`Codec ${codec.toUpperCase()} non recommandé`);
  }

  if (a.fps && a.fps > MAX_FPS + 0.5) {
    heavy = true;
    reasons.push(`${Math.round(a.fps)} images/s : ${MAX_FPS} suffisent`);
  }

  if (a.width && a.height) {
    const pixels = a.width * a.height;
    const needed = target.width * target.height;
    if (pixels > needed * 1.05) {
      heavy = true;
      reasons.push(`${a.width}×${a.height} pour ${target.width}×${target.height} utiles`);
    }
    if (a.bitrate && a.fps) {
      const ideal = TARGET_BPP * Math.min(pixels, needed) * Math.min(a.fps, MAX_FPS);
      if (a.bitrate > ideal * 1.8) {
        heavy = true;
        reasons.push(`Débit ${mbps(a.bitrate)} : ~${mbps(ideal)} suffisent`);
      }
    }
  }

  if (a.size && a.size > 300 * 1024 * 1024) reasons.push(`Fichier de ${megabytes(a.size)} : long à télécharger`);

  return { verdict: incompatible ? 'incompatible' : heavy ? 'heavy' : 'light', reasons, target };
}

/** Réglages d'export conseillés + commande ffmpeg prête à copier pour l'équipe. */
export function recommendation(a: VideoAnalysis, target: { width: number; height: number }) {
  const w = Math.min(a.width || target.width, target.width);
  const h = Math.min(a.height || target.height, target.height);
  const fps = Math.min(Math.round(a.fps || MAX_FPS), MAX_FPS);
  const ideal = TARGET_BPP * w * h * fps;
  // Jamais plus que la source : réencoder ne doit pas alourdir la vidéo.
  const kbps = Math.round(Math.min(ideal, a.bitrate || ideal) / 1000);
  return {
    summary: `H.264 High · ${w}×${h} · ${fps} i/s · ~${(kbps / 1000).toFixed(1)} Mb/s`,
    ffmpeg: `ffmpeg -i entree.mp4 -vf "scale=${w}:${h}:flags=lanczos,fps=${fps}" -c:v libx264 -profile:v high -pix_fmt yuv420p -preset slow -b:v ${kbps}k -maxrate ${Math.round(kbps * 1.5)}k -bufsize ${kbps * 2}k -movflags +faststart -an sortie.mp4`,
  };
}

export const mbps = (bps: number) => `${(bps / 1_000_000).toFixed(1)} Mb/s`;
export const megabytes = (b: number) => (b > 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} Go` : `${Math.round(b / 1024 ** 2)} Mo`);

/* ------------------------------ Cache local ------------------------------ */

const CACHE_KEY = 'krousty.videoAnalysis.v1';

export function readCache(): Record<string, VideoAnalysis> {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
  } catch {
    return {};
  }
}

export function writeCache(cache: Record<string, VideoAnalysis>) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* stockage indisponible */
  }
}

/* ------------------------------ Usage sur les murs ------------------------------ */


/**
 * Pour chaque vidéo diffusée : la résolution utile la plus exigeante parmi les murs qui la diffusent.
 * Une vidéo non diffusée est jugée par rapport au plus grand mur standard (2×2).
 */
export function targetsByUrl(screens: AppScreen[], configurations: Configuration[]) {
  const byConfig = new Map(configurations.map(c => [c.id, c]));
  const out = new Map<string, { width: number; height: number; walls: string[] }>();
  for (const s of screens) {
    const c = s.configuration_id ? byConfig.get(s.configuration_id) : undefined;
    if (!c) continue;
    const { rows, cols } = parseFormat(c.format);
    const t = wallTarget(cols, rows);
    for (const url of parsePlaylist(s.video_url)) {
      const cur = out.get(url);
      if (!cur) out.set(url, { ...t, walls: [s.id] });
      else {
        if (t.width * t.height > cur.width * cur.height) Object.assign(cur, t);
        if (!cur.walls.includes(s.id)) cur.walls.push(s.id);
      }
    }
  }
  return out;
}

export const DEFAULT_TARGET = wallTarget(2, 2);
