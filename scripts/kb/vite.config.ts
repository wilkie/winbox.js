import { defineConfig } from 'vite';

/**
 * Bundles the knowledge base build, which is TypeScript, for Node. It runs no
 * engine: the export tables and the signatures are files in `kb/data`, and
 * the Rust engine's source is read as text (`rustdoc.ts`). `npm run kb`
 * builds this and then runs it.
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
