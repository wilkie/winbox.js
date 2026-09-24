import { defineConfig } from 'vite';

/**
 * Bundles the knowledge base build for Node, the way `bench/` is bundled: the
 * build reads the emulator's own export tables, so it runs through the same
 * transpiler the emulator does. `npm run kb` builds this and then runs it.
 */
export default defineConfig({
  build: {
    ssr: 'scripts/kb/build.ts',
    outDir: 'dist/kb-build',
    emptyOutDir: true,
    target: 'node22',
    minify: false,
  },
});
