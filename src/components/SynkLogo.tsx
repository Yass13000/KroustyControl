import { useId } from 'react';
import { cn } from './ui';
import { LETTERS } from './SynkWordmark';

/**
 * Identité SYNK — symbole : un mur de 4 écrans (2×2) traversé par un S continu
 * qui les relie (la synchronisation). Vectoriel, net à toutes les tailles.
 *
 * Variantes :
 *  - onBrand : sur fond orange (écrans blancs, S orange, texte blanc)
 *  - onDark  : sur fond sombre (écrans orange, S blanc, texte blanc)
 *  - onLight : sur fond clair  (écrans orange, S blanc, texte encre)
 */

export type SynkVariant = 'onBrand' | 'onDark' | 'onLight';

/** Les 4 écrans du symbole (repère 100 × 100). */
export const SYNK_TILES = [
  { x: 4, y: 4 },
  { x: 52, y: 4 },
  { x: 4, y: 52 },
  { x: 52, y: 52 },
] as const;
export const SYNK_TILE = 44;
export const SYNK_RADIUS = 11;
/**
 * Anneau de synchronisation (deux flèches qui tournent) centré sur le mur :
 * les séparations entre écrans le découpent, comme une image étalée sur 4 écrans.
 */
export const SYNK_RING = { cx: 50, cy: 50, r: 26 };
export const SYNK_S_WIDTH = 11;
/** Deux arcs (haut-droite → bas, bas-gauche → haut), sens horaire. */
export const SYNK_ARCS = [
  'M 25.3 42.0 A 26 26 0 0 1 70.5 34.0',
  'M 74.7 58.0 A 26 26 0 0 1 29.5 66.0',
];
/** Pointes de flèche au bout de chaque arc. */
export const SYNK_HEADS = ['M 77.2 28.8 L 76.6 41.9 L 63.8 39.2 Z', 'M 22.8 71.2 L 23.4 58.1 L 36.2 60.8 Z'];
/** Compatibilité : tracé unique (utilisé par le splash pour l'animation de dessin). */
export const SYNK_S_PATH = SYNK_ARCS.join(' ');

const ORANGE_A = '#ff8a3d';
const ORANGE_B = '#e85a0c';

function palette(variant: SynkVariant) {
  if (variant === 'onBrand') return { tileA: '#ffffff', tileB: '#fff3ea', s: 'url(#S)', word: '#ffffff', sA: ORANGE_A, sB: '#c94e05' };
  return { tileA: ORANGE_A, tileB: ORANGE_B, s: '#ffffff', word: variant === 'onDark' ? '#ffffff' : '#2a1209', sA: '', sB: '' };
}

/** Symbole seul (carré). */
export function SynkMark({ variant = 'onDark', className, title = 'SYNK' }: { variant?: SynkVariant; className?: string; title?: string }) {
  const id = useId().replace(/:/g, '');
  const p = palette(variant);
  return (
    <svg viewBox="0 0 100 100" className={className} role="img" aria-label={title}>
      <MarkDefs id={id} p={p} />
      <MarkBody id={id} p={p} />
    </svg>
  );
}

/** Logo complet : symbole + mot SYNK dessiné sur mesure (aucune police). */
export default function SynkLogo({ variant = 'onBrand', className }: { variant?: SynkVariant; className?: string }) {
  const id = useId().replace(/:/g, '');
  const p = palette(variant);
  return (
    <svg viewBox="0 0 398 100" className={cn('block', className)} role="img" aria-label="SYNK">
      <MarkDefs id={id} p={p} />
      <MarkBody id={id} p={p} />
      <svg x="124" y="0" width="274" height="100" viewBox="0 0 274 100" overflow="visible">
        <defs>
          {/* Signature : la même coupure que le mur d'écrans traverse tout le mot */}
          <mask id={`${id}-cut`} maskUnits="userSpaceOnUse" x="-10" y="0" width="294" height="100">
            <rect x="-10" width="294" height="100" fill="#fff" />
            <rect x="-10" y="47.5" width="294" height="4" fill="#000" />
          </mask>
        </defs>
        <g mask={`url(#${id}-cut)`} fill="none" stroke={p.word} strokeWidth={17} strokeLinecap="round" strokeLinejoin="round">
          {LETTERS.map((d, i) => (
            <path key={i} d={d} />
          ))}
        </g>
      </svg>
    </svg>
  );
}

function MarkDefs({ id, p }: { id: string; p: ReturnType<typeof palette> }) {
  return (
    <defs>
      {/* Le S n'est visible qu'à travers les écrans : les séparations le découpent, comme une vidéo sur un mur. */}
      <clipPath id={`${id}-clip`}>
        {SYNK_TILES.map((t, i) => (
          <rect key={i} x={t.x} y={t.y} width={SYNK_TILE} height={SYNK_TILE} rx={SYNK_RADIUS} />
        ))}
      </clipPath>
      <linearGradient id={`${id}-tile`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor={p.tileA} />
        <stop offset="1" stopColor={p.tileB} />
      </linearGradient>
      {p.sA && (
        <linearGradient id={`${id}-s`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={p.sA} />
          <stop offset="1" stopColor={p.sB} />
        </linearGradient>
      )}
    </defs>
  );
}

function MarkBody({ id, p }: { id: string; p: ReturnType<typeof palette> }) {
  return (
    <g>
      {SYNK_TILES.map((t, i) => (
        <rect key={i} x={t.x} y={t.y} width={SYNK_TILE} height={SYNK_TILE} rx={SYNK_RADIUS} fill={`url(#${id}-tile)`} />
      ))}
      <g clipPath={`url(#${id}-clip)`} fill={p.s === 'url(#S)' ? `url(#${id}-s)` : p.s} stroke={p.s === 'url(#S)' ? `url(#${id}-s)` : p.s}>
        {SYNK_ARCS.map((d, i) => (
          <path key={i} d={d} fill="none" strokeWidth={SYNK_S_WIDTH} strokeLinecap="round" />
        ))}
        {SYNK_HEADS.map((d, i) => (
          <path key={i} d={d} stroke="none" />
        ))}
      </g>
    </g>
  );
}
