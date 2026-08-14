import { defineConfig } from 'vite';

/**
 * Bundles the benchmark for Node.
 *
 * The benchmark has to run through the same build the library does, or it
 * measures the transpiler rather than the emulator. Jest's transform would do,
 * but it wraps every module in its own machinery; this produces the same shape
 * of output the browser gets.
 */
export default defineConfig({
  build: {
    ssr: 'bench/cpu.ts',
    outDir: 'dist/bench',
    emptyOutDir: true,
    target: 'node22',
    minify: false,
  },
});
