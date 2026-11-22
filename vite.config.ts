import { defineConfig } from 'vite'
import { configDefaults } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  // Relative asset paths: Tauri serves `dist/` (frontendDist) from its own
  // custom protocol, not from the site root of a web server
  base: './',
  // Keep Rust compile errors from tauri dev visible in the terminal
  clearScreen: false,
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { port: 5173, strictPort: true },
  build: {
    // Every screen is its own chunk; the largest ones left are ELK (elk-worker, and
    // elk.bundled, the in-thread fallback when no Worker is available), about 1.5 MB
    // each, loaded only when the Nodes canvas lays out a graph. They come from disk
    // inside the desktop app, so the 500 kB web default would only warn about them.
    chunkSizeWarningLimit: 1700,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    // Full-page tests can exceed Vitest's 5 s default when the machine is busy
    testTimeout: 15_000,
    // Agent worktrees under .claude/ hold other copies of the repo
    exclude: [...configDefaults.exclude, '.claude/**', 'src-tauri/**'],
  },
})
