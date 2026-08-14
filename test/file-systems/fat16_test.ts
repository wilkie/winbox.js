'use strict';

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { Disk } from '../../src/emulator/disk.js';
import { FAT16 } from '../../src/file-systems/fat16.js';

/**
 * FAT16.
 *
 * The filesystem could format a volume but never read one back: there was no
 * code that looked at a boot sector, only code that wrote them, and nothing
 * called either. So it had never had to be right, and was not -- the first
 * data sector was computed from a byte count where a sector count belonged,
 * FAT entries were addressed as though they were one byte wide instead of two,
 * directories stopped after sixty-four entries, and the boot sector never
 * recorded how many copies of the FAT it had.
 *
 * Two kinds of test here. The round trip formats a volume and reads it back,
 * which needs nothing external and would have caught every one of those. The
 * second reads the real Windows 3.1 installation the oracle builds, which is
 * the thing that actually matters: a volume laid out by `mkfs.fat` rather than
 * by us, holding files put there by Windows' own installer.
 */

const IMAGE = join(__dirname, '..', '..', 'oracle', 'build', 'win31.img');
const INSTALL = join(__dirname, '..', '..', 'oracle', 'build', 'drive-c');

/** A small formatted volume, held in memory. */
async function formatted(megabytes = 16) {
  const disk = new Disk(megabytes * 1024 * 1024, 512, 32768);
  const fileSystem: any = new FAT16(disk);

  await fileSystem.format();

  return { disk, fileSystem };
}

/** Reads a volume back with a filesystem that knows nothing about it. */
async function remount(disk: any) {
  const fileSystem: any = new FAT16(disk);
  await fileSystem.mount();

  return fileSystem;
}

describe('FAT16', () => {
  describe('a volume we formatted', () => {
    it('describes itself well enough to be read back', async function () {
      const { disk, fileSystem } = await formatted();
      const reader = await remount(disk);

      /* Every landmark the reader works out from the boot sector has to land
       * where the writer actually put things.
       */
      expect(reader.firstSector).toEqual(fileSystem.firstSector);
      expect(reader.clusterSize).toEqual(fileSystem.clusterSize);
      expect(reader.sectorsPerCluster).toEqual(fileSystem.sectorsPerCluster);
      expect(reader.rootEntries).toEqual(fileSystem.rootEntries);
    });

    it('reads back a file it was given', async function () {
      const { disk, fileSystem } = await formatted();

      const contents = new Uint8Array(4096);
      for (let index = 0; index < contents.length; index++) {
        contents[index] = index & 0xff;
      }

      await fileSystem.map(['HELLO.TXT'], new DataView(contents.buffer));

      const reader = await remount(disk);
      const entry: any = await reader.open(['HELLO.TXT']);

      expect(entry).not.toBeNull();
      expect(entry.info.size).toEqual(contents.length);
      expect(Array.from(new Uint8Array(await entry.read(0, contents.length)))).toEqual(
        Array.from(contents)
      );
    });

    it('reads back a file longer than one cluster', async function () {
      /* The whole point of a FAT is that a file is a chain rather than a run,
       * and a file that fits in one cluster never exercises the chain.
       */
      const { disk, fileSystem } = await formatted();

      const contents = new Uint8Array(fileSystem.clusterSize * 3 + 17);
      for (let index = 0; index < contents.length; index++) {
        contents[index] = (index * 7) & 0xff;
      }

      await fileSystem.map(['BIG.BIN'], new DataView(contents.buffer));

      const reader = await remount(disk);
      const entry: any = await reader.open(['BIG.BIN']);

      expect(entry.info.size).toEqual(contents.length);
      expect(Array.from(new Uint8Array(await entry.read(0, contents.length)))).toEqual(
        Array.from(contents)
      );
    });
  });

  describe('a volume somebody else formatted', () => {
    /* The oracle drive is built rather than committed, so these describe what
     * they need and step aside when it is not there.
     */
    const available = existsSync(IMAGE) && existsSync(INSTALL);
    const whenBuilt = available ? it : it.skip;

    async function openImage() {
      const bytes = new Uint8Array(readFileSync(IMAGE));
      const disk = new Disk(bytes.byteLength, 512, 32768);

      disk.load(bytes);

      return remount(disk);
    }

    whenBuilt('reads the geometry mkfs.fat chose', async function () {
      const fileSystem = await openImage();

      // Not our choices: a real formatter picked these.
      expect(fileSystem.sectorsPerCluster).toBeGreaterThan(0);
      expect(fileSystem.clusterSize % 512).toEqual(0);
      expect(fileSystem.firstSector).toBeGreaterThan(fileSystem.rootEntries / 16);
    });

    whenBuilt('lists a directory exactly as the host has it', async function () {
      const fileSystem = await openImage();

      const ours = (await fileSystem.list(['WINDOWS']))
        .map((entry: any) => entry.info.name)
        .filter((name: string) => name !== '.' && name !== '..')
        .sort();

      const host = readdirSync(join(INSTALL, 'WINDOWS')).sort();

      expect(ours).toEqual(host);
    });

    whenBuilt('reads a directory that outgrew its first cluster', async function () {
      /* WINDOWS\\SYSTEM has around ninety entries against sixty-four in a
       * cluster, so getting all of them means following the chain.
       */
      const fileSystem = await openImage();

      const ours = (await fileSystem.list(['WINDOWS', 'SYSTEM']))
        .map((entry: any) => entry.info.name)
        .filter((name: string) => name !== '.' && name !== '..')
        .sort();

      const host = readdirSync(join(INSTALL, 'WINDOWS', 'SYSTEM')).sort();

      expect(ours).toEqual(host);
    });

    whenBuilt('reads a file byte for byte', async function () {
      const fileSystem = await openImage();

      const entry: any = await fileSystem.open(['WINDOWS', 'WIN.COM']);
      const expected = new Uint8Array(readFileSync(join(INSTALL, 'WINDOWS', 'WIN.COM')));

      expect(entry.info.size).toEqual(expected.length);

      const actual = await entry.read(0, entry.info.size);

      // Comparing 44 KB element by element reports uselessly on failure.
      expect(Buffer.from(actual).equals(Buffer.from(expected))).toBe(true);
    });

    whenBuilt('reads the executables Windows itself is made of', async function () {
      const fileSystem = await openImage();

      for (const name of ['KRNL386.EXE', 'USER.EXE', 'GDI.EXE']) {
        const entry: any = await fileSystem.open(['WINDOWS', 'SYSTEM', name]);
        const expected = new Uint8Array(readFileSync(join(INSTALL, 'WINDOWS', 'SYSTEM', name)));

        const actual = await entry.read(0, entry.info.size);

        expect(`${name}: ${Buffer.from(actual).equals(Buffer.from(expected))}`).toEqual(
          `${name}: true`
        );
      }
    });
  });
});
