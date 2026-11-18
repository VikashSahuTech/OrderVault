import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
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
        start_url: '/',
        icons: [{ src: '/vault.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }]
      },
      workbox: { navigateFallback: '/index.html' }
    })
  ],
  server: { port: 5173 }
})
