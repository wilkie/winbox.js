import { defineConfig } from 'vite';

/* The build produces a single `winbox.js` bundle holding the emulator, which
 * sets `window.Win16`. The repository root doubles as the dev-server root, and
 * `pnpm dev` serves the page for running programs at `/run.html`.
 */
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    target: 'es2022',
    lib: {
      entry: { winbox: 'src/shim.ts' },
      formats: ['es'],
      fileName: (_format, name) => `${name}.js`,
    },
  },

  server: {
    port: 5173,
  },
});
