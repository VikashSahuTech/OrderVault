import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

declare const process: { env: Record<string, string | undefined> }

// GitHub Pages serves this app from https://<user>.github.io/OrderVault/, so the deploy workflow sets
// BASE_PATH=/OrderVault/. Locally and on a root domain it stays '/'.
const base = process.env.BASE_PATH || '/'

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['vault.svg'],
      manifest: {
        name: 'OrderVault',
        short_name: 'OrderVault',
        description: 'Private local-first shopping order tracker',
        theme_color: '#0b1020',
        background_color: '#0b1020',
        display: 'standalone',
        start_url: base,
        scope: base,
        icons: [{ src: 'vault.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }]
      },
      workbox: { navigateFallback: `${base}index.html` }
    })
  ],
  server: { port: 5173 }
})
