'use strict';

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Disk } from '../../src/emulator/disk.js';
import { FAT16 } from '../../src/file-systems/fat16.js';
import { FATImage, volumeStart } from '../../src/file-systems/fat-image.js';

/**
 * A FAT disk image as a drive (`FATImage`), FAT12 or FAT16 by its count of
 * clusters, and the page's own drive, which the 12-bit entries must leave
 * as it was.
 */

const IMAGES = join(__dirname, '..', '..', 'oracle', 'probes', 'images');

function image(name: string) {
  return new Uint8Array(readFileSync(join(IMAGES, name)));
}

/** A folder's entries as a search lists them: name, attributes, size, date and time. */
async function listing(volume: any, parts: string[]) {
  const folder = await volume.open(parts);

  return (await folder.list()).map(({ info }: any) => {
    const { time, date } = info;

    return [
      info.name,
      info.attributes,
      info.size,
      ((date.year - 1980) << 9) | (date.month << 5) | date.day,
      (time.hour << 11) | (time.minute << 5) | (time.second >> 1),
    ];
  });
}

describe('a FAT image', () => {
  it('reads a floppy as FAT12, as the image keeps it (`imgflop`)', async function () {
    const floppy = await FATImage.of(image('imgflop.img'), true);

    expect(floppy._twelve).toBe(true);
    expect(floppy.removable).toBe(true);
    expect(floppy.mediaByte).toBe(0xf0);
    expect(floppy.listing).toBe('stored');

    // In the order of its slots, no label, deleted or long name's entry;
    // each stamp the entry's creation one.
    expect(await listing(floppy, [])).toEqual([
      ['README.TXT', 0x20, 0x39, 0x1a85, 0x30e4],
      ['ZEBRA.TXT', 0x20, 0x24, 0x1622, 0x1883],
      ['APPLE.TXT', 0x20, 0x12, 0x1f9f, 0xbf7d],
      ['LONGFI~1.TXT', 0x20, 0x36, 0x2109, 0x5166],
      ['DATA.BIN', 0x20, 0xbb8, 0x1908, 0x4104],
      ['SUBDIR', 0x10, 0, 0x185d, 0x0842],
      ['HIDDEN.SYS', 0x27, 0x13, 0x1329, 0x4925],
    ]);
    expect((await listing(floppy, ['SUBDIR'])).map(([name]: any) => name)).toEqual([
      '.',
      '..',
      'NESTED',
      'INNER.TXT',
    ]);

    // A file of six clusters, its chain read through 12-bit entries.
    const data: any = await floppy.open(['DATA.BIN']);
    const bytes = new Uint8Array(await data.read(0, data.info.size));

    expect(bytes.length).toBe(3000);
    expect(Array.from(bytes.subarray(0, 4))).toEqual([0x00, 0x07, 0x0e, 0x15]);
    expect(await floppy.space()).toEqual({
      sectorsPerCluster: 1,
      bytesPerSector: 512,
      clusters: 2847,
      free: 2832,
    });
  });

  it("reads a hard disk's first partition as FAT16 (`imghdd`)", async function () {
    const bytes = image('imghdd.img');

    expect(volumeStart(bytes)).toBe(63);

    const disk = await FATImage.of(bytes, false);

    expect(disk._twelve).toBe(false);
    expect(disk.removable).toBe(false);
    expect(disk.mediaByte).toBe(0xf8);
    expect((await listing(disk, [])).map(([name]: any) => name)).toEqual([
      'FIRST.TXT',
      'SECOND.TXT',
      'HARDSUB',
    ]);
    expect(await disk.space()).toEqual({
      sectorsPerCluster: 1,
      bytesPerSector: 512,
      clusters: 5921,
      free: 5917,
    });
  });

  it('is not written to', async function () {
    const floppy = await FATImage.of(image('imgflop.img'), true);
    const root = await floppy.open([]);
    const file: any = await floppy.open(['README.TXT']);

    await expect(floppy.create(['NEW.TXT'])).rejects.toBe(5);
    await expect(floppy.makeDirectory(root, 'NEWDIR')).rejects.toBe(5);
    expect(await floppy.unlink(root, 'ZEBRA.TXT')).toBe(false);
    expect(await file.write(0, new Uint8Array([1, 2, 3]))).toBe(0);
    expect((await listing(floppy, [])).length).toBe(7);
  });

  it('takes a floppy for one by its size, as DOSBox does', function () {
    const floppy = new Uint8Array(2880 * 1024 + 1023);

    floppy[0x1be + 12] = 1;
    expect(volumeStart(floppy)).toBe(0);

    const disk = new Uint8Array(3 * 1024 * 1024);

    disk[0x1ce + 8] = 100;
    disk[0x1ce + 12] = 50;
    expect(volumeStart(disk)).toBe(100);
    expect(volumeStart(new Uint8Array(3 * 1024 * 1024))).toBe(63);
  });
});

describe("the page's drive", () => {
  /**
   * A volume this engine formats and fills, as the page's C: is: FAT16
   * entries whatever its count of clusters, its bytes as they were before
   * the FAT read 12-bit entries too -- the hash of the bytes the class made
   * before that change, every file, folder, write, deletion and rename
   * below included.
   */
  it('is byte for byte as it was', async function () {
    const disk = new Disk(40 * 1024 * 1024, 512, 32 * 1024);
    const volume: any = new FAT16(disk);

    await volume.format();
    await volume.open(['WINDOWS', 'SYSTEM'], true);

    for (let n = 0; n < 40; n++) {
      const data = new Uint8Array(n * 3001 + 7).map((_, i) => (i * (n + 3)) & 0xff);

      await volume.map(
        ['WINDOWS', n % 2 ? 'SYSTEM' : '', `F${n}.BIN`].filter(Boolean),
        new DataView(data.buffer),
        { modified: 7e8 + n, archive: true }
      );
    }

    const root = await volume.open([]);

    await volume.makeDirectory(root, 'GAMES', 7e8);

    const grown: any = await volume.open(['WINDOWS', 'F4.BIN']);

    await grown.write(grown.size, new Uint8Array(70000).fill(9));
    await volume.unlink(await volume.open(['WINDOWS']), 'F6.BIN');
    await volume.map(['GAMES', 'NEW.TXT'], new DataView(new Uint8Array(100000).fill(1).buffer));

    const games = await volume.open(['GAMES']);

    await volume.rename(games, await games.lookup('NEW.TXT'), root, 'MOVED.TXT');

    expect(createHash('sha256').update(disk.save()).digest('hex')).toBe(
      'a17714f8eddc833959af9c183b94e021de3f378a9c05db4fde3041ec182ee8ca'
    );
  });
});
