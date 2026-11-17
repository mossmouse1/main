/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  resolve: {
    alias: {
      // 웹과 Edge Function이 함께 쓰는 순수 TS 코드(Darwin Core 매핑 등)
      '@shared': fileURLToPath(new URL('../BE/supabase/functions/_shared', import.meta.url)),
    },
  },
  // 나중에 불러오는 모듈도 개발 서버 시작 때 미리 묶습니다(실행 중 발견되면 페이지가 새로고침됨).
  optimizeDeps: {
    include: ['exifr/dist/lite.esm.mjs', 'heic2any'],
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // 서비스 워커는 앱 화면·지도·콘텐츠 캐시만 맡습니다.
      // 전송 대기열은 iOS 웹뷰를 위해 서비스 워커 없이 IndexedDB만으로 동작합니다.
      includeAssets: ['icons/icon.svg', 'map/*'],
      manifest: {
        name: '우리 공원 생명 도감',
        short_name: '공원 도감',
        lang: 'ko',
        start_url: '/',
        display: 'standalone',
        background_color: '#f6f8f2',
        theme_color: '#1f6b3a',
        icons: [{ src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
      },
      workbox: {
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/admin/],
        globPatterns: ['**/*.{js,css,html,svg,png}'],
        // heic2any는 HEIC 변환이 필요할 때만, 생물 사진은 볼 때 받아 둡니다(첫 접속 데이터 절약).
        globIgnores: ['**/heic2any-*.js', '**/photos/**'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/content/'),
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'content' },
          },
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/photos/'),
            handler: 'CacheFirst',
            options: { cacheName: 'photos', expiration: { maxEntries: 300 } },
          },
          {
            // 블록 글꼴(Do Hyeon): 한 번 받으면 공원에서 연결이 끊겨도 씁니다.
            urlPattern: ({ url }) => url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com',
            handler: 'CacheFirst',
            options: { cacheName: 'google-fonts', expiration: { maxEntries: 60 }, cacheableResponse: { statuses: [0, 200] } },
          },
          {
            urlPattern: ({ url }) => url.hostname === 'cdn.jsdelivr.net' && url.pathname.includes('pretendard'),
            handler: 'CacheFirst',
            options: { cacheName: 'fonts', expiration: { maxEntries: 200 }, cacheableResponse: { statuses: [0, 200] } },
          },
        ],
      },
    }),
  ],
  build: {
    target: ['es2020', 'safari16'],
    // PRD 예산은 gzip 250KB입니다. 경고 기준(압축 전)만 그에 맞춰 올립니다.
    chunkSizeWarningLimit: 700,
  },
  test: {
    include: ['src/**/*.test.ts', '../BE/supabase/functions/_shared/**/*.test.ts'],
  },
});
