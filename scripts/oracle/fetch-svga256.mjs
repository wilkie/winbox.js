#!/usr/bin/env node
/**
 * Fetches Microsoft's Super VGA 256-colour display driver for the oracle.
 *
 * Every display driver on the retail disks that shows 256 colours is for a
 * particular card -- Video 7, XGA, 8514/a, TIGA -- and DOSBox emulates none
 * of them. Microsoft's Windows Driver Library had one for the common Super
 * VGA chips, `SVGA256.DRV`, among them the Tseng ET4000, which DOSBox does
 * emulate (`machine=svga_et4000`). With it, Windows can be recorded on a
 * palette device: 8 bits a pixel and the palette manager, as programs like
 * SimTower ask for.
 *
 * The library's `svga.exe` is a self-extracting archive. It lands in
 * oracle/.cache/svga256/ with its files extracted beside it, and none of it is
 * committed: as with the Windows disks, a fetch the user runs is not a
 * redistribution. The SHA-1 is the one archive.org lists for the file.
 *
 *   node scripts/oracle/fetch-svga256.mjs
 */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import sevenZip from '7zip-bin';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SVGA256 = join(ROOT, 'oracle', '.cache', 'svga256');

const URL = 'https://archive.org/download/Windows3.1256ColorDisplayDriver/svga.exe';
const SHA1 = 'cb71dbd2fb95aa35517858e780bb0d918fb88395';

function run(command, args) {
  return new Promise((done, fail) => {
    const child = spawn(command, args, { stdio: 'inherit' });

    child.on('error', fail);
    child.on('exit', (code) =>
      code === 0 ? done() : fail(new Error(`${command} exited with ${code}`))
    );
  });
}

async function main() {
  await mkdir(SVGA256, { recursive: true });

  const archive = join(SVGA256, 'svga.exe');
  let data = (await stat(archive).catch(() => null)) ? await readFile(archive) : null;

  if (!data || createHash('sha1').update(data).digest('hex') !== SHA1) {
    console.log(`Downloading ${URL}...`);
    const response = await fetch(URL);

    if (!response.ok) {
      throw new Error(`${URL}: HTTP ${response.status}`);
    }

    data = Buffer.from(await response.arrayBuffer());
    await writeFile(archive, data);
  }

  const sha1 = createHash('sha1').update(data).digest('hex');

  if (sha1 !== SHA1) {
    throw new Error(`svga.exe has SHA-1 ${sha1}, not ${SHA1}`);
  }

  // -y answers yes to overwriting; the archive is a ZIP behind a DOS stub.
  await run(sevenZip.path7za, ['x', '-y', `-o${SVGA256}`, archive]);

  for (const name of ['OEMSETUP.INF', 'SVGA256.DRV']) {
    if (!(await stat(join(SVGA256, name)).catch(() => null))) {
      throw new Error(`no ${name} in ${archive}`);
    }
  }

  console.log(`\nThe driver is in ${SVGA256}.`);
  console.log('Next: node scripts/oracle/install-windows.mjs --display vga256');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`fetch-svga256: ${error.message}`);
    process.exitCode = 1;
  });
}
