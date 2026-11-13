import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // Les écrans Samsung pro (Tizen) ont des navigateurs plus anciens : syntaxe compatible.
    target: 'es2017',
    rollupOptions: {
      input: {
        main: 'index.html',
        // Lecteur web des écrans sans Android (page séparée, sans la clé d'administration).
        player: 'player.html',
      },
    },
  },
})
