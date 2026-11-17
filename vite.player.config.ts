import { defineConfig } from 'vite'

/**
 * Lecteur web SYNK (/tv) : construit à part, en un seul script classique (pas de module ES),
 * pour les navigateurs anciens des écrans pro (LG webOS Signage 4.0 ≈ Chromium 53, Samsung Tizen).
 */
export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'dist/tv',
    emptyOutDir: true,
    target: 'chrome53',
    cssTarget: 'chrome53',
    minify: 'esbuild',
    lib: {
      entry: 'src/player/main.ts',
      formats: ['iife'],
      name: 'SynkPlayer',
      fileName: () => 'player.js',
    },
    rollupOptions: {
      output: { assetFileNames: 'player.[ext]' },
    },
  },
})
