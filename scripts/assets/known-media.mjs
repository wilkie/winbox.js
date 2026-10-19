#!/usr/bin/env node
/**
 * Writes `scripts/assets/known-media.json`: the hash of every file on the
 * media the oracle was installed from -- the six retail disks of Windows
 * 3.1, and the Driver Library's Super VGA 256-colour driver -- so that the
 * asset bundle's manifest can say which of its sources are those files.
 *
 * Per file, not per image: two dumps of the same disk can differ in the
 * slack space between files and agree on every file. A medium not listed is still taken; its files are marked
 * `known: false`, and the fidelity tests are for known media only.
 *
 * Only names, sizes and hashes are written: none of the media's bytes.
 *
 *   npx vite build --config scripts/assets/vite.config.ts && node dist/assets/known-media.js
 */

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

import { readFat12 } from '../../src/file-systems/fat12.ts';
import { driverFiles, findImages, ROOT, SVGA256 } from './media.mjs';

const hash = (data) => createHash('sha256').update(data).digest('hex');

async function main() {
  const disks = [];

  for (const image of await findImages()) {
    const files = readFat12(new Uint8Array(await readFile(image)));
    const disk = files.find((file) => /^DISK\d+$/i.test(file.path))?.path.toLowerCase();

    for (const file of files) {
      disks.push({ disk, name: file.path, size: file.data.length, sha256: hash(file.data) });
    }
  }

  const driver = [];

  for (const path of [...(await driverFiles()), join(SVGA256, 'svga.exe')]) {
    const data = await readFile(path).catch(() => null);

    if (data) {
      driver.push({ name: basename(path).toUpperCase(), size: data.length, sha256: hash(data) });
    }
  }

  const known = {
    about:
      'The files of the media the oracle was installed from, by sha256: written by scripts/assets/known-media.mjs.',
    media: [
      {
        id: 'win31-retail-3.5',
        label: 'Microsoft Windows 3.1 (3.10.103), retail, six 3.5" 1.44 MB disks',
        files: disks.sort((a, b) => a.disk.localeCompare(b.disk) || a.name.localeCompare(b.name)),
      },
      {
        id: 'wdl-svga256',
        label: "Windows Driver Library's svga.exe: the Super VGA 256-colour driver, unpacked",
        files: driver.sort((a, b) => a.name.localeCompare(b.name)),
      },
    ],
  };

  const out = join(ROOT, 'scripts', 'assets', 'known-media.json');

  await writeFile(out, `${JSON.stringify(known, null, 2)}\n`);
  console.log(`${disks.length + driver.length} files -> ${out}`);
}

main().catch((error) => {
  console.error(`known-media: ${error.message}`);
  process.exitCode = 1;
});
