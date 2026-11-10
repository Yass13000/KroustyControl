import { SYNK_ARCS, SYNK_HEADS, SYNK_RADIUS, SYNK_S_WIDTH, SYNK_TILE, SYNK_TILES } from './SynkLogo';
import SynkWordmark from './SynkWordmark';
import type { CSSProperties } from 'react';

/**
 * Splash SYNK :
 *  1. un écran s'allume puis se multiplie en mur 2×2,
 *  2. les flèches de synchronisation se dessinent à travers les écrans,
 *  3. elles font un tour complet (la synchro), toujours découpées par les écrans,
 *  4. le mot SYNK (lettres dessinées sur mesure) apparaît lettre par lettre.
 * Animations CSS uniquement (aucune image, aucun calcul lourd).
 */
export default function Splash({ leaving }: { leaving: boolean }) {
  return (
    <div className={`splash ${leaving ? 'is-leaving' : ''}`} aria-hidden={leaving} role="status" aria-label="Chargement de SYNK">
      <div className="splash-halo" />

      <div className="splash-lockup">
        <svg viewBox="-4 -4 108 108" className="splash-mark" aria-hidden>
          <defs>
            <linearGradient id="sp-tile" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#ff8a3d" />
              <stop offset="1" stopColor="#e85a0c" />
            </linearGradient>
            <clipPath id="sp-clip">
              {SYNK_TILES.map((t, i) => (
                <rect key={i} x={t.x} y={t.y} width={SYNK_TILE} height={SYNK_TILE} rx={SYNK_RADIUS} />
              ))}
            </clipPath>
            <linearGradient id="sp-sheen" x1="0" x2="1">
              <stop offset="0" stopColor="#fff" stopOpacity="0" />
              <stop offset="0.5" stopColor="#fff" stopOpacity="0.45" />
              <stop offset="1" stopColor="#fff" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Les 4 écrans : partent tous du centre, puis prennent leur place */}
          {SYNK_TILES.map((t, i) => (
            <rect
              key={i}
              className="sp-tile"
              style={{ '--dx': `${50 - (t.x + SYNK_TILE / 2)}px`, '--dy': `${50 - (t.y + SYNK_TILE / 2)}px`, '--i': i } as CSSProperties}
              x={t.x}
              y={t.y}
              width={SYNK_TILE}
              height={SYNK_TILE}
              rx={SYNK_RADIUS}
              fill="url(#sp-tile)"
            />
          ))}

          {/* Flèches de synchronisation, visibles uniquement à travers les écrans */}
          <g clipPath="url(#sp-clip)">
            <g className="sp-arrows">
              {SYNK_ARCS.map((d, i) => (
                <path key={i} className="sp-arc" d={d} pathLength={1} fill="none" stroke="#fff" strokeWidth={SYNK_S_WIDTH} strokeLinecap="round" />
              ))}
              {SYNK_HEADS.map((d, i) => (
                <path key={i} className="sp-head" d={d} fill="#fff" />
              ))}
            </g>
            {/* Reflet qui balaie le mur */}
            <rect className="sp-sheen" x="-40" y="-10" width="30" height="120" fill="url(#sp-sheen)" />
          </g>
        </svg>

        <SynkWordmark className="splash-word" animated idPrefix="splash" />
      </div>
    </div>
  );
}
