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

  /* `run.html?engine=rust` imports the Rust engine's module from where
   * `pnpm build:web` writes it, `/target/winbox-web/`, served from the root
   * like any file; it is not bundled, and the page is not part of `pnpm
   * build`. The rest of `target/` is cargo's, too large and too busy to
   * watch, so it is not; a module built again is seen when the page is
   * reloaded. */
  server: {
    port: 5173,
    watch: { ignored: ['**/target/**'] },
  },
});
