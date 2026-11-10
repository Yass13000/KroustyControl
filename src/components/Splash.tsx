import { useEffect, useRef } from 'react';

/**
 * Splash « mur vidéo » :
 *  1. un écran s'allume et lit une vidéo,
 *  2. il se multiplie en un mur 2×2,
 *  3. la même vidéo s'étire sur les 4 écrans,
 *  4. le logo KROUSTY apparaît à travers tout le mur, puis un reflet le balaie.
 * Tout est en SVG animé (SMIL) : net à toutes les tailles, aucune vidéo à charger.
 */

// Mur final : 4 écrans 16:9 de 176×99, séparés de 8 px. Centre du mur : (200, 130).
const W = 176;
const H = 99;
const SCREENS = [
  { x: 20, y: 27 },
  { x: 204, y: 27 },
  { x: 20, y: 134 },
  { x: 204, y: 134 },
];
const START = { x: 112, y: 81 }; // écran unique, centré
const CX = 200;
const CY = 130;
const SINGLE_SCALE = W / 360; // la vidéo tient d'abord dans un seul écran…

// Chronologie (secondes)
const T_SPLIT = 1.05; // …puis l'écran se multiplie
const D_SPLIT = 0.75;
const T_LOGO = 1.85;
const EASE = '0.65 0 0.35 1';

const moveAttrs = (to: { x: number; y: number }, i: number) => {
  const begin = T_SPLIT + i * 0.05;
  return [
    <animate key="x" attributeName="x" from={START.x} to={to.x} begin={`${begin}s`} dur={`${D_SPLIT}s`} fill="freeze" calcMode="spline" keyTimes="0;1" keySplines={EASE} />,
    <animate key="y" attributeName="y" from={START.y} to={to.y} begin={`${begin}s`} dur={`${D_SPLIT}s`} fill="freeze" calcMode="spline" keyTimes="0;1" keySplines={EASE} />,
  ];
};

