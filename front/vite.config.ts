import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // 운행 중 화면이 저절로 새로고침되지 않도록 새 버전은 사용자가 확인한 뒤 적용합니다.
      registerType: 'prompt',
      includeAssets: ['icons/icon.svg', 'icons/apple-touch-icon-180x180.png'],
      manifest: {
        id: '/',
        name: '넷레이더 | NetRadar',
        short_name: '넷레이더',
        description: '택시 기사님을 위한 택시 수요 급증 예보 서비스, 넷레이더',
        lang: 'ko',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        theme_color: '#ff7033',
        background_color: '#ffffff',
        categories: ['navigation', 'travel', 'business'],
        icons: [
          { src: 'icons/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // 앱 화면(정적 파일)만 미리 저장합니다.
        // API·Supabase 응답은 신선도 판정이 중요하므로 캐시하지 않고,
        // OpenStreetMap 타일은 이용 정책상 오프라인 저장을 하지 않습니다.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
