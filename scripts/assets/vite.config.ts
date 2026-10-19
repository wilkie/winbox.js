import { defineConfig } from 'vite';

/**
 * Bundles the asset bundle's scripts for Node, as `scripts/rust/` is: they
 * run the maker in `src/assets/` through the same transpiler the emulator
 * goes through. `pnpm assets` builds them and runs the maker; the others
 * run from `dist/assets/` afterwards.
 */
export default defineConfig({
  build: {
    ssr: true,
    outDir: 'dist/assets',
    emptyOutDir: true,
    target: 'node22',
    minify: false,
    rollupOptions: {
      input: {
        'known-media': 'scripts/assets/known-media.mjs',
      },
    },
  },
});
