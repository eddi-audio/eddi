import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Built on the Mac, served statically by backend/serve_build.py from
// frontend/build/ on the Pi. Relative base so assets resolve from the build
// root regardless of path. Single fixed 480x800 kiosk target.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'build',
    assetsInlineLimit: 4096,
    chunkSizeWarningLimit: 1200,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.js',
    css: false,
  },
})