export default function Splash({ leaving }: { leaving: boolean }) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    // Repart de zéro au montage ; image finale directe si l'utilisateur réduit les animations.
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    svg.setCurrentTime(reduce ? 3 : 0);
    if (reduce) svg.pauseAnimations();
    else svg.unpauseAnimations();
  }, []);

  return (
    <div className={`splash ${leaving ? 'is-leaving' : ''}`} aria-hidden={leaving} role="status" aria-label="Chargement de KroustyControl">
      <svg ref={svgRef} className="splash-wall-svg" viewBox="0 0 400 330" aria-hidden>
        <defs>
          {/* « Vidéo » : dégradé chaud qui défile */}
          <linearGradient id="sp-video" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#2b1209" />
            <stop offset="0.45" stopColor="#b74b1b" />
            <stop offset="1" stopColor="#ff8a3d" />
            <animateTransform attributeName="gradientTransform" type="translate" values="-0.25 0; 0.25 0; -0.25 0" dur="4s" repeatCount="indefinite" />
          </linearGradient>
          <linearGradient id="sp-sweep" x1="0" x2="1">
            <stop offset="0" stopColor="#fff" stopOpacity="0" />
            <stop offset="0.5" stopColor="#fff" stopOpacity="0.35" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          <radialGradient id="sp-glow">
            <stop offset="0" stopColor="#ff751f" stopOpacity="0.55" />
            <stop offset="1" stopColor="#ff751f" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="sp-reflect-fade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0.45" stopColor="#fff" stopOpacity="0" />
            <stop offset="1" stopColor="#fff" stopOpacity="0.55" />
          </linearGradient>
          <mask id="sp-reflect-mask">
            {/* Le masque s'applique dans le repère du mur (avant retournement) : le bas du mur touche le sol */}
            <rect x="0" y="27" width="400" height="206" fill="url(#sp-reflect-fade)" />
          </mask>

          {/* Les 4 « fenêtres » : la vidéo n'est visible qu'à travers les écrans */}
          <clipPath id="sp-screens">
            {SCREENS.map((s, i) => (
              <rect key={i} x={START.x} y={START.y} width={W} height={H} rx="5">
                {moveAttrs(s, i)}
              </rect>
            ))}
          </clipPath>

          <g id="sp-wall">
            {/* Contenu vidéo, d'abord à l'échelle d'un écran puis étiré sur le mur */}
            <g clipPath="url(#sp-screens)">
              <g transform={`translate(${CX} ${CY})`}>
                <g transform={`scale(${SINGLE_SCALE})`}>
                  <animateTransform
                    attributeName="transform"
                    type="scale"
                    from={SINGLE_SCALE}
                    to="1"
                    begin={`${T_SPLIT}s`}
                    dur={`${D_SPLIT + 0.15}s`}
                    fill="freeze"
                    calcMode="spline"
                    keyTimes="0;1"
                    keySplines={EASE}
                  />
                  <g transform={`translate(${-CX} ${-CY})`}>
                    <rect x="20" y="27" width="360" height="206" fill="url(#sp-video)" />

                    {/* Particules lumineuses */}
                    {[
                      [70, 70, 18, 0],
                      [300, 90, 26, 0.6],
                      [180, 190, 14, 1.2],
                      [340, 200, 20, 0.3],
                      [110, 160, 10, 0.9],
                    ].map(([x, y, r, d], i) => (
                      <circle key={i} cx={x} cy={y} r={r} fill="#ffd2a8" opacity="0.18">
                        <animate attributeName="cy" values={`${y};${y - 18};${y}`} dur="3s" begin={`${d}s`} repeatCount="indefinite" />
                        <animate attributeName="opacity" values="0.08;0.28;0.08" dur="3s" begin={`${d}s`} repeatCount="indefinite" />
                      </circle>
                    ))}

                    {/* Faisceau de lumière qui traverse l'image en boucle */}
                    <rect x="-120" y="0" width="110" height="260" fill="url(#sp-sweep)" transform="skewX(-20)">
                      <animateTransform attributeName="transform" type="translate" values="0 0; 620 0" dur="1.8s" repeatCount="indefinite" additive="sum" />
                    </rect>

                    {/* La vidéo s'assombrit pour laisser le logo ressortir */}
                    <rect x="20" y="27" width="360" height="206" fill="#140a06" opacity="0">
                      <animate attributeName="opacity" from="0" to="0.55" begin={`${T_LOGO - 0.1}s`} dur="0.5s" fill="freeze" />
                    </rect>

                    {/* Logo qui apparaît à travers les 4 écrans */}
                    <g opacity="0">
                      <set attributeName="opacity" to="1" begin={`${T_LOGO}s`} />
                      <g transform="translate(200 130)">
                        <g>
                          <animateTransform
                            attributeName="transform"
                            type="scale"
                            values="0.6;1.06;1"
                            keyTimes="0;0.7;1"
                            begin={`${T_LOGO}s`}
                            dur="0.6s"
                            fill="freeze"
                          />
                          <svg x="-150" y="-60" width="300" height="120" viewBox="0 0 826 331" overflow="visible">
                            <polygon points="195,18 649,18 699,321 153,321" fill="#a82546" stroke="#a82546" strokeWidth="16" strokeLinejoin="round" />
                            <polygon points="186,9 640,9 690,312 144,312" fill="#fff" stroke="#fff" strokeWidth="24" strokeLinejoin="round" />
                            <polygon points="186,9 640,9 690,312 144,312" fill="#b74b1b" stroke="#b74b1b" strokeWidth="16" strokeLinejoin="round" />
                            <polygon points="10,80 820,34 797,178 18,222" fill="#b74b1b" stroke="#b74b1b" strokeWidth="12" strokeLinejoin="round" />
                            <text
                              transform="translate(30 203) rotate(-3.2) scale(1 1.27)"
                              textLength="760"
                              lengthAdjust="spacingAndGlyphs"
                              fontFamily="Rubik, Outfit, system-ui, sans-serif"
                              fontWeight="900"
                              fontSize="154"
                              fill="#fff"
                            >
                              KROUSTY
                            </text>
                            <text
                              transform="translate(244 262) rotate(-2.2) scale(1 1.15)"
                              textLength="347"
                              lengthAdjust="spacingAndGlyphs"
                              fontFamily="Rubik, Outfit, system-ui, sans-serif"
                              fontWeight="900"
                              fontSize="99"
                              fill="#fff"
                            >
                              control
                            </text>
                          </svg>
                        </g>
                      </g>
                    </g>

                    {/* Barre de lecture, qui s'étire elle aussi avec la vidéo */}
                    <rect x="34" y="221" width="332" height="3" rx="1.5" fill="#fff" opacity="0.25" />
                    <rect x="34" y="221" width="0" height="3" rx="1.5" fill="#fff" opacity="0.9">
                      <animate attributeName="width" from="0" to="332" dur="3s" fill="freeze" />
                    </rect>
                  </g>
                </g>
              </g>
            </g>

            {/* Cadres des écrans (bords noirs fins) */}
            {SCREENS.map((s, i) => (
              <rect key={i} x={START.x} y={START.y} width={W} height={H} rx="5" fill="none" stroke="#0b0604" strokeWidth="2.5">
                {moveAttrs(s, i)}
              </rect>
            ))}
          </g>
        </defs>

        {/* Halo derrière le mur, qui s'intensifie quand il s'agrandit */}
        <ellipse cx="200" cy="130" rx="150" ry="110" fill="url(#sp-glow)" opacity="0.5">
          <animate attributeName="rx" values="110;230" begin={`${T_SPLIT}s`} dur={`${D_SPLIT}s`} fill="freeze" />
          <animate attributeName="ry" values="80;160" begin={`${T_SPLIT}s`} dur={`${D_SPLIT}s`} fill="freeze" />
          <animate attributeName="opacity" values="0;0.5;0.9" keyTimes="0;0.3;1" dur="2.2s" fill="freeze" />
        </ellipse>

        {/* Le mur et son reflet au sol */}
        <g className="splash-wall-in">
          <use href="#sp-wall" />
          <use href="#sp-wall" transform="translate(0 466) scale(1 -1)" mask="url(#sp-reflect-mask)" opacity="0.6" />
        </g>
      </svg>
    </div>
  );
}
