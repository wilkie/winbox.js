import { defineConfig } from 'vite';

/* The repository root is the dev server's root: `pnpm dev` serves the page
 * for running programs at `/run.html`.
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
});

/** Whether a path is in cargo's `target/` and not where `pnpm build:web` writes the module. */
function busy(path: string): boolean {
  return /[\\/]target[\\/](?!winbox-web(?:[\\/]|$))/.test(path);
}
