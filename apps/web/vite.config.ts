import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      injectManifest: {
        // Do NOT precache index.html — the SW serves it with a NetworkFirst
        // navigation handler so a freshly deployed build is never hidden
        // behind a stale cached shell.
        globPatterns: ['**/*.{js,css,svg,png,ico,webmanifest}'],
      },
      manifest: {
        name: 'home-os',
        short_name: 'home-os',
        description: 'Household OS: todos, meal planning, recipes, calendar.',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        start_url: '/',
        icons: [],
      },
    }),
  ],
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: ['pi4.tailebbd07.ts.net'],
    proxy: {
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
      '/auth': { target: 'http://localhost:4000', changeOrigin: true },
      '/health': { target: 'http://localhost:4000', changeOrigin: true },
    },
  },
});
