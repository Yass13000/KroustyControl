import type { CSSProperties } from 'react';

/**
 * Mot « SYNK » dessiné sur mesure (aucune police) : traits épais à terminaisons arrondies,
 * comme les écrans arrondis du symbole. Signature : une fine coupure horizontale traverse
 * tout le mot à mi-hauteur — la même séparation que celle du mur d'écrans.
 *
 * Repère : 0 0 300 100 (hauteur de capitale 10 → 90).
 */

export const WORD_VIEWBOX = '0 0 274 100';
const STROKE = 17;
/** Bande de coupure (mi-hauteur) */
const CUT = { y: 47.5, h: 4 };

/** Tracés des 4 lettres (axes des traits). */
export const LETTERS = [
  // S : deux courbes reliées par une diagonale franche (la coupure la traverse en biais)
  'M 52 27 C 47 19.5, 38 18.5, 31.5 18.5 C 20 18.5, 13 25, 13 33.5 C 13 42, 20 45.5, 31 48.5 C 43 51.5, 52 55, 52 65.5 C 52 75, 44.5 81.5, 32 81.5 C 24 81.5, 15.5 79, 11.5 72.5',
  // Y : deux bras qui se rejoignent sous la coupure, puis le fût
  'M 79 18.5 L 100 55 M 121 18.5 L 100 55 L 100 81.5',
  // N
  'M 147 81.5 L 147 18.5 L 189 81.5 L 189 18.5',
  // K : fût + deux bras qui se croisent sur le fût sous la coupure
  'M 217 18.5 L 217 81.5 M 259 18.5 L 219 58 M 224 53 L 261 81.5',
];

export default function SynkWordmark({
  color = '#fff',
  className,
  animated = false,
  idPrefix = 'wm',
}: {
  color?: string;
  className?: string;
  animated?: boolean;
  idPrefix?: string;
}) {
  const maskId = `${idPrefix}-cut`;
  return (
    <svg viewBox="0 0 274 100" className={className} role="img" aria-label="SYNK">
      <defs>
        <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="274" height="100">
          <rect width="274" height="100" fill="#fff" />
          <rect x="0" y={CUT.y} width="274" height={CUT.h} fill="#000" />
        </mask>
      </defs>
      <g mask={`url(#${maskId})`} fill="none" stroke={color} strokeWidth={STROKE} strokeLinecap="round" strokeLinejoin="round">
        {LETTERS.map((d, i) => (
          <path key={i} d={d} className={animated ? 'wm-letter' : undefined} style={animated ? ({ '--i': i } as CSSProperties) : undefined} />
        ))}
      </g>
    </svg>
  );
}
