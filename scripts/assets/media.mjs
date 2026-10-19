/**
 * Where the asset scripts find the user's media: the floppy images
 * `scripts/oracle/fetch-windows.mjs` extracted, and the Driver Library's
 * Super VGA 256-colour driver `fetch-svga256.mjs` unpacked. Both under
 * `oracle/.cache`, which is never committed.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';

import prettier from 'prettier';

export const ROOT = process.cwd();
export const CACHE = join(ROOT, 'oracle', '.cache');
export const FLOPPIES = join(CACHE, 'floppies');
export const SVGA256 = join(CACHE, 'svga256');
export const BUILD = join(ROOT, 'oracle', 'build');

async function exists(path) {
  return (await stat(path).catch(() => null)) !== null;
}

/** Every file below a folder, sorted by path. */
export async function filesBelow(folder) {
  const found = [];

  async function walk(at) {
    for (const entry of await readdir(at, { withFileTypes: true })) {
      const path = join(at, entry.name);

      if (entry.isDirectory()) {
        await walk(path);
      } else {
        found.push(path);
      }
    }
  }

  await walk(folder);
  return found.sort();
}

/** The floppy images, as `install-windows.mjs`'s `findImages` finds them. */
export async function findImages() {
  if (!(await exists(FLOPPIES))) {
    throw new Error('no floppy images; run scripts/oracle/fetch-windows.mjs first');
  }

  return (await filesBelow(FLOPPIES)).filter((path) => /\.(img|ima|dsk)$/i.test(path));
}

/** The Driver Library's files, where they were fetched: none otherwise. */
export async function driverFiles() {
  if (!(await exists(SVGA256))) {
    return [];
  }

  return (await filesBelow(SVGA256)).filter((path) => !/\.exe$/i.test(path));
}

/** The maker's inputs from paths: each file's path below `base` and its bytes. */
export async function inputsOf(paths, base) {
  return Promise.all(
    paths.map(async (path) => ({
      name: relative(base, path).split('\\').join('/'),
      bytes: new Uint8Array(await readFile(path)),
    }))
  );
}

/** JSON as the repository keeps it: through Prettier, with the repository's settings. */
export async function formatted(path, value) {
  const options = (await prettier.resolveConfig(path)) ?? {};

  return prettier.format(JSON.stringify(value), { ...options, filepath: path });
}
