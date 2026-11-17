import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // Les écrans Samsung pro (Tizen) ont des navigateurs plus anciens : syntaxe compatible.
    target: 'es2017',
    // Le lecteur web (/tv) est construit à part : voir vite.player.config.ts.
  },
})
