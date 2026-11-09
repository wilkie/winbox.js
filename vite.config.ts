import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/** Where `pnpm build` writes the page, a folder served as it is (`pnpm preview`). */
const OUT = 'dist/web';

/** Where `pnpm build:web` writes the Rust engine's module, and the files of it the page loads. */
const MODULE = 'target/winbox-web';
const MODULE_FILES = ['winbox_web.js', 'winbox_web_bg.wasm'];

/* The repository root is the dev server's root: `pnpm dev` serves the page
 * for running programs at `/run.html`. `pnpm build` writes it, bundled, with
 * the engine's module, to `dist/web`, beside the other builds' folders
 * (`dist/kb`, `dist/assets`), which it leaves alone.
 */
export default defineConfig({
  /* `run.html` imports the Rust engine's module from where
   * `pnpm build:web` writes it, `/target/winbox-web/`, served from the root
   * like any file; it is not bundled. The rest of `target/` is cargo's,
   * too large and too busy to watch, so it is not (`busy`).
   *
   * That folder is watched all the same. The server keeps each module it
   * has transformed, the module's glue among them, until the watcher tells
   * it the file changed; unwatched, a server left running serves the glue
   * of whatever build it first served, beside the `.wasm` of the latest,
   * which it reads afresh each time. Built again, a module's glue that
   * lacks a getter the page asks for answers `undefined`: on 2026-10-06 a
   * server started before the FM chip's samples came (e79875ef) served a
   * glue without `SoundEvent.samples`, `sound.ts` let every FM piece go,
   * and e2e/run.spec.ts's "sounds the FM chip" timed out with the probe
   * finished; a server started afresh passed it. */
  server: {
    port: 5173,
    watch: { ignored: [busy] },
  },
  build: {
    outDir: OUT,
    emptyOutDir: true,
    rollupOptions: { input: { run: resolve(import.meta.dirname, 'run.html') } },
  },
  plugins: [engineModule()],
});

/** Whether a path is in cargo's `target/` and not where `pnpm build:web` writes the module. */
function busy(path: string): boolean {
  return /[\\/]target[\\/](?!winbox-web(?:[\\/]|$))/.test(path);
}

/**
 * The engine's module copied, as it is, into the built page's folder, at the
 * path the page loads it from (`/target/winbox-web/`): the page imports its
 * glue at run time (`src/run/engines/rust.ts`), so it is not bundled. A build
 * with no module to copy fails, as its page would have no engine.
 */
function engineModule(): Plugin {
  return {
    name: 'winbox-engine-module',
    apply: 'build',
    closeBundle() {
      const to = join(OUT, MODULE);

      mkdirSync(to, { recursive: true });

      for (const file of MODULE_FILES) {
        const from = join(MODULE, file);

        if (!existsSync(from)) {
          throw new Error(`${from} is not there: build it with \`pnpm build:web\``);
        }

        copyFileSync(from, join(to, file));
      }
    },
  };
}
