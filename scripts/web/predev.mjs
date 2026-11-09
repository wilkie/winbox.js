/**
 * Run by pnpm before `pnpm dev`: builds the page's engine, the Rust engine
 * for WebAssembly (`pnpm build:web`), where its module is missing or older
 * than the crates it is built from. The page has no other engine, and says
 * so where the module is not there (`src/run/page/machine.ts`).
 *
 * "Older" is by the files' times: the module against the newest source of
 * the crates the page's module is built from (every crate but the native
 * front end, their tests, examples and benches apart),
 * the workspace's `Cargo.toml` and `Cargo.lock`. A build that fails is told
 * and the server started all the same; the page then says the engine is not
 * built, or runs the module built before.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');
const MODULE = join(ROOT, 'target', 'winbox-web', 'winbox_web_bg.wasm');
const GLUE = join(ROOT, 'target', 'winbox-web', 'winbox_web.js');

/** Crates the page's module does not take in. */
const APART = new Set(['winbox-native']);

/** Folders of a crate that are not built into its library. */
const UNBUILT = new Set(['tests', 'examples', 'benches', 'target']);

/** The newest time a file under `path` was written. */
function newest(path) {
  const stat = statSync(path);

  if (!stat.isDirectory()) {
    return stat.mtimeMs;
  }

  let latest = 0;

  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (!(entry.isDirectory() && UNBUILT.has(entry.name))) {
      latest = Math.max(latest, newest(join(path, entry.name)));
    }
  }

  return latest;
}

function sources() {
  const crates = join(ROOT, 'crates');
  let latest = Math.max(newest(join(ROOT, 'Cargo.toml')), newest(join(ROOT, 'Cargo.lock')));

  for (const crate of readdirSync(crates)) {
    if (!APART.has(crate)) {
      latest = Math.max(latest, newest(join(crates, crate)));
    }
  }

  return latest;
}

const why =
  !existsSync(MODULE) || !existsSync(GLUE)
    ? 'is not built'
    : statSync(MODULE).mtimeMs < sources()
      ? 'is older than the crates'
      : null;

if (why) {
  console.log(`The page's engine ${why}: pnpm build:web`);

  const built = spawnSync('pnpm', ['build:web'], { cwd: ROOT, stdio: 'inherit', shell: true });

  if (built.status !== 0) {
    console.warn('pnpm build:web failed; the dev server starts all the same.');
  }
}
