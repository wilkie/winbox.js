import { defineConfig } from 'vite';

/**
 * Bundles the Rust engine's table writer for Node, as `scripts/kb/` is: it
 * reads the emulator's own export tables, so it runs through the same
 * transpiler the emulator does. `npm run rust:modules` builds and runs it.
 */
export default defineConfig({
  build: {
    ssr: 'scripts/rust/modules.ts',
    outDir: 'dist/rust-modules',
    emptyOutDir: true,
    target: 'node22',
    minify: false,
  },
});
