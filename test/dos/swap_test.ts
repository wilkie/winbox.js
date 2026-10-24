'use strict';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { FileManager } from '../../src/dos/file-manager.js';
import { hasDisk, isCompactDisc } from '../../src/dos/syscall/ioctl.js';
import { FATImage } from '../../src/file-systems/fat-image.js';
import { ISO9660 } from '../../src/file-systems/iso9660.js';

/**
 * A drive's disk swapped for another and taken out (`FileManager.swap`,
 * `eject`), as the Rust engine's `Files::swap` and `eject`
 * (`swaps_a_disk_keeping_the_folder_and_what_was_written`,
 * `ejects_a_disk_leaving_the_drive_empty`).
 */

const IMAGES = join(__dirname, '..', '..', 'oracle', 'probes', 'images');

function image(name: string) {
  return new Uint8Array(readFileSync(join(IMAGES, name)));
}

describe('swapping disks', () => {
  test('keeps the current folder, and the disk taken out keeps what was written', async () => {
    const files = new FileManager();
    const first = await FATImage.of(image('imgflop.img'), true);
    const second = await FATImage.of(image('imgwrite.img'), true);

    files.mount('A', first);
    files._pwd['A'] = 'A:\\SUBDIR\\';
    await first.create(['NEW.TXT']);
    expect(first.changed).toBe(true);

    expect(files.swap('a', second)).toBe(first);
    expect(files._pwd['A']).toBe('A:\\SUBDIR\\');
    expect(files.query('A')).toBe(second);
    expect(await second.open(['NEW.TXT'])).toBeFalsy();

    expect(files.swap('A', first)).toBe(second);
    expect(await first.open(['NEW.TXT'])).toBeTruthy();
    expect(hasDisk(files.query('A'))).toBe(true);
  });

  /* As `imgswap` records it, and `a_discs_file_reads_the_disc_swapped_in`. */
  test("a disc's file reads the disc swapped in, but for the sector it last read", async () => {
    const files = new FileManager();
    const text = (bytes: Uint8Array) => String.fromCharCode(...bytes);

    files.mount('D', ISO9660.of(image('imgsw1.iso')));

    const file = files.resolve(await files.open('D:\\BIG.DAT'));

    expect(text(file.readHere(2064).subarray(2048))).toBe('disc1 sector 1\r\n');

    const first = files.swap('D', ISO9660.of(image('imgsw2.iso')));
    const bytes = file.readHere(2048);

    /* The rest of sector 1 from the file's own buffer, then the new disc's
     * sector 2. */
    expect(text(bytes.subarray(0, 16))).toBe('disc1 sector 1\r\n');
    expect(text(bytes.subarray(2032))).toBe('disc2 sector 2\r\n');

    files.swap('D', first);
    file.dosSeek(0, 0);
    expect(text(file.readHere(16))).toBe('disc1 sector 0\r\n');

    files.eject('D');
    file.dosSeek(4096, 0);
    expect(file.readHere(16).length).toBe(0);
  });

  test('ejects a disk, leaving the drive empty', async () => {
    const files = new FileManager();
    const floppy = await FATImage.of(image('imgflop.img'), true);
    const disc = ISO9660.of(image('imgcd.iso'));

    files.mount('A', floppy);
    files.mount('D', disc);
    files.mount('C', { removable: false });

    expect(files.eject('A')).toBe(floppy);
    expect(files.eject('D')).toBe(disc);

    const a = files.query('A');
    const d = files.query('D');

    expect([a.removable, a.remote, hasDisk(a), a.mediaByte]).toEqual([true, false, false, 0xf0]);
    expect([d.removable, d.remote, hasDisk(d), d.mediaByte]).toEqual([true, true, false, 0xf8]);
    expect(isCompactDisc(d)).toBe(true);
    expect(await a.open(['README.TXT'])).toBeNull();

    expect(files.eject('C')).toBeUndefined();
    expect(files.eject('E')).toBeUndefined();
  });
});
