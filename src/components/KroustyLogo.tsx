import type { CSSProperties } from 'react';
import { cn } from './ui';

/**
 * Logo KROUSTY control reconstruit en vectoriel (repère 826 × 331, proportions du logo d'origine).
 * Chaque partie est un calque indépendant (ombre, plaque, bandeau, lettres)
 * pour pouvoir l'animer de l'intérieur. Sans `animated`, il s'affiche dans son état final.
 */

const PLATE = '186,9 640,9 690,312 144,312';
const PLATE_SHADOW = '195,18 649,18 699,321 153,321';
const BANNER ='10,80 820,34 797,178 18,222';
// Même polygone que le bandeau, en pourcentages (pour découper le reflet).
const BANNER_CLIP = 'polygon(1.2% 24.2%, 99.3% 10.3%, 96.5% 53.8%, 2.2% 67.1%)';

const TOP = 'KROUSTY'.split('');
const BOTTOM = 'control'.split('');

export default function KroustyLogo({ animated = false, className }: { animated?: boolean; className?: string }) {
  return (
    <div className={cn('kl', animated && 'is-animated', className)} role="img" aria-label="Krousty Control">
      <svg className="kl-shapes" viewBox="0 0 826 331" aria-hidden>
        <polygon className="kl-shadow" points={PLATE_SHADOW} fill="#a82546" stroke="#a82546" strokeWidth="16" strokeLinejoin="round" />
        <g className="kl-plate">
          <polygon points={PLATE} fill="#fff" stroke="#fff" strokeWidth="24" strokeLinejoin="round" />
          <polygon points={PLATE} fill="#b74b1b" stroke="#b74b1b" strokeWidth="16" strokeLinejoin="round" />
        </g>
        <polygon className="kl-banner" points={BANNER} fill="#b74b1b" stroke="#b74b1b" strokeWidth="12" strokeLinejoin="round" />
      </svg>

      <div className="kl-shine" style={{ clipPath: BANNER_CLIP, WebkitClipPath: BANNER_CLIP }} aria-hidden />

      <div className="kl-top" aria-hidden>
        {TOP.map((l, i) => (
          <span key={i} className="kl-letter" style={{ '--i': i } as CSSProperties}>
            {l}
          </span>
        ))}
      </div>

      <div className="kl-bottom" aria-hidden>
        {BOTTOM.map((l, i) => (
          <span key={i} className="kl-sub" style={{ '--i': i } as CSSProperties}>
            {l}
          </span>
        ))}
      </div>
    </div>
  );
}
