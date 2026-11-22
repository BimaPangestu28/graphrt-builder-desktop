import { defineConfig } from 'vite'
import { configDefaults } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

/** Sample backend modules: only the browser preview and tests use them. */
function isSampleBackendModule(moduleId: string): boolean {
  return moduleId.includes('/src/api/sampleBackend/')
}

export default defineConfig(({ mode }) => ({
  // Relative asset paths: Tauri serves `dist/` (frontendDist) from its own
  // custom protocol, not from the site root of a web server
  base: './',
  // Keep Rust compile errors from tauri dev visible in the terminal
  clearScreen: false,
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  define: {
    // The production build is the desktop app, which always has the Rust backend:
    // every `if (__SAMPLE_BACKEND__ && !isDesktopApp())` branch in src/api becomes
    // dead code, and the sample backend and its fixtures drop out of the bundle.
    // `pnpm dev` (browser preview, tauri dev) and tests keep it.
    __SAMPLE_BACKEND__: JSON.stringify(mode !== 'production'),
  },
  server: { port: 5173, strictPort: true },
  build: {
    // Every screen is its own chunk; the largest ones left are ELK (elk-worker, and
    // elk.bundled, the in-thread fallback when no Worker is available), about 1.5 MB
    // each, loaded only when the Nodes canvas lays out a graph. They come from disk
    // inside the desktop app, so the 500 kB web default would only warn about them.
    chunkSizeWarningLimit: 1700,
    rollupOptions: {
      // Sample modules build their seed data at the top level; marking them free of
      // side effects lets Rollup drop them once nothing reads their exports.
      treeshake: { moduleSideEffects: (moduleId) => !isSampleBackendModule(moduleId) },
    },
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
}))
