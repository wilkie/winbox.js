'use strict';

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Assets } from '../../src/assets/bundle.js';
import { Disk } from '../../src/file-systems/disk.js';
import { FAT16 } from '../../src/file-systems/fat16.js';

/**
 * The asset bundle `pnpm assets` makes, and the bare disks the page's tests
 * put a drive on: page code alone, no engine.
 */

/** The asset bundle `pnpm assets` unpacks, as `bundle()` reads it. */
export const ASSETS = join(__dirname, '..', '..', 'oracle', 'build', 'assets');

let bundleRead: Assets | null | undefined;

/** The asset bundle in `oracle/build/assets`, read once; null where it is not made. */
export function bundle(): Assets | null {
  if (bundleRead === undefined) {
    bundleRead = existsSync(ASSETS)
      ? Assets.fromFiles((path) => {
          const at = join(ASSETS, path);

          return existsSync(at) ? new Uint8Array(readFileSync(at)) : undefined;
        })
      : null;
  }

  return bundleRead;
}

/**
 * A bare disk to fill as the page fills its drive (`fillDrive` takes the
 * first of `disks`): 40 MB of 512-byte sectors in 32 KB blocks.
 */
export function bareDisks(): { disks: Disk[] } {
  return { disks: [new Disk(40 * 1024 * 1024, 512, 32 * 1024)] };
}

/**
 * The asset bundle's base for a display put on the machine's first disk, a
 * FAT16 volume made in memory as the page makes its drive (`fillDrive`): its
 * folders, and each file last written when the base says.
 */
export async function bundleDrive(machine: any, assets: Assets, display: string) {
  const composed = assets.compose(display);
  const fileSystem: any = new FAT16(machine.disks[0]);

  await fileSystem.format();

  for (const directory of composed.directories) {
    await fileSystem.open(directory.split('/'), true);
  }

  for (const { path, data, modified } of composed.files) {
    await fileSystem.map(
      path.split('/'),
      new DataView(data.buffer, data.byteOffset, data.byteLength),
      /* Its archive bit set, as the page places it (`fillDrive`). */
      { modified, archive: true }
    );
  }

  return fileSystem;
}
