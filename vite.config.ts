import { defineConfig } from 'vite';

/* The build produces the same artifact webpack used to emit: a single
 * `winbox.js` bundle holding the entire project namespace, plus a `winbox.css`
 * containing every stylesheet. The repository root doubles as the dev-server
 * root so `pnpm dev` serves the demo page in `index.html`.
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
      cssFileName: 'winbox',
    },
  },

  server: {
    port: 5173,
  },
});
