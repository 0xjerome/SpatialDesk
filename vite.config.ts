import { iwsdkDev } from '@iwsdk/vite-plugin-dev';
import { defineConfig } from 'vite';

/**
 * SpatialDesk AI build configuration.
 *
 * `iwsdk.config.json` is the authority for scene, XR and emulator settings; this
 * file only wires the IWSDK plugin, the Preact JSX runtime and the dev proxy
 * for the AI API served by `server/index.js`.
 */
export default defineConfig(({ command }) => ({
  plugins: [
    // Emulator and XR settings live in iwsdk.config.json (the project authority).
    // HTTPS is required for WebXR on a physical headset over the LAN.
    iwsdkDev({ https: process.env.SPATIALDESK_DEV_HTTPS === 'false' ? false : true }),
  ],
  esbuild: {
    target: 'esnext',
    jsx: 'automatic',
    jsxImportSource: 'preact',
  },
  server: {
    host: '0.0.0.0',
    port: 8081,
    open: false,
    proxy: {
      '/api': {
        target: process.env.SPATIALDESK_API_ORIGIN ?? 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: command === 'build' && process.env.NODE_ENV !== 'production',
    target: 'esnext',
    rollupOptions: { input: './index.html' },
    // The immersive runtime (three.js, IWSDK, UIKit) is loaded on demand from
    // src/xr/world.ts; the warning threshold only applies to that chunk.
    chunkSizeWarningLimit: 6000,
  },
  // @drawcall/uikitml otherwise pulls a second three/@pmndrs/uikit graph.
  // Duplicate component classes break instanceof checks inside uikit.
  resolve: {
    dedupe: ['three', '@pmndrs/uikit', '@pmndrs/uikit-horizon', '@pmndrs/uikit-lucide', 'preact'],
  },
  optimizeDeps: {
    exclude: ['@babylonjs/havok'],
    include: [
      'three',
      '@pmndrs/uikit',
      '@pmndrs/uikit-horizon',
      '@pmndrs/uikit-lucide',
      '@drawcall/uikitml',
    ],
    esbuildOptions: { target: 'esnext' },
  },
  publicDir: 'public',
  base: './',
}));
