import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // Offline: the app shell is precached by our own service worker (src/sw.ts); model data is
    // cached when you save your area for offline (src/offline/pack.ts) or as you look around.
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'prompt',          // never reload the page under someone mid-emergency
      injectRegister: false,           // registered in src/offline/register.ts
      manifest: {
        name: 'HighGround: Chennai flood answers',
        short_name: 'HighGround',
        description: 'Where floodwater will go tonight in Chennai, street by street, and what to do about it. Works offline once saved.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#050D12',
        theme_color: '#050D12',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      injectManifest: {
        // .mjs: MapLibre's worker (Workbox's default list misses it, and the map would not start offline)
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,woff2,pbf,json,webmanifest}'],
        // Latin only: Devanagari and Vietnamese font files are never used by an English page
        globIgnores: ['data/**', '**/node_modules/**', '**/*devanagari*', '**/*vietnamese*'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        rollupFormat: 'iife',            // a classic worker: module service workers are not in every browser yet
      },
      devOptions: { enabled: false },
    }),
  ],
})
