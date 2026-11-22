/**
 * Build-time constants replaced by Vite `define` (vite.config.ts).
 */

/** True in `pnpm dev` and tests (the sample backend is bundled), false in the production desktop build. */
declare const __SAMPLE_BACKEND__: boolean

/** True in the production desktop build only: warm up common screens once the window is idle. */
declare const __IDLE_PREFETCH__: boolean
